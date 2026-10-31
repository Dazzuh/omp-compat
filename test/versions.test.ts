import { afterEach, beforeEach, expect, test } from "bun:test";
import { InfraError, UsageError } from "../src/errors.ts";
import { publishTime, resolveVersion } from "../src/versions.ts";
import { hoursAgo, pendingDocs, stubRegistry } from "./stub-registry.ts";

let stop = () => {};
beforeEach(() => {
  const s = stubRegistry(pendingDocs(5));
  process.env.OMP_COMPAT_NPM_REGISTRY = s.url;
  stop = s.stop;
});
afterEach(() => {
  stop();
  delete process.env.OMP_COMPAT_NPM_REGISTRY;
});

test("latest resolves to the dist-tag", async () => expect(await resolveVersion("latest")).toBe("99.0.0" as never));
test("exact published version resolves to itself", async () => expect(await resolveVersion("18.14.2")).toBe("18.14.2" as never));
test("unknown version is a usage error", async () => {
  const err = await resolveVersion("1.2.3").catch(e => e);
  expect(err).toBeInstanceOf(UsageError);
  expect(err.message).toBe("Unknown OMP version 1.2.3");
});
test("publishTime parses the registry time map", async () => {
  const t = await publishTime("99.0.0" as never);
  expect(Math.abs(Date.now() - t.getTime() - 5 * 3600_000)).toBeLessThan(60_000);
});
test("registry 5xx is an InfraError", async () => {
  stop();
  const s = stubRegistry({}, 503);
  process.env.OMP_COMPAT_NPM_REGISTRY = s.url;
  stop = s.stop;
  expect(await resolveVersion("latest").catch(e => e)).toBeInstanceOf(InfraError);
});
