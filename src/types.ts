export type OmpVersion = string & { readonly __brand: "OmpVersion" }; // exact semver, e.g. "18.14.2"
export type CheckId = "manifest" | "host-imports" | "omp-load";
export type FindingCode =
  | "manifest-missing" // package.json lacks both `omp` and `pi`
  | "entry-not-found" // declared extension entry missing on disk
  | "module-not-found" // host specifier does not resolve in this OMP version
  | "export-not-found" // imported binding not exported by the resolved host module
  | "host-import-unverified" // other compiler diagnostic on a probe line (warning)
  | "load-failed" // real omp reported "Failed to load extension"
  | "install-failed"; // real omp install failed for another reason
export interface Finding {
  check: CheckId;
  code: FindingCode;
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  specifier?: string;
  binding?: string;
}
export type Trust = "trusted" | "untrusted";
export interface PluginUnderTest {
  id: string;
  root: string;
  rev: string;
  trust: Trust;
  name: string;
  version: string;
  manifestKey: "omp" | "pi" | null;
  extensionEntries: string[]; // absolute, resolved against root
}
export interface CheckContext {
  plugin: PluginUnderTest;
  omp: OmpVersion;
  cacheDir: string;
}
export type Check = (ctx: CheckContext) => Promise<Finding[]>;
export interface CheckDef {
  run: Check;
  executesPluginCode: boolean;
}

export type CheckStatus = "pass" | "fail" | "skipped" | "upstream-pending" | "infra-error";
export type SkipReason = "runtime-not-allowed" | "manifest-failed" | "not-selected";
export interface CheckOutcome {
  check: CheckId;
  status: CheckStatus;
  findings: Finding[];
  skipReason?: SkipReason;
  detail?: string;
  durationMs: number;
}
export type CellVerdict =
  | "verified"
  | "partial"
  | "incompatible"
  | "skipped"
  | "upstream-pending"
  | "infra-error";
export interface CellResult {
  pluginId: string;
  pluginRev: string;
  omp: OmpVersion;
  verdict: CellVerdict;
  outcomes: CheckOutcome[];
}
export interface Regression {
  pluginId: string;
  pluginRev: string;
  check: CheckId;
  baseline: OmpVersion;
  newer: OmpVersion;
  findings: Finding[];
}
export interface ExpectationMismatch {
  pluginId: string;
  omp: OmpVersion;
  kind: "UNEXPECTED_PASS" | "UNEXPECTED_FAIL" | "MISSED_FINDING";
  detail: string;
}
export interface Report {
  schema: 1;
  tool: string;
  generatedAt: string;
  baseline: OmpVersion | null;
  results: CellResult[];
  regressions: Regression[];
  mismatches: ExpectationMismatch[];
}
