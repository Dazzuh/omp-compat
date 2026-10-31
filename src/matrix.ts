import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheRoot } from "./cache.ts";
import { REPO_ROOT, readCorpus, readVersions, resolveSourcePath, type CorpusEntry } from "./corpus.ts";
import { InfraError, UsageError } from "./errors.ts";
import { checkExpectations } from "./expectations.ts";
import { renderMatrix } from "./format.ts";
import { readPlugin } from "./plugin.ts";
import { findRegressions } from "./regressions.ts";
import { runCell } from "./runner.ts";
import type { CellResult, CheckId, OmpVersion, PluginUnderTest, Report } from "./types.ts";
import { resolveVersion } from "./versions.ts";

export interface MatrixOptions {
  corpus: string;
  versions: string;
  includeLatest: boolean;
  checks: CheckId[];
  trust?: "trusted" | "untrusted";
  untrustedRuntime: boolean;
  report?: string;
}

const REFUSAL = "refusing to run untrusted plugin code outside a disposable runner (set only by the runtime-untrusted CI job)";

function git(args: string[], cwd?: string): string {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new InfraError(`git ${args.join(" ")} failed: ${r.stderr.toString().slice(-300)}`);
  return r.stdout.toString().trim();
}

/** Clones without running anything from the plugin: no checkout hooks come with a clone. */
function materialize(entry: CorpusEntry, cacheDir: string): { root: string; rev: string } {
  if ("path" in entry.source) {
    const head = Bun.spawnSync(["git", "-C", REPO_ROOT, "rev-parse", "HEAD"]);
    return { root: resolveSourcePath(entry.source.path), rev: head.exitCode === 0 ? head.stdout.toString().trim() : "unversioned" };
  }
  const { git: url, rev } = entry.source;
  const root = join(cacheDir, "plugins", `${entry.id}-${rev}`);
  const marker = `${root}.complete`;
  if (!existsSync(marker)) {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(cacheDir, "plugins"), { recursive: true });
    git(["clone", "--no-checkout", "-q", url, root]);
    git(["checkout", "-q", rev], root);
    writeFileSync(marker, rev);
  }
  return { root, rev };
}

export async function runMatrix(opts: MatrixOptions): Promise<{ report: Report; markdown: string; exitCode: number }> {
  if (opts.untrustedRuntime && process.env.OMP_COMPAT_DISPOSABLE_RUNNER !== "1") throw new UsageError(REFUSAL);
  const corpus = readCorpus(opts.corpus);
  const versionsFile = readVersions(opts.versions);
  const cacheDir = cacheRoot();
  const selected = corpus.filter(e => !opts.trust || e.trust === opts.trust);

  const latest = opts.includeLatest ? await resolveVersion("latest") : undefined;
  const defaults = [...new Set([...versionsFile.pinned, ...(latest ? [latest] : [])])];
  const plan = selected.map(entry => {
    const versions = entry.versions ?? defaults;
    const baseline = entry.baseline ?? versionsFile.baseline;
    if (!versions.includes(baseline)) {
      throw new UsageError(`corpus entry "${entry.id}": baseline ${baseline} is not in its version list (${versions.join(", ")})`);
    }
    return { entry, versions, baseline };
  });
  const baselines = new Map(plan.map(p => [p.entry.id, p.baseline as OmpVersion]));

  const results: CellResult[] = [];
  for (const { entry, versions } of plan) {
    const { root, rev } = materialize(entry, cacheDir);
    let plugin: PluginUnderTest;
    try {
      plugin = readPlugin(entry.id, root, entry.trust, rev).plugin;
    } catch (err) {
      throw err instanceof InfraError ? new InfraError(`corpus entry "${entry.id}": ${err.message}`, { cause: err }) : err;
    }
    const allowRuntime = () => entry.trust === "trusted" || opts.untrustedRuntime;
    for (const v of versions) {
      results.push(await runCell(plugin, v as OmpVersion, { checks: opts.checks, allowRuntime, cacheDir }));
    }
  }

  const regressions = findRegressions(results, id => baselines.get(id)!);
  const mismatches = checkExpectations(results, corpus);
  const report: Report = {
    schema: 1,
    tool: "omp-compat 0.1.0",
    generatedAt: new Date().toISOString(),
    baseline: versionsFile.baseline as OmpVersion,
    results,
    regressions,
    mismatches,
  };
  const markdown = renderMatrix(report, latest);
  if (opts.report) writeFileSync(opts.report, JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const r of results.filter(r => r.verdict === "upstream-pending")) {
      const missing = r.outcomes.find(o => o.status === "upstream-pending")?.detail;
      console.log(`::warning::${r.pluginId} on omp ${r.omp}: upstream artifact not available yet (${missing})`);
    }
  }
  const exitCode = regressions.length ? 1 : mismatches.length ? 4 : results.some(r => r.verdict === "infra-error") ? 3 : 0;
  return { report, markdown, exitCode };
}
