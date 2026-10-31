import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hoursAgo } from "../stub-registry.ts";
import { cli, tmpDir, writeJson } from "./helpers.ts";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => servers.splice(0).forEach(s => s.stop(true)));

/** One server: a registry advertising 99.0.0 (published `ageHours` ago) and a releases host with no assets. */
function stub(ageHours: number) {
  const s = Bun.serve({
    port: 0,
    fetch(req) {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (name === "@oh-my-pi/pi-coding-agent") {
        return Response.json({ "dist-tags": { latest: "99.0.0" }, versions: { "99.0.0": {} }, time: { "99.0.0": hoursAgo(ageHours) } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}

async function matrix(ageHours: number) {
  const url = stub(ageHours);
  const dir = tmpDir();
  writeJson(join(dir, "corpus.json"), [
    { id: "good", trust: "trusted", source: { path: "fixtures/good" }, expect: "pass", versions: ["99.0.0"], baseline: "99.0.0" },
  ]);
  writeJson(join(dir, "versions.json"), { baseline: "99.0.0", pinned: ["99.0.0"] });
  const report = join(dir, "report.json");
  const r = await cli(
    ["matrix", "--corpus", join(dir, "corpus.json"), "--versions", join(dir, "versions.json"), "--checks", "manifest,omp-load", "--report", report],
    { OMP_COMPAT_NPM_REGISTRY: url, OMP_COMPAT_RELEASES_BASE: url, OMP_COMPAT_CACHE: tmpDir(), GITHUB_ACTIONS: "true" },
  );
  return { ...r, report: JSON.parse(readFileSync(report, "utf8")) };
}

test("release published 1 h ago with no asset: upstream-pending, exit 0, no regression or mismatch", async () => {
  const r = await matrix(1);
  expect(r.code).toBe(0);
  expect(r.report.results.map((c: any) => c.verdict)).toEqual(["upstream-pending"]);
  expect(r.report.regressions).toEqual([]);
  expect(r.report.mismatches).toEqual([]);
  expect(r.out).toMatch(/## Not fully verified\n- good@\S+ on omp 99.0.0: upstream-pending/);
  expect(r.out).toContain("::warning::good on omp 99.0.0");
});

test("same release 72 h old: infra-error, exit 3, never incompatible", async () => {
  const r = await matrix(72);
  expect(r.code).toBe(3);
  expect(r.report.results.map((c: any) => c.verdict)).toEqual(["infra-error"]);
  expect(r.out).toContain("still missing 48h after npm publish of 99.0.0");
});
