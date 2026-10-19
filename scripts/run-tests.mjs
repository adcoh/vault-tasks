#!/usr/bin/env node
// Runs every compiled test file under dist/tests/ with `node --test`.
//
// Why not `node --test dist/tests/*.test.js` in package.json: on Windows the
// npm script shell (cmd.exe) does not expand globs, and Node 20's test runner
// does not glob its own arguments, so the literal pattern is "not found".

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "tests");

let files;
try {
  files = readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .map((f) => join(testsDir, f));
} catch (err) {
  console.error(`run-tests: run 'npm run build' first; cannot read ${testsDir} (${err.message})`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`run-tests: run 'npm run build' first; no *.test.js files in ${testsDir}`);
  process.exit(1);
}

const res = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
