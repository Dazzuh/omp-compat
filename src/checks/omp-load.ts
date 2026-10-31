import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { InfraError } from "../errors.ts";
import { ensureOmpBinary } from "../provision/binary.ts";
import type { Check, Finding } from "../types.ts";

const INSTALL_TIMEOUT_MS = 180_000;
const LOAD_FAILED = /^(.+): Failed to load extension: (.+)$/;
const ENTRY_NOT_FOUND = /^(.+): declared extension entry not found on disk$/;

const git = (args: string[], cwd: string) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=omp-compat", "-c", "user.email=omp-compat@invalid", ...args], { cwd });
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

function killTree(proc: { pid: number; kill(): void }) {
  if (process.platform === "win32") Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/T", "/F"]);
  else proc.kill();
}

/** Strips the isolated-home install prefix so findings name files relative to the plugin. */
function relativeToPlugin(p: string): string {
  const m = /node_modules[\\/][^\\/]+[\\/](.*)$/.exec(p.replace(/\?mtime=\d+$/, ""));
  return (m?.[1] ?? p).split(sep).join("/");
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
 * Installs the plugin with the real omp release binary in an isolated home and reports what omp reports.
 * The plugin is delivered as a git:// spec from a loopback \`git daemon\`: omp only validates extension
 * entries for npm and git specs, and rejects file: and git+file: forms (see S1's Decision).
 * The isolated HOME is not a sandbox: this check executes plugin code.
 */
export const ompLoadCheck: Check = async ({ plugin, omp, cacheDir }) => {
  const bin = await ensureOmpBinary(omp, cacheDir);
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
      { stdout: "ignore", stderr: "ignore" },
    );
    await waitForPort(port, 10_000);

    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      PI_CODING_AGENT_DIR: join(home, ".omp", "agent"),
      BUN_INSTALL_CACHE_DIR: join(home, ".bun-cache"), // omp shells out to bun; keep its global cache out of the real home
    };
    delete env.PI_PROFILE;
    const proc = Bun.spawn([bin, "plugin", "install", `git://127.0.0.1:${port}/fx/${name}.git`], {
      cwd: home,
      env,
      stdout: "pipe",
      stderr: "pipe",
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
