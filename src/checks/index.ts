import type { CheckDef, CheckId } from "../types.ts";
import { hostImportsCheck } from "./host-imports.ts";
import { manifestCheck } from "./manifest.ts";

const notImplemented = (id: CheckId) => async () => {
  throw new Error(`check ${id} is not implemented yet`);
};

export const CHECK_ORDER: readonly CheckId[] = ["manifest", "host-imports", "omp-load"];

// manifest and host-imports only parse files; omp-load installs and imports the plugin.
export const CHECKS: Record<CheckId, CheckDef> = {
  manifest: { run: manifestCheck, executesPluginCode: false },
  "host-imports": { run: hostImportsCheck, executesPluginCode: false },
  "omp-load": { run: notImplemented("omp-load"), executesPluginCode: true },
};
