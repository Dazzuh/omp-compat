import { InfraError, UpstreamPendingError } from "./errors.ts";
import { publishTime } from "./versions.ts";
import type { OmpVersion } from "./types.ts";

export const npmRegistry = () => (process.env.OMP_COMPAT_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "");
export const releasesBase = () =>
  (process.env.OMP_COMPAT_RELEASES_BASE ?? "https://github.com/can1357/oh-my-pi/releases/download").replace(/\/$/, "");

export const PENDING_WINDOW_MS = 48 * 3600_000;

/**
 * An artifact the OMP version needs is missing. Within 48h of the npm publish that is
 * upstream still publishing (pending); later it is a broken release (infra error).
 */
export async function missingArtifact(v: OmpVersion, missing: string): Promise<never> {
  const age = Date.now() - (await publishTime(v)).getTime();
  if (age < PENDING_WINDOW_MS) throw new UpstreamPendingError(missing);
  throw new InfraError(`${missing} still missing 48h after npm publish of ${v}`);
}

/** GET JSON; network errors, timeouts and non-2xx are InfraErrors. 404 is returned as null. */
export async function getJson(url: string): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (cause) {
    throw new InfraError(`GET ${url} failed`, { cause });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new InfraError(`GET ${url} returned HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new InfraError(`GET ${url} returned invalid JSON`, { cause });
  }
}
