#!/usr/bin/env node
/** Parse every JavaScript file instead of trusting a hand-maintained list. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DIRECTORIES = ["tgcloud", "tests", "scripts"];
const EXTENSIONS = new Set([".js", ".mjs"]);
const IGNORED = new Set(["node_modules", ".git"]);

function collect(directory, files) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) files.push(full);
  }
}

const files = [];
for (const directory of DIRECTORIES) collect(directory, files);
files.push("scripts/check-syntax.mjs");
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) { console.error(`✕ ${file}\n${result.stderr}`); failed++; }
}
if (failed) { console.error(`${failed} file(s) failed to parse`); process.exit(1); }
console.log(`check-syntax: ${files.length} JavaScript files parsed successfully`);
