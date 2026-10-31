import type { CheckDef, CheckId } from "../types.ts";
import { hostImportsCheck } from "./host-imports.ts";
import { manifestCheck } from "./manifest.ts";
import { ompLoadCheck } from "./omp-load.ts";

export const CHECK_ORDER: readonly CheckId[] = ["manifest", "host-imports", "omp-load"];

// manifest and host-imports only parse files; omp-load installs and imports the plugin.
export const CHECKS: Record<CheckId, CheckDef> = {
  manifest: { run: manifestCheck, executesPluginCode: false },
  "host-imports": { run: hostImportsCheck, executesPluginCode: false },
  "omp-load": { run: ompLoadCheck, executesPluginCode: true },
};
