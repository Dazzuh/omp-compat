import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InfraError } from "../src/errors.ts";
import { readPlugin } from "../src/plugin.ts";

const fx = (n: string) => join(import.meta.dir, "..", "fixtures", n);
const read = (n: string) => readPlugin(n, fx(n), "trusted", "r");

test("good fixture: manifest ok, entry resolved to an absolute path", () => {
  const { plugin, findings } = read("good");
  expect(findings).toEqual([]);
  expect(plugin.manifestKey).toBe("omp");
  expect(plugin.extensionEntries).toEqual([join(fx("good"), "extension", "index.ts")]);
});

test("no manifest -> one manifest-missing error", () => {
  const { plugin, findings } = read("no-manifest");
  expect(plugin.manifestKey).toBeNull();
  expect(findings.map(f => [f.code, f.severity, f.file])).toEqual([["manifest-missing", "error", "package.json"]]);
});

test("declared entry absent -> entry-not-found naming the declared path", () => {
  const { findings } = read("missing-entry");
  expect(findings.map(f => [f.code, f.file])).toEqual([["entry-not-found", "./extension/absent.ts"]]);
});

function withPkg(pkg: unknown, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "omp-compat-plugin-"));
  try {
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "a", "x.ts"), "");
    writeFileSync(join(dir, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("omp key wins over legacy pi key; pi alone is accepted", () => {
  withPkg({ omp: { extensions: ["./a/x.ts"] }, pi: { extensions: ["./gone.ts"] } }, dir => {
    const { plugin, findings } = readPlugin("p", dir, "untrusted", "r");
    expect(plugin.manifestKey).toBe("omp");
    expect(findings).toEqual([]);
  });
  withPkg({ pi: { extensions: ["./a/x.ts"] } }, dir => {
    expect(readPlugin("p", dir, "untrusted", "r").plugin.manifestKey).toBe("pi");
  });
});

test("manifest without extensions has nothing to check", () => {
  withPkg({ omp: {} }, dir => {
    const { plugin, findings } = readPlugin("p", dir, "untrusted", "r");
    expect(plugin.extensionEntries).toEqual([]);
    expect(findings).toEqual([]);
  });
});

test("missing or malformed package.json is an InfraError", () => {
  expect(() => readPlugin("p", tmpdir() + "/definitely-not-here", "untrusted", "r")).toThrow(InfraError);
  withPkg("{nope", dir => expect(() => readPlugin("p", dir, "untrusted", "r")).toThrow(InfraError));
});
