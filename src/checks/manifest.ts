import { relative } from "node:path";
import { readPlugin } from "../plugin.ts";
import type { Check, Finding } from "../types.ts";

export const manifestCheck: Check = async ({ plugin }) => {
  if (plugin.kind === "extension") {
    // Extension files are loaded by path from omp's `extensions` setting; there is no manifest to check.
    const entry = plugin.extensionEntries[0]!;
    const finding: Finding = {
      check: "manifest",
      code: "extension-target",
      severity: "warning",
      message: "no package.json: the extension file is checked directly",
      file: relative(plugin.root, entry).replaceAll("\\", "/"),
    };
    return [finding];
  }
  return readPlugin(plugin.id, plugin.root, plugin.trust, plugin.rev).findings;
};
