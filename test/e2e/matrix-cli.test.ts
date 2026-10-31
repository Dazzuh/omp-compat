import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cli, tmpDir, writeJson } from "./helpers.ts";

const versions = { baseline: "18.14.2", pinned: ["18.12.5", "18.13.3", "18.14.2"] };
const good = { id: "good", trust: "trusted", source: { path: "fixtures/good" } };

function setup(corpus: unknown[]) {
  const dir = tmpDir();
  writeJson(join(dir, "corpus.json"), corpus);
  writeJson(join(dir, "versions.json"), versions);
  return { corpus: join(dir, "corpus.json"), versions: join(dir, "versions.json"), report: join(dir, "report.json") };
}

test("--untrusted-runtime outside a disposable runner exits 2 with the refusal", async () => {
  const p = setup([good]);
  const r = await cli(["matrix", "--corpus", p.corpus, "--versions", p.versions, "--untrusted-runtime"]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("refusing to run untrusted plugin code outside a disposable runner");
});

test("a trusted git entry exits 2 naming the entry", async () => {
  const p = setup([{ id: "sneaky", trust: "trusted", source: { git: "https://example.invalid/x", rev: "abc" } }]);
  const r = await cli(["matrix", "--corpus", p.corpus, "--versions", p.versions]);
  expect(r.code).toBe(2);
  expect(r.err).toContain('corpus entry "sneaky"');
});

test("a trusted path outside fixtures/ and test/drill/ exits 2", async () => {
  const p = setup([{ id: "out", trust: "trusted", source: { path: "src" } }]);
  const r = await cli(["matrix", "--corpus", p.corpus, "--versions", p.versions]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("outside fixtures/ and test/drill/");
});

test("a baseline missing from the entry's versions exits 2", async () => {
  const p = setup([{ ...good, versions: ["18.12.5"], baseline: "18.14.2" }]);
  expect((await cli(["matrix", "--corpus", p.corpus, "--versions", p.versions])).code).toBe(2);
});

test("flipping good to expect fail gives exit 4 with one UNEXPECTED_PASS per version", async () => {
  const p = setup([{ ...good, expect: "fail" }]);
  const r = await cli(["matrix", "--corpus", p.corpus, "--versions", p.versions, "--checks", "manifest,host-imports", "--report", p.report]);
  expect(r.code).toBe(4);
  const report = JSON.parse(readFileSync(p.report, "utf8"));
  expect(report.mismatches.map((m: any) => [m.kind, m.omp])).toEqual(
    versions.pinned.map(v => ["UNEXPECTED_PASS", v]),
  );
  expect(report.regressions).toEqual([]);
  expect(r.out).toContain("## Expectation mismatches\n- good on omp 18.12.5: UNEXPECTED_PASS");
}, 600_000);
