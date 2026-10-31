import { describe, expect, test } from "bun:test";
import { findRegressions } from "../src/regressions.ts";
import type { CellResult, CheckId, CheckOutcome, CheckStatus, Finding, OmpVersion } from "../src/types.ts";

const v = (s: string) => s as OmpVersion;
const f: Finding = { check: "host-imports", code: "module-not-found", severity: "error", message: "gone", specifier: "x" };
const outcome = (check: CheckId, status: CheckStatus): CheckOutcome => ({
  check, status, findings: status === "fail" ? [f] : [], durationMs: 0,
});
const cell = (omp: string, hostImports: CheckStatus, o: { rev?: string; manifest?: CheckStatus } = {}): CellResult => ({
  pluginId: "p",
  pluginRev: o.rev ?? "r1",
  omp: v(omp),
  verdict: hostImports === "fail" ? "incompatible" : "verified",
  outcomes: [outcome("manifest", o.manifest ?? "pass"), outcome("host-imports", hostImports)],
});
const base = () => v("18.0.0");
const run = (cells: CellResult[]) => findRegressions(cells, base);

describe("findRegressions", () => {
  test("baseline pass then newer fail on the same check and rev -> one regression", () => {
    const r = run([cell("18.0.0", "pass"), cell("18.1.0", "fail")]);
    expect(r).toEqual([{ pluginId: "p", pluginRev: "r1", check: "host-imports", baseline: v("18.0.0"), newer: v("18.1.0"), findings: [f] }]);
  });
  test("one regression per newer failing version; versions below the baseline never count", () => {
    const r = run([cell("17.9.0", "fail"), cell("18.0.0", "pass"), cell("18.1.0", "fail"), cell("18.2.0", "fail")]);
    expect(r.map(x => x.newer)).toEqual([v("18.1.0"), v("18.2.0")]);
  });
  test("a fail with no baseline pass is not a regression", () => {
    expect(run([cell("18.0.0", "fail"), cell("18.1.0", "fail")])).toEqual([]);
    expect(run([cell("18.1.0", "fail")])).toEqual([]); // baseline cell absent
  });
  test("a newer upstream-pending, infra-error or skipped outcome is not a regression", () => {
    for (const s of ["upstream-pending", "infra-error", "skipped"] as const) {
      expect(run([cell("18.0.0", "pass"), cell("18.1.0", s)])).toEqual([]);
    }
  });
  test("a baseline that did not pass (skipped, pending, infra) never anchors a regression", () => {
    for (const s of ["upstream-pending", "infra-error", "skipped"] as const) {
      expect(run([cell("18.0.0", s), cell("18.1.0", "fail")])).toEqual([]);
    }
  });
  test("a different pluginRev gives none", () => {
    expect(run([cell("18.0.0", "pass", { rev: "r1" }), cell("18.1.0", "fail", { rev: "r2" })])).toEqual([]);
  });
  test("only the check that passed on the baseline can regress", () => {
    const r = run([cell("18.0.0", "pass", { manifest: "fail" }), cell("18.1.0", "fail", { manifest: "fail" })]);
    expect(r.map(x => x.check)).toEqual(["host-imports"]);
  });
  test("baseline is chosen per plugin", () => {
    const cells = [cell("18.0.0", "pass"), cell("18.1.0", "pass"), cell("18.2.0", "fail")];
    expect(findRegressions(cells, () => v("18.1.0")).map(x => [x.baseline, x.newer])).toEqual([[v("18.1.0"), v("18.2.0")]]);
  });
});
