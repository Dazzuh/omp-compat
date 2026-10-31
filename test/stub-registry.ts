/** Local npm registry stub for tests: serves package documents from a map. */
export function stubRegistry(docs: Record<string, unknown>, status = 200) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (status !== 200) return new Response("nope", { status });
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const doc = docs[name];
      return doc ? Response.json(doc) : new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Registry docs: pi-coding-agent@99.0.0 depends on an @oh-my-pi/pi-tui that is not published. */
export function pendingDocs(publishedHoursAgo: number) {
  return {
    "@oh-my-pi/pi-coding-agent": {
      "dist-tags": { latest: "99.0.0" },
      versions: { "99.0.0": { dependencies: { "@oh-my-pi/pi-tui": "^99.0.0" } }, "18.14.2": {} },
      time: { "99.0.0": hoursAgo(publishedHoursAgo), "18.14.2": hoursAgo(500) },
    },
    "@oh-my-pi/pi-tui": { versions: { "18.14.2": {} }, time: {} },
  };
}
