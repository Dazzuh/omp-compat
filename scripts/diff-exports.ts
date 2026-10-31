#!/usr/bin/env bun
/**
 * Finds a real published OMP API removal for the regression drill.
 *
 *   bun scripts/diff-exports.ts <pkg> <vA> <vB>   exports removed between two versions
 *   bun scripts/diff-exports.ts --search          the drill search (prints JSON)
 *
 * Search order: pi-coding-agent then pi-tui, 18.0.0 -> 18.14.2, first removed value export
 * (alphabetical), bisected to the adjacent published pair; else the first removed dist/types
 * module file as a namespace import; else the same over 17.x -> 18.0.0.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { cacheRoot } from "../src/cache.ts";
import { ensureNpmHost } from "../src/provision/npm.ts";
import { packument } from "../src/versions.ts";
import type { OmpVersion } from "../src/types.ts";

const cache = cacheRoot();
const SCOPE = "@oh-my-pi";

async function typesDir(pkg: string, v: string): Promise<string | null> {
  const host = await ensureNpmHost(v as OmpVersion, cache);
  const dir = join(host, "node_modules", SCOPE, pkg, "dist", "types");
  return existsSync(dir) ? dir : null;
}

function valueExports(indexDts: string): Set<string> {
  const program = ts.createProgram([indexDts], { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true, types: [] });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(indexDts);
  const sym = sf && checker.getSymbolAtLocation(sf);
  const out = new Set<string>();
  if (!sym) return out;
  for (const e of checker.getExportsOfModule(sym)) {
    const target = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e;
    if (target.flags & ts.SymbolFlags.Value) out.add(e.name);
  }
  return out;
}

function moduleFiles(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".d.ts")) out.add(relative(dir, p).replaceAll("\\", "/"));
    }
  };
  walk(dir);
  return out;
}

async function exportsAt(pkg: string, v: string): Promise<Set<string> | null> {
  const dir = await typesDir(pkg, v);
  const index = dir && join(dir, "index.d.ts");
  return index && existsSync(index) ? valueExports(index) : null;
}

async function filesAt(pkg: string, v: string): Promise<Set<string> | null> {
  const dir = await typesDir(pkg, v);
  return dir ? moduleFiles(dir) : null;
}

async function published(): Promise<string[]> {
  const doc = await packument(`${SCOPE}/pi-coding-agent`);
  return Object.keys(doc?.versions ?? {})
    .filter(v => !v.includes("-"))
    .sort((a, b) => Bun.semver.order(a, b));
}

/** Smallest adjacent pair (old, new) in `vs` where present(old) and !present(new); assumes monotonic removal. */
async function bisect(vs: string[], present: (v: string) => Promise<boolean>): Promise<[string, string]> {
  let lo = 0;
  let hi = vs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (await present(vs[mid]!)) lo = mid;
    else hi = mid;
  }
  return [vs[lo]!, vs[hi]!];
}

async function diff(pkg: string, a: string, b: string) {
  const [ea, eb] = [await exportsAt(pkg, a), await exportsAt(pkg, b)];
  const [fa, fb] = [await filesAt(pkg, a), await filesAt(pkg, b)];
  return {
    removedExports: ea && eb ? [...ea].filter(n => !eb.has(n)).sort() : null,
    removedFiles: fa && fb ? [...fa].filter(n => !fb.has(n)).sort() : null,
  };
}

async function search() {
  const all = await published();
  const ranges: [string, string][] = [["18.0.0", "18.14.2"], [all.find(v => v.startsWith("17."))!, "18.0.0"]];
  for (const [from, to] of ranges) {
    const vs = all.filter(v => Bun.semver.order(v, from) >= 0 && Bun.semver.order(v, to) <= 0);
    for (const pkg of ["pi-coding-agent", "pi-tui"]) {
      const d = await diff(pkg, from, to);
      console.error(`${pkg} ${from} -> ${to}: ${d.removedExports?.length ?? "n/a"} removed value exports, ${d.removedFiles?.length ?? "n/a"} removed files`);
      const name = d.removedExports?.[0];
      if (name) {
        const [oldV, newV] = await bisect(vs, async v => (await exportsAt(pkg, v))?.has(name) ?? false);
        return { specifier: `${SCOPE}/${pkg}`, binding: name, form: "named", old: oldV, new: newV, searched: { pkg, from, to } };
      }
    }
    for (const pkg of ["pi-coding-agent", "pi-tui"]) {
      const d = await diff(pkg, from, to);
      const file = d.removedFiles?.[0];
      if (file) {
        const sub = file.replace(/\.d\.ts$/, "").replace(/\/index$/, "");
        const [oldV, newV] = await bisect(vs, async v => (await filesAt(pkg, v))?.has(file) ?? false);
        return { specifier: `${SCOPE}/${pkg}/${sub}`, binding: null, form: "namespace", old: oldV, new: newV, searched: { pkg, from, to } };
      }
    }
  }
  return null;
}

const [a, b, c] = process.argv.slice(2);
if (a === "--search") {
  const r = await search();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r ? 0 : 1);
} else if (a && b && c) {
  console.log(JSON.stringify(await diff(a.replace(`${SCOPE}/`, ""), b, c), null, 2));
} else {
  console.error("usage: diff-exports.ts <pkg> <vA> <vB> | --search");
  process.exit(2);
}
