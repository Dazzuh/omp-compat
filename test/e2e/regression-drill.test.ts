import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cli, ROOT, tmpDir, writeJson } from "./helpers.ts";

const drill = JSON.parse(readFileSync(join(ROOT, "test/drill/corpus.json"), "utf8"));
const [entry] = drill;
const [vOld, vNew] = entry.versions as [string, string];

async function run(corpus: unknown) {
  const dir = tmpDir();
  writeJson(join(dir, "corpus.json"), corpus);
  const report = join(dir, "report.json");
  const r = await cli(
    ["matrix", "--corpus", join(dir, "corpus.json"), "--versions", join(ROOT, "omp-versions.json"), "--checks", "manifest,host-imports", "--report", report],
  );
  return { ...r, report: JSON.parse(readFileSync(report, "utf8")) };
}

test("a binding present at V_old and removed at V_new is one upstream regression", async () => {
  const r = await run(drill);
  expect(r.code).toBe(1);
  expect(r.report.regressions).toHaveLength(1);
  expect(r.report.regressions[0]).toMatchObject({ pluginId: "drill-removed-api", check: "host-imports", baseline: vOld, newer: vNew });
  expect(r.report.regressions[0].findings[0]).toMatchObject({ code: "export-not-found" });
  expect(r.report.mismatches).toEqual([]);
  expect(r.out).toMatch(new RegExp(`## Upstream regressions\\n- drill-removed-api@\\S+: host-imports passes on ${vOld} and fails on ${vNew}`));
}, 600_000);

test("the same plugin with no baseline pass is not a regression", async () => {
  const r = await run([{ ...entry, baseline: vNew, versions: [vNew] }]);
  expect(r.code).toBe(0);
  expect(r.report.regressions).toEqual([]);
  expect(r.report.results.map((c: any) => c.verdict)).toEqual(["incompatible"]);
}, 600_000);
