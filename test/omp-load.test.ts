import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ompLoadCheck, parseInstallFailure } from "../src/checks/omp-load.ts";
import { readPlugin } from "../src/plugin.ts";
import type { OmpVersion } from "../src/types.ts";

const fx = (n: string) => join(import.meta.dir, "..", "fixtures", n);
const cacheDir = join(tmpdir(), "omp-compat-test-cache");
const load = (name: string) => {
  const { plugin } = readPlugin(name, fx(name), "trusted", "r");
  return ompLoadCheck({ plugin, omp: "18.14.2" as OmpVersion, cacheDir });
};

describe("parsing omp plugin install failures", () => {
  test("load failure: path made plugin-relative, mtime query stripped", () => {
    const err = [
      "✘ Failed to install git://x: Error: Plugin p extension validation failed:",
      "C:\\h\\.omp\\plugins\\node_modules\\p\\extension\\index.ts: Failed to load extension: Cannot find package 'x' imported from C:\\h\\p\\extension\\index.ts?mtime=123",
    ].join("\n");
    expect(parseInstallFailure(err)).toEqual([
      {
        check: "omp-load",
        code: "load-failed",
        severity: "error",
        file: "extension/index.ts",
        message: "Cannot find package 'x' imported from C:\\h\\p\\extension\\index.ts",
      },
    ]);
  });
  test("missing entry", () => {
    const f = parseInstallFailure("Plugin p extension validation failed:\n./extension/absent.ts: declared extension entry not found on disk");
    expect(f.map(x => [x.code, x.file])).toEqual([["entry-not-found", "./extension/absent.ts"]]);
  });
  test("anything else is one install-failed finding with the last 20 lines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const f = parseInstallFailure(lines.join("\n"));
    expect(f).toHaveLength(1);
    expect(f[0]!.code).toBe("install-failed");
    expect(f[0]!.message.split("\n")).toEqual(lines.slice(-20));
  });
});

describe("real omp 18.14.2 in an isolated home", () => {
  test("good loads", async () => expect(await load("good")).toEqual([]), 300_000);
  test("missing entry is reported by omp", async () => {
    const f = await load("missing-entry");
    expect(f.map(x => [x.code, x.file])).toEqual([["entry-not-found", "./extension/absent.ts"]]);
  }, 300_000);
  test("missing host module is a load failure naming the extension file", async () => {
    const f = await load("missing-module");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "load-failed", file: "extension/index.ts" });
    expect(f[0]!.message).toContain("@oh-my-pi/pi-tui");
  }, 300_000);
});

describe("runtime gating through the CLI", () => {
  test("without --allow-runtime omp-load is skipped: partial verdict, exit 0, listed as not fully verified", () => {
    const r = Bun.spawnSync(
      ["bun", "run", "src/cli.ts", "check", "fixtures/good", "--omp", "18.14.2", "--checks", "manifest,omp-load"],
      { cwd: join(import.meta.dir, "..") },
    );
    const out = r.stdout.toString();
    expect(r.exitCode).toBe(0);
    expect(out).toMatch(/## Not fully verified\n- good@\S+ on omp 18.14.2: partial/);
    expect(out).toContain("omp-load=skipped (runtime-not-allowed)");
  });
});
