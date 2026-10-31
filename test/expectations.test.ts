import { describe, expect, test } from "bun:test";
import type { CorpusEntry } from "../src/corpus.ts";
import { checkExpectations } from "../src/expectations.ts";
import type { CellResult, CellVerdict, CheckOutcome, Finding, OmpVersion } from "../src/types.ts";

const finding = (check: Finding["check"], code: Finding["code"], specifier?: string): Finding => ({
  check, code, severity: "error", message: "m", ...(specifier ? { specifier } : {}),
});
const outcome = (check: CheckOutcome["check"], status: CheckOutcome["status"], findings: Finding[] = []): CheckOutcome => ({
  check, status, findings, durationMs: 0,
});
const cell = (verdict: CellVerdict, outcomes: CheckOutcome[] = []): CellResult => ({
  pluginId: "p", pluginRev: "r", omp: "18.14.2" as OmpVersion, verdict, outcomes,
});
const entry = (o: Partial<CorpusEntry>): CorpusEntry => ({ id: "p", trust: "trusted", source: { path: "fixtures/good" }, ...o });
const kinds = (c: CellResult, e: CorpusEntry) => checkExpectations([c], [e]).map(m => m.kind);

describe("verdict expectations", () => {
  test("expect pass but incompatible -> UNEXPECTED_FAIL", () =>
    expect(kinds(cell("incompatible"), entry({ expect: "pass" }))).toEqual(["UNEXPECTED_FAIL"]));
  test("expect fail but verified or partial -> UNEXPECTED_PASS", () => {
    expect(kinds(cell("verified"), entry({ expect: "fail" }))).toEqual(["UNEXPECTED_PASS"]);
    expect(kinds(cell("partial"), entry({ expect: "fail" }))).toEqual(["UNEXPECTED_PASS"]);
  });
  test("matching expectations produce nothing", () => {
    expect(kinds(cell("verified"), entry({ expect: "pass" }))).toEqual([]);
    expect(kinds(cell("partial"), entry({ expect: "pass" }))).toEqual([]);
    expect(kinds(cell("incompatible"), entry({ expect: "fail" }))).toEqual([]);
  });
  test("entries without expect are never judged", () => expect(kinds(cell("incompatible"), entry({}))).toEqual([]));
  test.each(["skipped", "upstream-pending", "infra-error"] as const)("%s cells produce no mismatch", v => {
    expect(kinds(cell(v), entry({ expect: "pass" }))).toEqual([]);
    expect(kinds(cell(v), entry({ expect: "fail", expectFindings: [{ check: "manifest", code: "manifest-missing" }] }))).toEqual([]);
  });
});

describe("expected findings", () => {
  const want = entry({
    expect: "fail",
    expectFindings: [{ check: "host-imports", code: "module-not-found", specifier: "@oh-my-pi/pi-tui/x" }],
  });
  test("present -> no mismatch", () =>
    expect(kinds(cell("incompatible", [outcome("host-imports", "fail", [finding("host-imports", "module-not-found", "@oh-my-pi/pi-tui/x")])]), want)).toEqual([]));
  test("wrong code, wrong specifier, or no findings -> MISSED_FINDING", () => {
    for (const findings of [
      [finding("host-imports", "export-not-found", "@oh-my-pi/pi-tui/x")],
      [finding("host-imports", "module-not-found", "@oh-my-pi/pi-tui/y")],
      [],
    ]) {
      expect(kinds(cell("incompatible", [outcome("host-imports", "fail", findings)]), want)).toEqual(["MISSED_FINDING"]);
    }
  });
  test("specifier is optional in the expectation", () => {
    const e = entry({ expect: "fail", expectFindings: [{ check: "manifest", code: "manifest-missing" }] });
    expect(kinds(cell("incompatible", [outcome("manifest", "fail", [finding("manifest", "manifest-missing")])]), e)).toEqual([]);
  });
  test("a skipped or pending check is not evaluated", () => {
    for (const status of ["skipped", "upstream-pending", "infra-error"] as const) {
      expect(kinds(cell("incompatible", [outcome("host-imports", status)]), want)).toEqual([]);
    }
  });
  test("a passing check that lacks the finding is missed", () =>
    expect(kinds(cell("partial", [outcome("host-imports", "pass")]), entry({ ...want, expect: "pass" }))).toEqual(["MISSED_FINDING"]));
});
