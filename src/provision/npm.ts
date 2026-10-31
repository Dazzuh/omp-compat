import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { InfraError } from "../errors.ts";
import { missingArtifact, npmRegistry } from "../upstream.ts";
import { packument } from "../versions.ts";
import type { OmpVersion } from "../types.ts";

const SCOPE = "@oh-my-pi";
const HOST_PACKAGES = ["pi-agent-core", "pi-ai", "pi-catalog", "pi-coding-agent", "pi-natives", "pi-tui", "pi-utils"];

async function bunAdd(dir: string, spec: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "add", "--ignore-scripts", spec], {
    cwd: dir,
    env: { ...process.env, NPM_CONFIG_REGISTRY: npmRegistry() },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { ok: code === 0, stderr };
}

/**
 * Installs @oh-my-pi/pi-coding-agent@v plus any host package it does not pull in, into
 * <cache>/npm/<v>. Packages OMP does not publish at v are recorded as absent.
 */
export async function ensureNpmHost(v: OmpVersion, cacheDir: string): Promise<string> {
  const final = join(cacheDir, "npm", v);
  if (existsSync(join(final, ".complete"))) return final;

  const doc = await packument(`${SCOPE}/pi-coding-agent`);
  const deps = doc?.versions?.[v]?.dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (!name.startsWith(`${SCOPE}/`)) continue;
    const dep = await packument(name);
    const published = Object.keys(dep?.versions ?? {});
    if (!published.some(p => Bun.semver.satisfies(p, range))) await missingArtifact(v, `${name}@${range}`);
  }

  const tmp = join(cacheDir, "npm", `.tmp-${v}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "omp-compat-host", private: true }));
    const main = await bunAdd(tmp, `${SCOPE}/pi-coding-agent@${v}`);
    if (!main.ok) throw new InfraError(`bun add ${SCOPE}/pi-coding-agent@${v} failed: ${main.stderr.slice(-400)}`);
    const absent: string[] = [];
    for (const pkg of HOST_PACKAGES) {
      if (existsSync(join(tmp, "node_modules", SCOPE, pkg))) continue;
      const r = await bunAdd(tmp, `${SCOPE}/${pkg}@${v}`);
      if (r.ok) continue;
      if (/404|not found/i.test(r.stderr)) absent.push(pkg);
      else throw new InfraError(`bun add ${SCOPE}/${pkg}@${v} failed: ${r.stderr.slice(-400)}`);
    }
    const installed = readdirSync(join(tmp, "node_modules", SCOPE));
    writeFileSync(join(tmp, ".complete"), JSON.stringify({ version: v, installed, absent }, null, 2));
    rmSync(final, { recursive: true, force: true });
    renameSync(tmp, final);
    return final;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
