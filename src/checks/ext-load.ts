import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { InfraError } from "../errors.ts";
import { isolatedEnv, killTree } from "../isolation.ts";
import type { Finding } from "../types.ts";

export const PROBE_TIMEOUT_MS = 120_000;
// Time for omp's pending stderr writes to reach the pipe before the tree is killed after the response.
const FLUSH_GRACE_MS = 500;
// Daemons an extension starts from its own state dir (kata auto-starts one that outlives its CLI). Each entry:
// [state dir under the probe HOME, stop command], run with the probe env. Best effort: a missing tool stops nothing.
const DAEMON_STOPS: [string, string[]][] = [[".kata", ["kata", "daemon", "stop"]]];
const PROBE_ID = "omp-compat-probe";
// Dummy key: with no provider configured RPC mode exits before it can list commands. No request is made.
const PLACEHOLDER_KEY = "omp-compat-placeholder";
// omp prints `Failed to load extension <path>: …` (RPC) or `Failed to load extension: <path>: …` (models, install).
const LOAD_FAILED = /Failed to load extension:? (.+?):\s+Failed to load extension:\s+(.+)$/;

/** Maps omp's "Failed to load extension" lines (any stream) to load-failed findings, paths relative to root. */
export function parseLoadFailures(output: string, root: string): Finding[] {
  const findings: Finding[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes("Failed to load extension")) continue;
    const m = LOAD_FAILED.exec(line);
    findings.push({
      check: "omp-load",
      code: "load-failed",
      severity: "error",
      file: m ? relativeTo(root, m[1]!) : undefined,
      message: (m ? m[2]! : line).replace(/\?mtime=\d+/g, ""),
    });
  }
  return findings;
}

function relativeTo(root: string, path: string): string {
  const rel = relative(resolve(root), resolve(path));
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : path;
}

/** The get_available_commands response with id PROBE_ID, or undefined when omp never answered it. */
export function parseCommandsResponse(stdout: string): { success: boolean; names: string[] } | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let msg: { type?: string; id?: string; success?: boolean; data?: { commands?: { name?: string }[] } };
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "response" && msg.id === PROBE_ID) {
      const names = (msg.data?.commands ?? []).map(c => c.name ?? "");
      return { success: msg.success === true, names };
    }
  }
  return undefined;
}

/** Reads stdout until the probe response is in, or the stream ends. */
async function readUntilResponse(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    if (parseCommandsResponse(text)) break;
  }
  return text;
}

/**
 * Loads one extension file in the real omp binary (RPC mode, no ambient extensions, no model call) and reports
 * what omp reports: load failures from stderr, and expected commands missing from the registered command list.
 * Once the response is in, omp's whole process tree is killed: an extension may start helpers (a kata daemon, an
 * event tail) that outlive omp otherwise and keep the probe home locked.
 */
export async function probeExtension(opts: {
  bin: string;
  root: string;
  entry: string;
  expectCommands: readonly string[];
}): Promise<Finding[]> {
  const home = mkdtempSync(join(tmpdir(), "omp-compat-ext-"));
  const env = isolatedEnv(home);
  for (const key of Object.keys(env)) if (/_(API_KEY|TOKEN)$/.test(key)) delete env[key]; // no real credentials reach extension code
  env.ANTHROPIC_API_KEY = PLACEHOLDER_KEY;
  try {
    const request = `${JSON.stringify({ id: PROBE_ID, type: "get_available_commands" })}\n`;
    const proc = Bun.spawn([opts.bin, "--mode", "rpc", "--no-extensions", "-e", opts.entry], {
      cwd: home,
      env,
      stdin: new Blob([request]),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(proc);
    }, PROBE_TIMEOUT_MS);
    const stdoutDone = readUntilResponse(proc.stdout).then(async text => {
      if (parseCommandsResponse(text)) {
        await Bun.sleep(FLUSH_GRACE_MS);
        killTree(proc);
      }
      return text;
    });
    const [stdout, stderr] = await Promise.all([stdoutDone, new Response(proc.stderr).text()]);
    const code = await proc.exited.finally(() => clearTimeout(timer));
    if (timedOut) throw new InfraError(`omp extension probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`);

    const loadFailures = parseLoadFailures(stderr, opts.root);
    if (loadFailures.length) return loadFailures;
    const response = parseCommandsResponse(stdout);
    if (!response?.success) {
      const tail = stderr.trim().split(/\r?\n/).slice(-5).join("\n");
      throw new InfraError(`omp RPC probe got no successful get_available_commands response (exit ${code}): ${tail}`);
    }
    const file = relativeTo(opts.root, opts.entry);
    return opts.expectCommands
      .filter(name => !response.names.includes(name))
      .map(name => ({
        check: "omp-load" as const,
        code: "expected-command-missing" as const,
        severity: "error" as const,
        file,
        message: `extension did not register command "${name}"`,
      }));
  } finally {
    await stopDaemons(home, env);
    await removeHome(home);
  }
}

async function stopDaemons(home: string, env: Record<string, string | undefined>): Promise<void> {
  for (const [stateDir, cmd] of DAEMON_STOPS) {
    if (!existsSync(join(home, stateDir))) continue;
    try {
      const proc = Bun.spawn(cmd, { cwd: home, env, stdout: "ignore", stderr: "ignore", windowsHide: true, timeout: 30_000 });
      await proc.exited;
    } catch {
      // Tool not installed: nothing it could have started is reachable from here.
    }
  }
}

/** Windows keeps a stopped daemon's files locked for a moment: retry for ~5s. Never changes the verdict. */
async function removeHome(home: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(home, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 20) {
        console.error(`warning: could not remove probe home ${home}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      await Bun.sleep(250);
    }
  }
}
