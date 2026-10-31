#!/usr/bin/env bun
import { parseArgs } from "node:util";

const USAGE = `omp-compat: compatibility validator for OMP plugins

Usage:
  omp-compat check <plugin-dir> --omp <ver|latest>[,<ver>...] [--checks <ids>] [--allow-runtime] [--json] [--cache <dir>]
  omp-compat matrix --corpus <corpus.json> --versions <omp-versions.json> [--include-latest] [--checks <ids>]
                    [--trust trusted|untrusted] [--untrusted-runtime] [--report <path>]

Exit codes: 0 ok, 1 incompatible/regression, 2 usage error, 3 infra error, 4 expectation mismatch (matrix).
`;

class UsageError extends Error {}

function usage(message: string): never {
  throw new UsageError(message);
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === "check") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        omp: { type: "string" },
        checks: { type: "string" },
        "allow-runtime": { type: "boolean" },
        json: { type: "boolean" },
        cache: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (positionals.length !== 1) usage("check requires exactly one <plugin-dir>");
    if (!values.omp) usage("check requires --omp <ver|latest>[,<ver>...]");
    usage("check is not wired up yet (arrives with the plugin reader and checks)");
  }
  if (command === "matrix") {
    const { values } = parseArgs({
      args: rest,
      options: {
        corpus: { type: "string" },
        versions: { type: "string" },
        "include-latest": { type: "boolean" },
        checks: { type: "string" },
        trust: { type: "string" },
        "untrusted-runtime": { type: "boolean" },
        report: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (!values.corpus || !values.versions) usage("matrix requires --corpus and --versions");
    usage("matrix is not wired up yet (arrives with the corpus and expectations)");
  }
  return usage(`unknown command: ${command}`);
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (err) {
  if (err instanceof UsageError || (err instanceof TypeError && "code" in err)) {
    console.error(`error: ${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  throw err;
}
