import type { CellResult, Report } from "./types.ts";

const FULL = new Set(["verified", "incompatible"]);

function line(r: CellResult): string {
  const parts = r.outcomes.map(o => {
    const why = o.skipReason ?? o.detail;
    return `${o.check}=${o.status}${why ? ` (${why})` : ""}`;
  });
  return `- ${r.pluginId}@${r.pluginRev.slice(0, 8)} on omp ${r.omp}: ${r.verdict} [${parts.join(", ")}]`;
}

export function renderResults(results: CellResult[]): string {
  const out: string[] = [];
  const unverified = results.filter(r => !FULL.has(r.verdict));
  out.push("## Not fully verified", ...(unverified.length ? unverified.map(line) : ["- none"]));
  out.push("", "## Results", ...results.map(line));
  for (const r of results) {
    for (const o of r.outcomes) {
      for (const f of o.findings) {
        const at = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
        out.push(`  - ${r.omp} ${f.check} ${f.severity} ${f.code}${at}: ${f.message}`);
      }
    }
  }
  return out.join("\n");
}

/** Matrix summary: regressions, expectation mismatches, then the shared unverified and results sections. */
export function renderMatrix(report: Report, latest?: string): string {
  const out: string[] = [];
  if (latest) out.push(`Resolved latest OMP: ${latest}`, "");
  out.push("## Upstream regressions");
  if (report.regressions.length === 0) out.push("- none");
  for (const r of report.regressions) {
    out.push(`- ${r.pluginId}@${r.pluginRev.slice(0, 8)}: ${r.check} passes on ${r.baseline} and fails on ${r.newer}`);
    for (const f of r.findings) out.push(`  - ${f.code}${f.specifier ? ` ${f.specifier}` : ""}: ${f.message}`);
  }
  out.push("", "## Expectation mismatches");
  if (report.mismatches.length === 0) out.push("- none");
  for (const m of report.mismatches) out.push(`- ${m.pluginId} on omp ${m.omp}: ${m.kind}: ${m.detail}`);
  out.push("", renderResults(report.results));
  return out.join("\n");
}
