import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InfraError } from "../errors.ts";
import { isolatedEnv, killTree } from "../isolation.ts";
import { ensureOmpBinary } from "../provision/binary.ts";
import type { Check, Finding } from "../types.ts";
import { probeExtension } from "./ext-load.ts";

const INSTALL_TIMEOUT_MS = 180_000;
const LOAD_FAILED = /^(.+): Failed to load extension: (.+)$/;
const ENTRY_NOT_FOUND = /^(.+): declared extension entry not found on disk$/;

const git = (args: string[], cwd: string) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=omp-compat", "-c", "user.email=omp-compat@invalid", ...args], {
    cwd,
    windowsHide: true,
  });
  if (r.exitCode !== 0) throw new InfraError(`git ${args[0]} failed: ${r.stderr.toString().slice(-300)}`);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open(s) { s.end(); } } });
      sock.end();
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new InfraError(`git daemon did not start listening on port ${port}`);
}

/** Strips the isolated-home install prefix so findings name files relative to the plugin. */
function relativeToPlugin(p: string): string {
  const m = /node_modules[\\/][^\\/]+[\\/](.*)$/.exec(p.replace(/\?mtime=\d+$/, ""));
  return (m?.[1] ?? p).replaceAll("\\", "/"); // omp reports the host path style
}

/** Maps `omp plugin install` stderr to findings (design: load-failed, entry-not-found, install-failed). */
export function parseInstallFailure(stderr: string): Finding[] {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const findings: Finding[] = [];
  for (const line of lines) {
    const load = LOAD_FAILED.exec(line);
    const entry = ENTRY_NOT_FOUND.exec(line);
    if (load) {
      findings.push({
        check: "omp-load",
        code: "load-failed",
        severity: "error",
        file: relativeToPlugin(load[1]!),
        message: load[2]!.replace(/\?mtime=\d+/g, ""),
      });
    } else if (entry) {
      findings.push({
        check: "omp-load",
        code: "entry-not-found",
        severity: "error",
        file: entry[1]!,
        message: "declared extension entry not found on disk",
      });
    }
  }
  if (findings.length) return findings;
  return [{ check: "omp-load", code: "install-failed", severity: "error", message: lines.slice(-20).join("\n") }];
}

/**
 * Packaged plugins: installs the plugin with the omp binary in an isolated home and reports what omp reports.
 * The plugin is delivered as a git:// spec from a loopback \`git daemon\`: omp only validates extension
 * entries for npm and git specs, and rejects file: and git+file: forms (see S1's Decision).
 * Extension files: loads the file itself through omp's RPC mode (see ext-load.ts).
 * The isolated HOME is not a sandbox: this check executes plugin code.
 */
export const ompLoadCheck: Check = async ({ plugin, omp, cacheDir, ompBinary, expectCommands = [] }) => {
  const bin = ompBinary ?? (await ensureOmpBinary(omp, cacheDir));
  if (plugin.kind === "extension") {
    return probeExtension({ bin, root: plugin.root, entry: plugin.extensionEntries[0]!, expectCommands });
  }
  const home = mkdtempSync(join(tmpdir(), "omp-compat-home-"));
  const srv = mkdtempSync(join(tmpdir(), "omp-compat-srv-"));
  let daemon: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const name = plugin.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const repo = join(srv, "work");
    cpSync(plugin.root, repo, { recursive: true, filter: s => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s) });
    mkdirSync(join(srv, "srv", "fx"), { recursive: true });
    git(["init", "-q", "-b", "main"], repo);
    writeFileSync(join(repo, ".omp-compat-keep"), ""); // never commit an empty tree
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "plugin"], repo);
    git(["clone", "-q", "--bare", repo, join(srv, "srv", "fx", `${name}.git`)], srv);

    const port = await freePort();
    daemon = Bun.spawn(
      ["git", "daemon", "--reuseaddr", "--export-all", "--listen=127.0.0.1", `--port=${port}`, `--base-path=${join(srv, "srv")}`, join(srv, "srv")],
      { stdout: "ignore", stderr: "ignore", windowsHide: true },
    );
    await waitForPort(port, 10_000);

    const proc = Bun.spawn([bin, "plugin", "install", `git://127.0.0.1:${port}/fx/${name}.git`], {
      cwd: home,
      env: isolatedEnv(home),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
      timeout: INSTALL_TIMEOUT_MS,
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (proc.signalCode) throw new InfraError(`omp plugin install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`);
    return code === 0 ? [] : parseInstallFailure(stderr);
  } finally {
    if (daemon) killTree(daemon);
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
    rmSync(srv, { recursive: true, force: true, maxRetries: 5 });
  }
};
