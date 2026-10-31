import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
/** Shared with the other tests so host packages and binaries download once. */
export const SHARED_CACHE = join(tmpdir(), "omp-compat-test-cache");

export const tmpDir = () => mkdtempSync(join(tmpdir(), "omp-compat-e2e-"));
export const writeJson = (file: string, data: unknown) => writeFileSync(file, JSON.stringify(data, null, 2));

/** Async: in-process stub servers must keep serving while the child runs. */
export async function cli(args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, OMP_COMPAT_CACHE: SHARED_CACHE, OMP_COMPAT_DISPOSABLE_RUNNER: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
