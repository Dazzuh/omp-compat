import type { CellResult } from "./types.ts";

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
