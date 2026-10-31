import { InfraError, UsageError } from "./errors.ts";
import { getJson, npmRegistry } from "./upstream.ts";
import type { OmpVersion } from "./types.ts";

export interface Packument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { dependencies?: Record<string, string> }>;
  time?: Record<string, string>;
}

const PKG = "@oh-my-pi/pi-coding-agent";

/** Registry document for a package. Not cached: callers need fresh publish times. */
export async function packument(name: string): Promise<Packument | null> {
  return (await getJson(`${npmRegistry()}/${name.replace("/", "%2f")}`)) as Packument | null;
}

async function ompDoc(): Promise<Packument> {
  const doc = await packument(PKG);
  if (!doc) throw new InfraError(`${PKG} not found on ${npmRegistry()}`);
  return doc;
}

export async function resolveVersion(v: string): Promise<OmpVersion> {
  const doc = await ompDoc();
  if (v === "latest") {
    const latest = doc["dist-tags"]?.latest;
    if (!latest) throw new InfraError(`${PKG} has no latest dist-tag`);
    return latest as OmpVersion;
  }
  if (!doc.versions?.[v]) throw new UsageError(`Unknown OMP version ${v}`);
  return v as OmpVersion;
}

export async function publishTime(v: OmpVersion): Promise<Date> {
  const t = (await ompDoc()).time?.[v];
  if (!t) throw new InfraError(`${PKG}@${v} has no publish time`);
  return new Date(t);
}
