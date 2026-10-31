#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { basename, resolve } from "node:path";
import { cacheRoot } from "./cache.ts";
import { CHECK_ORDER } from "./checks/index.ts";
import { UsageError } from "./errors.ts";
import { renderResults } from "./format.ts";
import { readPlugin } from "./plugin.ts";
import { runCell } from "./runner.ts";
import { resolveVersion } from "./versions.ts";
import type { CellResult, CheckId, OmpVersion } from "./types.ts";

const USAGE = `omp-compat: compatibility validator for OMP plugins

Usage:
  omp-compat check <plugin-dir> --omp <ver|latest>[,<ver>...] [--checks <ids>] [--allow-runtime] [--json] [--cache <dir>]
  omp-compat matrix --corpus <corpus.json> --versions <omp-versions.json> [--include-latest] [--checks <ids>]
                    [--trust trusted|untrusted] [--untrusted-runtime] [--report <path>]

Exit codes: 0 ok, 1 incompatible/regression, 2 usage error, 3 infra error, 4 expectation mismatch (matrix).
`;


function parseChecks(raw: string | undefined): CheckId[] {
  if (raw === undefined) return [...CHECK_ORDER];
  const ids = raw.split(",").map(c => c.trim());
  const bad = ids.filter(c => !CHECK_ORDER.includes(c as CheckId));
  if (bad.length) throw new UsageError(`unknown check id: ${bad.join(", ")}`);
  return ids as CheckId[];
}

function usage(message: string): never {
  throw new UsageError(message);
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === "check") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        omp: { type: "string" },
        checks: { type: "string" },
        "allow-runtime": { type: "boolean" },
        json: { type: "boolean" },
        cache: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (positionals.length !== 1) usage("check requires exactly one <plugin-dir>");
    if (!values.omp) usage("check requires --omp <ver|latest>[,<ver>...]");
    const checks = parseChecks(values.checks);
    const versions: OmpVersion[] = [];
    for (const raw of values.omp.split(",").map(v => v.trim())) {
      if (raw === "latest") versions.push(await resolveVersion(raw));
      else if (Bun.semver.satisfies(raw, raw)) versions.push(raw as OmpVersion);
      else usage(`--omp expects an exact version or "latest", got: ${raw}`);
    }
    const root = resolve(positionals[0]!);
    const gitHead = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]);
    const rev = gitHead.exitCode === 0 ? gitHead.stdout.toString().trim() : "unversioned";
    const { plugin } = readPlugin(basename(root), root, "untrusted", rev);
    if (values["allow-runtime"] && checks.includes("omp-load")) {
      console.error(
        "warning: omp-load installs and imports this plugin with your user's privileges; the isolated HOME is not a sandbox.",
      );
    }
    const results: CellResult[] = [];
    for (const v of versions) {
      results.push(
        await runCell(plugin, v, {
          checks,
          allowRuntime: () => values["allow-runtime"] === true,
          cacheDir: cacheRoot(values.cache),
        }),
      );
    }
    console.log(values.json ? JSON.stringify(results, null, 2) : renderResults(results));
    if (results.some(r => r.verdict === "incompatible")) return 1;
    return results.some(r => r.verdict === "infra-error") ? 3 : 0;
  }
  if (command === "matrix") {
    const { values } = parseArgs({
      args: rest,
      options: {
        corpus: { type: "string" },
        versions: { type: "string" },
        "include-latest": { type: "boolean" },
        checks: { type: "string" },
        trust: { type: "string" },
        "untrusted-runtime": { type: "boolean" },
        report: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (!values.corpus || !values.versions) usage("matrix requires --corpus and --versions");
    usage("matrix is not wired up yet (arrives with the corpus and expectations)");
  }
  return usage(`unknown command: ${command}`);
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (err) {
  if (err instanceof UsageError || (err instanceof TypeError && "code" in err)) {
    console.error(`error: ${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  throw err;
}
