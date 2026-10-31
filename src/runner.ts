import { CHECKS, CHECK_ORDER } from "./checks/index.ts";
import { UpstreamPendingError } from "./errors.ts";
import type {
  CellResult,
  CellVerdict,
  CheckDef,
  CheckId,
  CheckOutcome,
  OmpVersion,
  PluginUnderTest,
} from "./types.ts";

export interface RunOptions {
  checks: readonly CheckId[];
  allowRuntime: (plugin: PluginUnderTest) => boolean;
  cacheDir: string;
  registry?: Record<CheckId, CheckDef>;
}

export async function runCell(
  plugin: PluginUnderTest,
  omp: OmpVersion,
  opts: RunOptions,
): Promise<CellResult> {
  const registry = opts.registry ?? CHECKS;
  const outcomes: CheckOutcome[] = [];
  let manifestFailed = false;
  for (const id of CHECK_ORDER) {
    const skip = (skipReason: CheckOutcome["skipReason"]): CheckOutcome => ({
      check: id,
      status: "skipped",
      findings: [],
      skipReason,
      durationMs: 0,
    });
    const def = registry[id];
    if (!opts.checks.includes(id)) outcomes.push(skip("not-selected"));
    else if (manifestFailed) outcomes.push(skip("manifest-failed"));
    else if (def.executesPluginCode && !opts.allowRuntime(plugin)) outcomes.push(skip("runtime-not-allowed"));
    else {
      const outcome = await execute(id, def, plugin, omp, opts.cacheDir);
      if (id === "manifest" && outcome.status === "fail") manifestFailed = true;
      outcomes.push(outcome);
    }
  }
  return { pluginId: plugin.id, pluginRev: plugin.rev, omp, verdict: verdictOf(outcomes), outcomes };
}

async function execute(
  id: CheckId,
  def: CheckDef,
  plugin: PluginUnderTest,
  omp: OmpVersion,
  cacheDir: string,
): Promise<CheckOutcome> {
  const start = performance.now();
  const durationMs = () => Math.round(performance.now() - start);
  try {
    const findings = await def.run({ plugin, omp, cacheDir });
    const failed = findings.some(f => f.severity === "error");
    return { check: id, status: failed ? "fail" : "pass", findings, durationMs: durationMs() };
  } catch (err) {
    if (err instanceof UpstreamPendingError) {
      return { check: id, status: "upstream-pending", findings: [], detail: err.missing, durationMs: durationMs() };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { check: id, status: "infra-error", findings: [], detail, durationMs: durationMs() };
  }
}

/** Checks the caller did not select are not part of the verdict; skips for other reasons are. */
export function verdictOf(all: CheckOutcome[]): CellVerdict {
  const outcomes = all.filter(o => o.skipReason !== "not-selected");
  const has = (s: CheckOutcome["status"]) => outcomes.some(o => o.status === s);
  if (has("fail")) return "incompatible";
  if (has("infra-error")) return "infra-error";
  if (has("upstream-pending")) return "upstream-pending";
  if (outcomes.length === 0) return "skipped";
  const passes = outcomes.filter(o => o.status === "pass").length;
  if (passes === outcomes.length) return "verified";
  if (passes > 0) return "partial";
  return "skipped";
}
