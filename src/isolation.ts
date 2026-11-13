import { join } from "node:path";

/** Environment that points omp's config, data and cache at `home`. The isolated HOME is not a sandbox. */
export function isolatedEnv(home: string): Record<string, string | undefined> {
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
  return env;
}

/** Kills a child and its descendants (taskkill /T on Windows, where proc.kill() leaves grandchildren running). */
export function killTree(proc: { pid: number; kill(): void }): void {
  if (process.platform === "win32") Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
  else proc.kill();
}
