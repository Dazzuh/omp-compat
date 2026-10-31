import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { InfraError } from "./errors.ts";
import type { Finding, PluginUnderTest, Trust } from "./types.ts";

/** Reads package.json; `omp` wins over the legacy `pi` key. Missing package.json is an InfraError. */
export function readPlugin(
  id: string,
  root: string,
  trust: Trust,
  rev: string,
): { plugin: PluginUnderTest; findings: Finding[] } {
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) throw new InfraError(`package.json not found in ${root}`);
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (cause) {
    throw new InfraError(`package.json in ${root} is not valid JSON`, { cause });
  }
  const manifestKey = (["omp", "pi"] as const).find(k => typeof pkg[k] === "object" && pkg[k] !== null) ?? null;
  const manifest = manifestKey ? (pkg[manifestKey] as { extensions?: unknown }) : {};
  const declared = Array.isArray(manifest.extensions)
    ? manifest.extensions.filter((e): e is string => typeof e === "string")
    : [];
  const findings: Finding[] = [];
  if (manifestKey === null) {
    findings.push({
      check: "manifest",
      code: "manifest-missing",
      severity: "error",
      message: 'package.json has neither an "omp" nor a "pi" manifest key',
      file: "package.json",
    });
  }
  for (const entry of declared) {
    if (!existsSync(resolve(root, entry))) {
      findings.push({
        check: "manifest",
        code: "entry-not-found",
        severity: "error",
        message: `declared extension entry not found on disk: ${entry}`,
        file: entry,
      });
    }
  }
  const plugin: PluginUnderTest = {
    id,
    root: resolve(root),
    rev,
    trust,
    name: typeof pkg.name === "string" ? pkg.name : id,
    version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    manifestKey,
    extensionEntries: declared.map(e => resolve(root, e)),
  };
  return { plugin, findings };
}
