import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InfraError, UsageError } from "../src/errors.ts";
import { parseBinaryVersion } from "../src/provision/binary.ts";
import { npmVersion } from "../src/provision/npm.ts";
import { readTarget } from "../src/plugin.ts";
import { parseCommandsResponse, parseLoadFailures } from "../src/checks/ext-load.ts";
import type { OmpVersion } from "../src/types.ts";

const fx = (n: string) => join(import.meta.dir, "..", "fixtures", n);
const v = (s: string) => s as OmpVersion;

describe("--omp-binary version", () => {
  test("parses the fork's build version, build metadata kept", () => {
    expect<string | undefined>(parseBinaryVersion("omp/18.20.0+dz.1\n")).toBe("18.20.0+dz.1");
    expect<string | undefined>(parseBinaryVersion("omp/18.19.0+dz.3")).toBe("18.19.0+dz.3");
  });
  test("rejects anything else", () => {
    expect<string | undefined>(parseBinaryVersion("18.20.0")).toBeUndefined();
    expect<string | undefined>(parseBinaryVersion("omp/latest")).toBeUndefined();
    expect<string | undefined>(parseBinaryVersion("")).toBeUndefined();
  });
  test("npm host version drops build metadata", () => {
    expect<string>(npmVersion(v("18.20.0+dz.1"))).toBe("18.20.0");
    expect<string>(npmVersion(v("18.14.2"))).toBe("18.14.2");
  });
});

describe("check targets", () => {
  test("extension directory with index.ts: no manifest, entry is the file", () => {
    const p = readTarget(fx("ext-good"), "untrusted");
    expect(p).toMatchObject({ kind: "extension", id: "ext-good", manifestKey: null });
    expect(p.extensionEntries).toEqual([join(fx("ext-good"), "index.ts")]);
    expect(p.root).toBe(fx("ext-good"));
  });
  test("extension file: root is its directory", () => {
    const p = readTarget(join(fx("ext-good"), "index.ts"), "untrusted");
    expect(p).toMatchObject({ kind: "extension", id: "ext-good", root: fx("ext-good") });
    expect(p.extensionEntries).toEqual([join(fx("ext-good"), "index.ts")]);
  });
  test("package directory is still a package", () => {
    expect(readTarget(fx("good"), "untrusted")).toMatchObject({ kind: "package", manifestKey: "omp" });
  });
  test("generic extension/index.ts is named after its package directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-compat-target-"));
    mkdirSync(join(dir, "doc-skills", "extension"), { recursive: true });
    writeFileSync(join(dir, "doc-skills", "extension", "index.ts"), "export default {};");
    expect(readTarget(join(dir, "doc-skills", "extension", "index.ts"), "untrusted").id).toBe("doc-skills");
  });
  test("index.js directory and a bare .js file", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-compat-target-"));
    mkdirSync(join(dir, "hq-run"));
    writeFileSync(join(dir, "hq-run", "index.js"), "export default {};");
    writeFileSync(join(dir, "omp-live.js"), "export default {};");
    expect(readTarget(join(dir, "hq-run"), "untrusted").extensionEntries).toEqual([join(dir, "hq-run", "index.js")]);
    expect(readTarget(join(dir, "omp-live.js"), "untrusted")).toMatchObject({ id: "omp-live", kind: "extension" });
  });
  test("unusable targets", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-compat-target-"));
    writeFileSync(join(dir, "notes.txt"), "x");
    expect(() => readTarget(join(dir, "notes.txt"), "untrusted")).toThrow(UsageError);
    expect(() => readTarget(dir, "untrusted")).toThrow(UsageError);
    expect(() => readTarget(join(dir, "absent"), "untrusted")).toThrow(InfraError);
  });
});

describe("load-failure mapping", () => {
  const root = fx("ext-broken");
  test("RPC stderr form: path relative to the extension root, error kept", () => {
    const out = `Failed to load extension ${join(root, "index.ts").replaceAll("\\", "/")}: Failed to load extension: omp-compat ext-broken: thrown on import`;
    expect(parseLoadFailures(out, root)).toEqual([
      { check: "omp-load", code: "load-failed", severity: "error", file: "index.ts", message: "omp-compat ext-broken: thrown on import" },
    ]);
  });
  test("models/install stderr form", () => {
    const out = `Failed to load extension: C:/x/y/index.ts: Failed to load extension: Cannot find package 'z' imported from C:/x/y/index.ts?mtime=12`;
    const [f] = parseLoadFailures(out, "C:/x/y");
    expect(f).toMatchObject({ code: "load-failed", file: "index.ts", message: "Cannot find package 'z' imported from C:/x/y/index.ts" });
  });
  test("unrecognised failure line is kept whole; unrelated lines are ignored", () => {
    const f = parseLoadFailures("Failed to load extension: weird\nno problem here", root);
    expect(f).toEqual([{ check: "omp-load", code: "load-failed", severity: "error", file: undefined, message: "Failed to load extension: weird" }]);
  });
});

describe("RPC get_available_commands response", () => {
  test("finds the probe response among events", () => {
    const out = [
      '{"type":"ready","protocolVersion":1}',
      '{"type":"response","id":"omp-compat-probe","command":"get_available_commands","success":true,"data":{"commands":[{"name":"security"},{"name":"omp-compat-good"}]}}',
    ].join("\n");
    expect(parseCommandsResponse(out)).toEqual({ success: true, names: ["security", "omp-compat-good"] });
  });
  test("no response", () => {
    expect(parseCommandsResponse('{"type":"ready"}\nnot json')).toBeUndefined();
  });
});
