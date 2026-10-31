import type { CorpusEntry } from "./corpus.ts";
import type { CellResult, ExpectationMismatch } from "./types.ts";

/** Fixture self-tests. Only cells that actually ran (verified, partial, incompatible) are judged. */
export function checkExpectations(results: CellResult[], corpus: CorpusEntry[]): ExpectationMismatch[] {
  const out: ExpectationMismatch[] = [];
  for (const cell of results) {
    const entry = corpus.find(e => e.id === cell.pluginId);
    if (!entry?.expect) continue;
    if (cell.verdict !== "verified" && cell.verdict !== "partial" && cell.verdict !== "incompatible") continue;
    const mismatch = (kind: ExpectationMismatch["kind"], detail: string) =>
      out.push({ pluginId: cell.pluginId, omp: cell.omp, kind, detail });
    if (entry.expect === "pass" && cell.verdict === "incompatible") {
      mismatch("UNEXPECTED_FAIL", "expected pass but the cell is incompatible");
    }
    if (entry.expect === "fail" && cell.verdict !== "incompatible") {
      mismatch("UNEXPECTED_PASS", `expected fail but the cell is ${cell.verdict}`);
    }
    for (const want of entry.expectFindings ?? []) {
      const outcome = cell.outcomes.find(o => o.check === want.check);
      if (outcome?.status !== "pass" && outcome?.status !== "fail") continue;
      const found = outcome.findings.some(
        f => f.check === want.check && f.code === want.code && (want.specifier === undefined || f.specifier === want.specifier),
      );
      if (!found) {
        mismatch("MISSED_FINDING", `no ${want.check}/${want.code}${want.specifier ? ` for ${want.specifier}` : ""} finding`);
      }
    }
  }
  return out;
}
