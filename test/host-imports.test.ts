import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHostImports, hostImportsCheck, normalizeHostSpecifier } from "../src/checks/host-imports.ts";
import { readPlugin } from "../src/plugin.ts";
import type { OmpVersion } from "../src/types.ts";

const fx = (n: string) => join(import.meta.dir, "..", "fixtures", n);
// Shared across runs so each OMP version is installed from npm once.
const cacheDir = join(tmpdir(), "omp-compat-test-cache");

async function checkFixture(name: string, omp: string) {
  const { plugin } = readPlugin(name, fx(name), "trusted", "r");
  return hostImportsCheck({ plugin, omp: omp as OmpVersion, cacheDir });
}

describe("collecting host imports", () => {
  function withTree(files: Record<string, string>, fn: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), "omp-compat-hi-"));
    try {
      for (const [p, text] of Object.entries(files)) {
        mkdirSync(join(root, p, ".."), { recursive: true });
        writeFileSync(join(root, p), text);
      }
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("specifier normalization: scopes, remaps, non-host", () => {
    expect(normalizeHostSpecifier("@mariozechner/pi-tui")).toBe("@oh-my-pi/pi-tui");
    expect(normalizeHostSpecifier("@earendil-works/pi-ai/utils/oauth")).toBe("@oh-my-pi/pi-ai/oauth");
    expect(normalizeHostSpecifier("@oh-my-pi/pi-ai/compat")).toBe("@oh-my-pi/pi-ai");
    expect(normalizeHostSpecifier("@oh-my-pi/pi-ai/models")).toBe("@oh-my-pi/pi-ai/models");
    expect(normalizeHostSpecifier("@oh-my-pi/other")).toBeNull();
    expect(normalizeHostSpecifier("lodash")).toBeNull();
  });

  test("follows relative imports, handles every import form, ignores the rest", () => {
    withTree(
      {
        "index.ts": [
          'import type { A } from "@oh-my-pi/pi-coding-agent";',
          'import Def, { b as c, type D } from "@mariozechner/pi-tui";',
          'export { e } from "@oh-my-pi/pi-utils";',
          'export * from "@oh-my-pi/pi-natives";',
          'const m = await import("@oh-my-pi/pi-ai/compat");',
          'import "./lib/helper.js";',
          'import "./lib";',
          'import "./notes.md";',
          'import "../outside";',
          'import "lodash";',
        ].join("\n"),
        "lib/helper.ts": 'import { x } from "@oh-my-pi/pi-agent-core";\nimport "./index";',
        "lib/index.ts": 'import * as ns from "@oh-my-pi/pi-catalog";',
        "notes.md": 'import { nope } from "@oh-my-pi/pi-tui";',
      },
      root => {
        const got = collectHostImports(root, [join(root, "index.ts")]);
        const brief = got.map(i => [i.file, i.line, i.probeSpecifier]);
        expect(brief).toEqual([
          ["index.ts", 1, "@oh-my-pi/pi-coding-agent"],
          ["index.ts", 2, "@oh-my-pi/pi-tui"],
          ["index.ts", 3, "@oh-my-pi/pi-utils"],
          ["index.ts", 4, "@oh-my-pi/pi-natives"],
          ["index.ts", 5, "@oh-my-pi/pi-ai"],
          ["lib/helper.ts", 1, "@oh-my-pi/pi-agent-core"],
          ["lib/index.ts", 1, "@oh-my-pi/pi-catalog"],
        ]);
        expect(got[0]).toMatchObject({ typeOnly: true, names: [{ name: "A", typeOnly: false }] });
        expect(got[1]).toMatchObject({ hasDefault: true, names: [{ name: "b" }, { name: "D", typeOnly: true }] });
        expect(got[3]).toMatchObject({ namespace: true, names: [] });
        expect(got[4]).toMatchObject({ namespace: true, specifier: "@oh-my-pi/pi-ai/compat" });
      },
    );
  });
});

describe("against real OMP host types (npm)", () => {
  test("missing subpath -> module-not-found at the right line", async () => {
    const f = await checkFixture("missing-module", "18.14.2");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      code: "module-not-found",
      severity: "error",
      specifier: "@oh-my-pi/pi-tui/no-such-module",
      file: "extension/index.ts",
      line: 2,
    });
  }, 300_000);

  test("missing named export -> export-not-found with the binding", async () => {
    const f = await checkFixture("missing-export", "18.14.2");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "export-not-found", binding: "definitelyNotExported", line: 2 });
  }, 300_000);

  test("good fixture is clean on every pinned version", async () => {
    for (const v of ["18.12.5", "18.13.3", "18.14.2"]) expect(await checkFixture("good", v)).toEqual([]);
  }, 600_000);
});
