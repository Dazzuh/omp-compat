import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InfraError, UpstreamPendingError } from "../src/errors.ts";
import { ensureNpmHost } from "../src/provision/npm.ts";
import type { OmpVersion } from "../src/types.ts";
import { pendingDocs, stubRegistry } from "./stub-registry.ts";

const dirs: string[] = [];
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), "omp-compat-npm-"))), dirs.at(-1)!);
let stop = () => {};
afterEach(() => {
  stop();
  stop = () => {};
  delete process.env.OMP_COMPAT_NPM_REGISTRY;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}, 120_000); // removing a node_modules tree is slow on Windows
const use = (docs: Record<string, unknown>, status?: number) => {
  const s = stubRegistry(docs, status);
  process.env.OMP_COMPAT_NPM_REGISTRY = s.url;
  stop = s.stop;
};

test("unpublished dependency, release 1h old -> UpstreamPendingError naming it", async () => {
  use(pendingDocs(1));
  const err = await ensureNpmHost("99.0.0" as OmpVersion, tmp()).catch(e => e);
  expect(err).toBeInstanceOf(UpstreamPendingError);
  expect(err.missing).toBe("@oh-my-pi/pi-tui@^99.0.0");
});

test("unpublished dependency, release 72h old -> InfraError", async () => {
  use(pendingDocs(72));
  const err = await ensureNpmHost("99.0.0" as OmpVersion, tmp()).catch(e => e);
  expect(err).toBeInstanceOf(InfraError);
  expect(err.message).toContain("still missing 48h after npm publish of 99.0.0");
});

test("registry 503 -> InfraError", async () => {
  use({}, 503);
  expect(await ensureNpmHost("99.0.0" as OmpVersion, tmp()).catch(e => e)).toBeInstanceOf(InfraError);
});

test("real npm: installs 18.14.2 host types and is idempotent", async () => {
  const cache = tmp();
  const dts = (d: string) => join(d, "node_modules", "@oh-my-pi", "pi-tui", "dist", "types", "index.d.ts");
  const dir = await ensureNpmHost("18.14.2" as OmpVersion, cache);
  expect(existsSync(dts(dir))).toBe(true);
  const t = performance.now();
  expect(await ensureNpmHost("18.14.2" as OmpVersion, cache)).toBe(dir);
  const ms = performance.now() - t;
  console.log(`second ensureNpmHost call: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(1000);
}, 300_000);
