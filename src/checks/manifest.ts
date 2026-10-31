import { readPlugin } from "../plugin.ts";
import type { Check } from "../types.ts";

export const manifestCheck: Check = async ({ plugin }) =>
  readPlugin(plugin.id, plugin.root, plugin.trust, plugin.rev).findings;
