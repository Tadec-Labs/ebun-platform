#!/usr/bin/env node
/**
 * pnpm verify — the one gate every change passes before it can merge.
 *
 * The same steps run in CI (.github/workflows/ci.yml) and anywhere a
 * person or Claude wants to know "is this safe to merge?". Stops at the
 * first failure so the error is the last thing on screen.
 *
 * Lint runs without --fix on purpose: the API's own `lint` script fixes
 * in place, which is right while writing code and wrong in a check —
 * a check must report problems, not quietly change files.
 */
import { spawnSync } from "node:child_process";

const steps = [
  ["Shared types build", ["--filter", "@ebun/types", "build"]],
  ["API typecheck", ["--filter", "@ebun/api", "typecheck"]],
  ["API lint", ["--filter", "@ebun/api", "exec", "eslint", "{src,test}/**/*.ts"]],
  ["API tests", ["--filter", "@ebun/api", "test"]],
  ["Web typecheck", ["--filter", "web", "typecheck"]],
  ["Web lint", ["--filter", "web", "lint"]],
];

for (const [label, args] of steps) {
  console.log(`\n▶ ${label}`);
  const started = Date.now();
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    // pnpm is a .cmd shim on Windows, which only a shell can run.
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed. Nothing after it was run.`);
    process.exit(result.status ?? 1);
  }
  console.log(`✔ ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

console.log("\n✔ All checks passed.");
