import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InfraError } from "../errors.ts";
import { missingArtifact, releasesBase } from "../upstream.ts";
import type { OmpVersion } from "../types.ts";

export function assetName(platform = process.platform, arch = process.arch): string {
  if (platform === "win32" && arch === "x64") return "omp-windows-x64.exe";
  if (platform === "linux" && arch === "x64") return "omp-linux-x64";
  throw new InfraError("Unsupported platform");
}

async function download(v: OmpVersion, url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  } catch (cause) {
    throw new InfraError(`GET ${url} failed`, { cause });
  }
  if (res.status === 404) await missingArtifact(v, url);
  if (!res.ok) throw new InfraError(`GET ${url} returned HTTP ${res.status}`);
  return res;
}

/** Downloads the release binary for v, verifies its SHA-256 against SHA256SUMS.txt, caches it. */
export async function ensureOmpBinary(v: OmpVersion, cacheDir: string): Promise<string> {
  const asset = assetName();
  const dir = join(cacheDir, "bin", v);
  const file = join(dir, asset);
  if (existsSync(join(dir, ".complete")) && existsSync(file)) return file;

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const base = `${releasesBase()}/v${v}`;
  const sums = await (await download(v, `${base}/SHA256SUMS.txt`)).text();
  const line = sums.split(/\r?\n/).find(l => l.trim().endsWith(` ${asset}`) || l.trim().endsWith(`*${asset}`));
  const expected = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected) throw new InfraError(`SHA256SUMS.txt for ${v} has no entry for ${asset}`);

  const part = file + ".part";
  try {
    await Bun.write(part, await download(v, `${base}/${asset}`));
    const actual = createHash("sha256").update(readFileSync(part)).digest("hex");
    if (actual !== expected) throw new InfraError(`SHA-256 mismatch for ${asset} ${v}: expected ${expected}, got ${actual}`);
    renameSync(part, file);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  if (process.platform !== "win32") chmodSync(file, 0o755);
  writeFileSync(join(dir, ".complete"), JSON.stringify({ version: v, asset, sha256: expected }));
  return file;
}
