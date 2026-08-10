#!/usr/bin/env node
/**
 * bump-patch.mjs
 * Increments the patch version of all workspace packages and the root monorepo package.json,
 * updates all internal cross-package dependency references, commits, tags, and pushes to trigger CI publish.
 *
 * Usage:
 *   node scripts/bump-patch.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Package.json paths to version-bump (order matters: dependencies first) */
const PACKAGE_PATHS = [
  'package.json',
  'packages/core/package.json',
  'packages/memory/package.json',
  'packages/experience/package.json',
  'packages/rag/package.json',
  'packages/orchestration/package.json',
  'packages/evaluation/package.json',
  'packages/runtime-adk/package.json',
  'packages/runtime-langgraph/package.json',
  'packages/meta/package.json',
  'apps/landing/package.json',
  'examples/customer-support/package.json',
  'examples/financial-governance/package.json',
  'examples/langgraph-workflow/package.json',
];

/** Bump a semver string's patch segment: "0.4.0" -> "0.4.1" */
function bumpPatch(version) {
  const parts = version.split('.');
  if (parts.length !== 3) throw new Error(`Unexpected version format: ${version}`);
  parts[2] = String(Number(parts[2]) + 1);
  return parts.join('.');
}

function readJson(relPath) {
  const abs = resolve(ROOT, relPath);
  return { abs, json: JSON.parse(readFileSync(abs, 'utf-8')) };
}

function writeJson(abs, json) {
  writeFileSync(abs, JSON.stringify(json, null, 2) + '\n', 'utf-8');
}

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// ── Step 1: Determine current & next version from root package.json ──────────
const { abs: rootAbs, json: rootJson } = readJson('package.json');
const currentVersion = rootJson.version;
const nextVersion = bumpPatch(currentVersion);
console.log(`\n🔖  Bumping version: ${currentVersion} → ${nextVersion}\n`);

// ── Step 2: Bump all package versions & update internal dep refs ─────────────
for (const relPath of PACKAGE_PATHS) {
  let abs, json;
  try {
    ({ abs, json } = readJson(relPath));
  } catch {
    // Package may not exist (e.g. example not present) — skip silently
    continue;
  }

  // Bump version field
  if (json.version) {
    json.version = nextVersion;
  }

  // Update internal @nestjs-agentic/* dependency references
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!json[depField]) continue;
    for (const [pkg, ver] of Object.entries(json[depField])) {
      if (pkg.startsWith('@nestjs-agentic/') && ver === currentVersion) {
        json[depField][pkg] = nextVersion;
      }
    }
  }

  writeJson(abs, json);
  console.log(`  ✅ ${relPath}  →  ${nextVersion}`);
}

// ── Step 3: Update package-lock.json ────────────────────────────────────────
console.log('\n📦  Updating package-lock.json...');
run('npm install --package-lock-only --ignore-scripts');

// ── Step 4: Git commit, tag, push ───────────────────────────────────────────
run(`git add .`);
run(`git commit -m "chore(release): bump patch version to ${nextVersion}"`);
run(`git tag v${nextVersion}`);
run(`git push origin main --tags`);

console.log(`\n🚀  Done! Version ${nextVersion} tagged and pushed. GitHub Actions will publish to NPM.\n`);
