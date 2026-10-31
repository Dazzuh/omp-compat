import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { CHECK_ORDER } from "./checks/index.ts";
import { UsageError } from "./errors.ts";
import type { CheckId, FindingCode, Trust } from "./types.ts";

export interface ExpectedFinding {
  check: CheckId;
  code: FindingCode;
  specifier?: string;
}
export interface CorpusEntry {
  id: string;
  trust: Trust;
  source: { path: string } | { git: string; rev: string };
  baseline?: string;
  versions?: string[];
  expect?: "pass" | "fail";
  expectFindings?: ExpectedFinding[];
}
export interface VersionsFile {
  baseline: string;
  pinned: string[];
}

/** The repo root: trusted entries may only point inside its fixtures/ and test/drill/. */
export const REPO_ROOT = resolve(import.meta.dir, "..");
const TRUSTED_DIRS = ["fixtures", "test/drill"].map(d => resolve(REPO_ROOT, d));

export function resolveSourcePath(p: string): string {
  return resolve(REPO_ROOT, p);
}

function inside(dir: string, p: string): boolean {
  const rel = relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(":") && !rel.startsWith(sep));
}

function readJson(file: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new UsageError(`cannot read ${what} ${file}: ${(cause as Error).message}`);
  }
}

export function readVersions(file: string): VersionsFile {
  const v = readJson(file, "versions file") as Partial<VersionsFile>;
  if (typeof v?.baseline !== "string" || !Array.isArray(v.pinned) || !v.pinned.every(p => typeof p === "string")) {
    throw new UsageError(`${file}: expected { "baseline": string, "pinned": string[] }`);
  }
  return v as VersionsFile;
}

export function readCorpus(file: string): CorpusEntry[] {
  const raw = readJson(file, "corpus");
  if (!Array.isArray(raw)) throw new UsageError(`${file}: corpus must be an array`);
  const ids = new Set<string>();
  return raw.map((e: any, i) => {
    const id = typeof e?.id === "string" && e.id ? e.id : undefined;
    if (!id) throw new UsageError(`${file}: entry #${i} has no id`);
    const bad = (msg: string): never => {
      throw new UsageError(`corpus entry "${id}": ${msg}`);
    };
    if (ids.has(id)) bad("duplicate id");
    ids.add(id);
    if (e.trust !== "trusted" && e.trust !== "untrusted") bad('"trust" must be "trusted" or "untrusted"');
    const src = e.source;
    const isPath = typeof src?.path === "string";
    const isGit = typeof src?.git === "string" && typeof src?.rev === "string";
    if (isPath === isGit) bad('"source" must be {"path"} or {"git","rev"}');
    if (e.trust === "trusted") {
      if (isGit) bad("trusted entries must be local paths under fixtures/ or test/drill/, not git sources");
      if (!TRUSTED_DIRS.some(d => inside(d, resolveSourcePath(src.path)))) {
        bad(`trusted source path ${src.path} is outside fixtures/ and test/drill/`);
      }
    }
    if (e.expect !== undefined && e.expect !== "pass" && e.expect !== "fail") bad('"expect" must be "pass" or "fail"');
    for (const f of e.expectFindings ?? []) {
      if (!CHECK_ORDER.includes(f?.check) || typeof f?.code !== "string") bad("invalid expectFindings entry");
    }
    if (e.versions !== undefined && !(Array.isArray(e.versions) && e.versions.every((v: unknown) => typeof v === "string"))) {
      bad('"versions" must be a string array');
    }
    return e as CorpusEntry;
  });
}
