import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { InfraError, UsageError } from "./errors.ts";
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
    kind: "package",
    manifestKey,
    extensionEntries: declared.map(e => resolve(root, e)),
  };
  return { plugin, findings };
}

const EXTENSION_FILE = /\.[cm]?[jt]s$/;

/**
 * Resolves a check target: a package directory (has package.json), an extension file (.js/.ts), or a directory
 * without package.json holding index.ts/index.js. The rev is filled in by the caller.
 */
export function readTarget(target: string, trust: Trust): PluginUnderTest {
  const abs = resolve(target);
  if (!existsSync(abs)) throw new InfraError(`check target not found: ${target}`);
  if (statSync(abs).isFile()) {
    if (!EXTENSION_FILE.test(abs)) throw new UsageError(`extension file must be .js or .ts: ${target}`);
    return extensionTarget(abs, dirname(abs), trust);
  }
  if (existsSync(join(abs, "package.json"))) return readPlugin(basename(abs), abs, trust, "").plugin;
  const index = ["index.ts", "index.js"].map(f => join(abs, f)).find(f => existsSync(f));
  if (!index) throw new UsageError(`${target} has neither package.json nor index.ts/index.js`);
  return extensionTarget(index, abs, trust);
}

function extensionTarget(entry: string, root: string, trust: Trust): PluginUnderTest {
  // Label only: a bare index.ts is named after its directory, or the directory above a generic "extension/".
  const stem = basename(entry).replace(EXTENSION_FILE, "");
  const dir = basename(dirname(entry));
  const generic = ["extension", "extensions", "src", "dist"].includes(dir);
  const id = stem !== "index" ? stem : generic ? basename(dirname(dirname(entry))) : dir;
  return {
    id,
    root: resolve(root),
    rev: "",
    trust,
    name: id,
    version: "0.0.0",
    kind: "extension",
    manifestKey: null,
    extensionEntries: [resolve(entry)],
  };
}
