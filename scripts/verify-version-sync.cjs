#!/usr/bin/env node
// Project/App: Open GSD
// File Purpose: Command-line guard for release version surface alignment.
const path = require("node:path");
const { verifyVersionSync } = require("./lib/version-sync.cjs");

const root = path.resolve(__dirname, "..");
const issues = verifyVersionSync(root);

if (issues.length > 0) {
  console.error("Version sync check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Version sync check passed.");
