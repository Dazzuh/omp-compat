import type { CellResult, CheckId, CheckOutcome, OmpVersion, Regression } from "./types.ts";

/**
 * An upstream regression: the same plugin revision passes a check on its baseline OMP version
 * and fails that check on a newer version. Never reads fixture expectations.
 */
export function findRegressions(results: CellResult[], baselineFor: (pluginId: string) => OmpVersion): Regression[] {
  const groups = new Map<string, CellResult[]>();
  for (const r of results) {
    const key = `${r.pluginId}\0${r.pluginRev}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Regression[] = [];
  for (const cells of groups.values()) {
    const { pluginId, pluginRev } = cells[0]!;
    const baseline = baselineFor(pluginId);
    const base = cells.find(c => c.omp === baseline);
    if (!base) continue;
    const outcome = (c: CellResult, check: CheckId): CheckOutcome | undefined => c.outcomes.find(o => o.check === check);
    for (const o of base.outcomes) {
      if (o.status !== "pass") continue;
      for (const c of cells) {
        if (Bun.semver.order(c.omp, baseline) <= 0) continue;
        const newer = outcome(c, o.check);
        if (newer?.status === "fail") {
          out.push({ pluginId, pluginRev, check: o.check, baseline, newer: c.omp, findings: newer.findings });
        }
      }
    }
  }
  return out;
}
