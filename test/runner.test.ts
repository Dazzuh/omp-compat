import { describe, expect, test } from "bun:test";
import { InfraError, UpstreamPendingError } from "../src/errors.ts";
import { runCell, verdictOf } from "../src/runner.ts";
import type {
  CheckDef,
  CheckId,
  CheckOutcome,
  Finding,
  OmpVersion,
  PluginUnderTest,
} from "../src/types.ts";

const omp = "18.14.2" as OmpVersion;
const plugin: PluginUnderTest = {
  id: "p",
  root: "/x",
  rev: "r",
  trust: "trusted",
  name: "p",
  version: "0.0.0",
  manifestKey: "omp",
  extensionEntries: [],
};
const err = (check: CheckId): Finding => ({ check, code: "load-failed", severity: "error", message: "boom" });
const warn = (check: CheckId): Finding => ({ check, code: "host-import-unverified", severity: "warning", message: "w" });

type Behaviour = Finding[] | Error;
function registry(b: Partial<Record<CheckId, Behaviour>>, calls: CheckId[] = []): Record<CheckId, CheckDef> {
  const def = (id: CheckId, executesPluginCode: boolean): CheckDef => ({
    executesPluginCode,
    run: async () => {
      calls.push(id);
      const r = b[id] ?? [];
      if (r instanceof Error) throw r;
      return r;
    },
  });
  return { manifest: def("manifest", false), "host-imports": def("host-imports", false), "omp-load": def("omp-load", true) };
}
const all: CheckId[] = ["manifest", "host-imports", "omp-load"];
const cell = (b: Partial<Record<CheckId, Behaviour>>, o: { checks?: CheckId[]; runtime?: boolean; calls?: CheckId[] } = {}) =>
  runCell(plugin, omp, {
    checks: o.checks ?? all,
    allowRuntime: () => o.runtime ?? true,
    cacheDir: "/c",
    registry: registry(b, o.calls),
  });
const status = (r: Awaited<ReturnType<typeof cell>>) => r.outcomes.map(o => o.status);

describe("verdicts", () => {
  test("all pass -> verified", async () => expect((await cell({})).verdict).toBe("verified"));
  test("warning-only findings still pass", async () => {
    const r = await cell({ "host-imports": [warn("host-imports")] });
    expect(r.verdict).toBe("verified");
    expect(r.outcomes[1]?.findings).toHaveLength(1);
  });
  test("an error finding -> incompatible", async () =>
    expect((await cell({ "host-imports": [err("host-imports")] })).verdict).toBe("incompatible"));
  test("fail beats infra-error and pending", async () => {
    const r = await cell({
      manifest: new InfraError("net"),
      "host-imports": new UpstreamPendingError("pkg@1"),
      "omp-load": [err("omp-load")],
    });
    expect(r.verdict).toBe("incompatible");
  });
  test("infra-error beats pending", async () =>
    expect(
      (await cell({ "host-imports": new InfraError("net"), "omp-load": new UpstreamPendingError("x") })).verdict,
    ).toBe("infra-error"));
  test("pending with nothing worse -> upstream-pending", async () => {
    const r = await cell({ "host-imports": new UpstreamPendingError("pkg@1") });
    expect(r.verdict).toBe("upstream-pending");
    expect(r.outcomes[1]).toMatchObject({ status: "upstream-pending", detail: "pkg@1" });
  });
  test("pass + skipped -> partial", async () =>
    expect((await cell({}, { runtime: false })).verdict).toBe("partial"));
  test("nothing ran -> skipped", async () => expect((await cell({}, { checks: [] })).verdict).toBe("skipped"));
  test("verdictOf on only skipped outcomes", () => {
    const o: CheckOutcome = { check: "manifest", status: "skipped", findings: [], durationMs: 0 };
    expect(verdictOf([o, o])).toBe("skipped");
  });
});

describe("skip reasons and execution", () => {
  test("unselected check -> not-selected and never run", async () => {
    const calls: CheckId[] = [];
    const r = await cell({}, { checks: ["manifest"], calls });
    expect(r.outcomes.map(o => o.skipReason)).toEqual([undefined, "not-selected", "not-selected"]);
    expect(calls).toEqual(["manifest"]);
  });
  test("manifest failure skips later checks as manifest-failed", async () => {
    const calls: CheckId[] = [];
    const r = await cell({ manifest: [err("manifest")] }, { calls });
    expect(status(r)).toEqual(["fail", "skipped", "skipped"]);
    expect(r.outcomes.slice(1).map(o => o.skipReason)).toEqual(["manifest-failed", "manifest-failed"]);
    expect(calls).toEqual(["manifest"]);
  });
  test("manifest warning does not skip later checks", async () => {
    const r = await cell({ manifest: [warn("manifest")] });
    expect(status(r)).toEqual(["pass", "pass", "pass"]);
  });
  test("code-executing check is skipped runtime-not-allowed without opt-in", async () => {
    const calls: CheckId[] = [];
    const r = await cell({}, { runtime: false, calls });
    expect(r.outcomes[2]).toMatchObject({ status: "skipped", skipReason: "runtime-not-allowed" });
    expect(calls).toEqual(["manifest", "host-imports"]);
  });
  test("non-selection outranks runtime gating, manifest-failed outranks runtime gating", async () => {
    const r = await cell({ manifest: [err("manifest")] }, { runtime: false });
    expect(r.outcomes[2]?.skipReason).toBe("manifest-failed");
  });
  test("an unknown thrown error becomes infra-error with its message", async () => {
    const r = await cell({ manifest: new Error("kaput") });
    expect(r.outcomes[0]).toMatchObject({ status: "infra-error", detail: "kaput" });
    expect(r.verdict).toBe("infra-error");
  });
  test("cell carries plugin id, rev and version", async () => {
    const r = await cell({});
    expect([r.pluginId, r.pluginRev, r.omp]).toEqual(["p", "r", "18.14.2"]);
  });
});
