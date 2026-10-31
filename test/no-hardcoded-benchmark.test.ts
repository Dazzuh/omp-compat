import { expect, test } from "bun:test";
import { Glob } from "bun";

test("src/ never names the benchmark plugin or its missing module", async () => {
  const banned = ["registerNativeStyle", "native/styles", "tern-omp-bridge"];
  const hits: string[] = [];
  for await (const file of new Glob("src/**/*").scan({ cwd: import.meta.dir + "/..", absolute: true })) {
    const text = await Bun.file(file).text();
    for (const word of banned) if (text.includes(word)) hits.push(`${file}: ${word}`);
  }
  expect(hits).toEqual([]);
});
