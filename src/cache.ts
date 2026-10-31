import { homedir } from "node:os";
import { join } from "node:path";

/** Cache root: --cache flag, then OMP_COMPAT_CACHE, then the platform default. */
export function cacheRoot(flag?: string): string {
  if (flag) return flag;
  const env = process.env.OMP_COMPAT_CACHE;
  if (env) return env;
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "omp-compat");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "omp-compat");
}
