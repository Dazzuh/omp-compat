import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { ensureNpmHost } from "../provision/npm.ts";
import type { Check, Finding } from "../types.ts";

// Host specifier matching and remaps mirror legacy-pi-compat.ts:801-857@v18.14.2.
const HOST_SPECIFIER =
  /^@(?:oh-my-pi|mariozechner|earendil-works)\/(pi-agent-core|pi-ai|pi-catalog|pi-coding-agent|pi-natives|pi-tui|pi-utils)(\/.*)?$/;
const REMAPS: Record<string, string> = { "pi-ai/utils/oauth": "pi-ai/oauth", "pi-ai/compat": "pi-ai" };

const PROBES = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.js"];
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

export interface HostImport {
  file: string; // relative to plugin root, forward slashes
  line: number; // 1-based
  specifier: string; // as written
  probeSpecifier: string; // normalized to @oh-my-pi and remapped
  typeOnly: boolean;
  names: { name: string; typeOnly: boolean }[]; // original (pre-alias) names
  hasDefault: boolean;
  namespace: boolean; // namespace, dynamic, export-star or side-effect form
}

export function normalizeHostSpecifier(spec: string): string | null {
  const m = HOST_SPECIFIER.exec(spec);
  if (!m) return null;
  const sub = `${m[1]}${m[2] ?? ""}`;
  return `@oh-my-pi/${REMAPS[sub] ?? sub}`;
}

function resolveLocal(from: string, spec: string, root: string): string | null {
  const base = resolve(dirname(from), spec);
  const inRoot = (p: string) => p === root || p.startsWith(root + sep);
  if (!inRoot(base)) return null;
  const candidates = PROBES.map(p => resolve(base + p)); // resolve() keeps the seen-set keys canonical
  // TypeScript sources commonly import "./x.js" for x.ts.
  if (/\.js$/.test(base)) candidates.push(resolve(base.replace(/\.js$/, ".ts")));
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && CODE_EXT.test(c) && inRoot(c)) return c;
  }
  return null;
}

/** Walks the local module graph from the entries and collects every host import. */
export function collectHostImports(root: string, entries: string[]): HostImport[] {
  root = resolve(root);
  const out: HostImport[] = [];
  const seen = new Set<string>();
  const queue = entries.filter(e => existsSync(e));
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!CODE_EXT.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const rel = relative(root, file).split(sep).join("/");
    const visit = (spec: string, node: ts.Node, shape: Partial<HostImport>) => {
      const probeSpecifier = normalizeHostSpecifier(spec);
      if (probeSpecifier) {
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          specifier: spec,
          probeSpecifier,
          typeOnly: false,
          names: [],
          hasDefault: false,
          namespace: false,
          ...shape,
        });
      } else if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec, root);
        if (next) queue.push(next);
      }
    };
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const c = node.importClause;
        const bindings = c?.namedBindings;
        visit(node.moduleSpecifier.text, node, {
          typeOnly: c?.isTypeOnly ?? false,
          hasDefault: !!c?.name,
          namespace: !c || (!!bindings && ts.isNamespaceImport(bindings)),
          names:
            bindings && ts.isNamedImports(bindings)
              ? bindings.elements.map(e => ({ name: (e.propertyName ?? e.name).text, typeOnly: e.isTypeOnly }))
              : [],
        });
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const ex = node.exportClause;
        visit(node.moduleSpecifier.text, node, {
          typeOnly: node.isTypeOnly,
          namespace: !ex || ts.isNamespaceExport(ex),
          names: ex && ts.isNamedExports(ex) ? ex.elements.map(e => ({ name: (e.propertyName ?? e.name).text, typeOnly: e.isTypeOnly })) : [],
        });
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        visit(node.arguments[0].text, node, { namespace: true });
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return out;
}

interface ProbeOrigin {
  imp: HostImport;
}

function buildProbe(imports: HostImport[]): { text: string; origins: ProbeOrigin[] } {
  const lines: string[] = [];
  const origins: ProbeOrigin[] = [];
  const push = (line: string, imp: HostImport) => (lines.push(line), origins.push({ imp }));
  imports.forEach((imp, i) => {
    const spec = JSON.stringify(imp.probeSpecifier);
    const t = imp.typeOnly ? "type " : "";
    if (imp.hasDefault) push(`import ${t}__d${i} from ${spec};`, imp);
    if (imp.names.length) {
      const list = imp.names.map(n => `${n.typeOnly && !imp.typeOnly ? "type " : ""}${n.name}`).join(", ");
      push(`import ${t}{ ${list} } from ${spec};`, imp);
    }
    if (imp.namespace) push(`import * as __n${i} from ${spec};`, imp);
  });
  return { text: lines.join("\n") + "\n", origins };
}

const EXPORT_NOT_FOUND = new Set([2305, 2614, 2724, 1192, 2613]);

export const hostImportsCheck: Check = async ({ plugin, omp, cacheDir }) => {
  const imports = collectHostImports(plugin.root, plugin.extensionEntries);
  if (imports.length === 0) return [];
  const host = await ensureNpmHost(omp, cacheDir);
  const { text, origins } = buildProbe(imports);
  const probeDir = join(host, "probes");
  mkdirSync(probeDir, { recursive: true });
  const probe = join(probeDir, `${createHash("sha1").update(plugin.root + omp).digest("hex")}.ts`);
  writeFileSync(probe, text);
  try {
    const program = ts.createProgram([probe], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      allowImportingTsExtensions: true,
    });
    const sf = program.getSourceFile(probe)!;
    const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    const findings: Finding[] = [];
    for (const d of diags) {
      if (d.start === undefined) continue;
      const origin = origins[sf.getLineAndCharacterOfPosition(d.start).line]?.imp;
      if (!origin) continue;
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const base = { check: "host-imports" as const, file: origin.file, line: origin.line, specifier: origin.specifier };
      if (d.code === 2307) {
        findings.push({ ...base, code: "module-not-found", severity: "error", message: `host module not found in OMP ${omp}: ${origin.probeSpecifier}` });
      } else if (EXPORT_NOT_FOUND.has(d.code)) {
        // The diagnostic span is the imported identifier; default-import problems have no named binding.
        const binding = d.code === 1192 || d.code === 2613 ? "default" : sf.text.substr(d.start, d.length);
        findings.push({ ...base, code: "export-not-found", severity: "error", binding, message: `${origin.probeSpecifier} has no export "${binding}" in OMP ${omp}` });
      } else {
        findings.push({ ...base, code: "host-import-unverified", severity: "warning", message: `TS${d.code}: ${message}` });
      }
    }
    return findings;
  } finally {
    rmSync(probe, { force: true });
  }
};
