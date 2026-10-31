import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InfraError, UpstreamPendingError } from "../src/errors.ts";
import { assetName, ensureOmpBinary } from "../src/provision/binary.ts";
import type { OmpVersion } from "../src/types.ts";
import { pendingDocs, stubRegistry } from "./stub-registry.ts";

const V = "99.0.0" as OmpVersion;
const body = "#!/bin/sh\necho fake omp\n";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const dirs: string[] = [];
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), "omp-compat-bin-"))), dirs.at(-1)!);
let stops: (() => void)[] = [];
afterEach(() => {
  stops.forEach(s => s());
  stops = [];
  delete process.env.OMP_COMPAT_NPM_REGISTRY;
  delete process.env.OMP_COMPAT_RELEASES_BASE;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Stub registry (publish age) plus stub releases server; `files` maps URL path to body. */
function stubs(ageHours: number, files: Record<string, string>) {
  const reg = stubRegistry(pendingDocs(ageHours));
  const rel = Bun.serve({
    port: 0,
    fetch: req => {
      const f = files[new URL(req.url).pathname];
      return f === undefined ? new Response("nope", { status: 404 }) : new Response(f);
    },
  });
  process.env.OMP_COMPAT_NPM_REGISTRY = reg.url;
  process.env.OMP_COMPAT_RELEASES_BASE = `http://127.0.0.1:${rel.port}`;
  stops.push(reg.stop, () => rel.stop(true));
}
const good = () => ({ [`/v99.0.0/${assetName()}`]: body, "/v99.0.0/SHA256SUMS.txt": `${sha(body)}  ${assetName()}\n` });

test("downloads, verifies and caches; corrupted cache without .complete is re-downloaded", async () => {
  stubs(1, good());
  const cache = tmp();
  const file = await ensureOmpBinary(V, cache);
  expect(readFileSync(file, "utf8")).toBe(body);
  writeFileSync(file, "corrupted");
  rmSync(join(cache, "bin", V, ".complete"));
  expect(readFileSync(await ensureOmpBinary(V, cache), "utf8")).toBe(body);
});

test("checksum mismatch -> InfraError and no file left behind", async () => {
  stubs(1, { ...good(), "/v99.0.0/SHA256SUMS.txt": `${sha("other")}  ${assetName()}\n` });
  const cache = tmp();
  const err = await ensureOmpBinary(V, cache).catch(e => e);
  expect(err).toBeInstanceOf(InfraError);
  expect(err.message).toContain("SHA-256 mismatch");
  expect(existsSync(join(cache, "bin", V))).toBe(false);
});

test("asset 404 within 48h of publish -> UpstreamPendingError", async () => {
  stubs(1, { "/v99.0.0/SHA256SUMS.txt": good()["/v99.0.0/SHA256SUMS.txt"]! });
  const err = await ensureOmpBinary(V, tmp()).catch(e => e);
  expect(err).toBeInstanceOf(UpstreamPendingError);
  expect(err.missing).toEndWith(`/v99.0.0/${assetName()}`);
});

test("asset 404 after 48h -> InfraError", async () => {
  stubs(72, { "/v99.0.0/SHA256SUMS.txt": good()["/v99.0.0/SHA256SUMS.txt"]! });
  expect(await ensureOmpBinary(V, tmp()).catch(e => e)).toBeInstanceOf(InfraError);
});

test("SHA256SUMS.txt 404 follows the same rule", async () => {
  stubs(1, {});
  expect(await ensureOmpBinary(V, tmp()).catch(e => e)).toBeInstanceOf(UpstreamPendingError);
});

test("unsupported platform", () => {
  expect(() => assetName("darwin", "arm64")).toThrow("Unsupported platform");
});

const real = join(tmpdir(), "omp-compat-test-cache");
test("real release: 18.14.2 binary reports its version", async () => {
  const file = await ensureOmpBinary("18.14.2" as OmpVersion, real);
  const out = Bun.spawnSync([file, "--version"]).stdout.toString().trim();
  expect(out).toBe("omp/18.14.2");
}, 300_000);
