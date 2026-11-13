import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const fx = (n: string) => join(ROOT, "fixtures", n);
// A real omp binary (e.g. the fork's Windows build). Unset: the real-binary tests are skipped.
const BIN = process.env.OMP_COMPAT_TEST_OMP_BINARY;
const real = BIN ? test : test.skip;

async function cli(args: string[]) {
  const p = Bun.spawn(["bun", "run", "src/cli.ts", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

describe("check argument validation (no network, no binary)", () => {
  test("--omp and --omp-binary are mutually exclusive", async () => {
    const r = await cli(["check", fx("ext-good"), "--omp", "18.19.0", "--omp-binary", "nope.exe"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("mutually exclusive");
  });
  test("one of --omp or --omp-binary is required", async () => {
    expect((await cli(["check", fx("ext-good")])).code).toBe(2);
  });
  test("--omp-binary must exist", async () => {
    const r = await cli(["check", fx("ext-good"), "--omp-binary", join(ROOT, "absent-omp.exe")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--omp-binary not found");
  });
  test("--expect-commands applies to extension targets only", async () => {
    const r = await cli(["check", fx("good"), "--omp-binary", process.execPath, "--expect-commands", "x"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("extension targets only");
  });
});

describe("real omp binary: extension targets", () => {
  real("good extension registers its command: verified", async () => {
    const r = await cli(["check", fx("ext-good"), "--omp-binary", BIN!, "--checks", "manifest,omp-load", "--allow-runtime", "--json"]);
    expect(r.code).toBe(0);
    const [cell] = JSON.parse(r.out);
    expect(cell.verdict).toBe("verified");
    expect(cell.omp).toMatch(/^\d+\.\d+\.\d+/);
    const manifest = cell.outcomes.find((o: { check: string }) => o.check === "manifest");
    expect(manifest.findings[0]).toMatchObject({ code: "extension-target", severity: "warning", file: "index.ts" });
  }, 300_000);

  real("broken extension: incompatible, load-failed names the thrown error", async () => {
    const r = await cli(["check", fx("ext-broken"), "--omp-binary", BIN!, "--checks", "omp-load", "--allow-runtime", "--json"]);
    expect(r.code).toBe(1);
    const [cell] = JSON.parse(r.out);
    expect(cell.verdict).toBe("incompatible");
    const [finding] = cell.outcomes.find((o: { check: string }) => o.check === "omp-load").findings;
    expect(finding).toMatchObject({ code: "load-failed", file: "index.ts" });
    expect(finding.message).toContain("omp-compat ext-broken: thrown on import");
  }, 300_000);

  real("expected command not registered is reported", async () => {
    const r = await cli(["check", fx("ext-good"), "--omp-binary", BIN!, "--checks", "omp-load", "--allow-runtime", "--expect-commands", "omp-compat-good,omp-compat-absent", "--json"]);
    expect(r.code).toBe(1);
    const findings = JSON.parse(r.out)[0].outcomes.find((o: { check: string }) => o.check === "omp-load").findings;
    expect(findings).toEqual([
      expect.objectContaining({ code: "expected-command-missing", file: "index.ts", message: 'extension did not register command "omp-compat-absent"' }),
    ]);
  }, 300_000);

  real("without --allow-runtime the runtime probe is skipped: partial, exit 0", async () => {
    const r = await cli(["check", fx("ext-good"), "--omp-binary", BIN!, "--checks", "manifest,omp-load"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("omp-load=skipped (runtime-not-allowed)");
  }, 300_000);
});
