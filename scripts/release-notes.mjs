#!/usr/bin/env node
/**
 * release-notes.mjs
 * Builds the body of the single GitHub release a version gets, from the
 * changelog sections of the packages changesets just published.
 *
 * Reads the changesets action's `publishedPackages` output (a JSON array of
 * `{ name, version }`) from PUBLISHED_PACKAGES and prints Markdown to stdout.
 *
 * Usage:
 *   PUBLISHED_PACKAGES='[{"name":"@nestjs-agentic/core","version":"1.6.0"}]' node scripts/release-notes.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const published = JSON.parse(process.env.PUBLISHED_PACKAGES || '[]');

/** Package name to its directory, for every workspace package. */
const packageDirs = new Map();
for (const entry of readdirSync(join(ROOT, 'packages'))) {
  const manifest = join(ROOT, 'packages', entry, 'package.json');
  if (existsSync(manifest)) {
    packageDirs.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(ROOT, 'packages', entry));
  }
}

/** The body of a package's `## <version>` changelog section, or '' when it has none. */
function changelogSection(dir, version) {
  const file = join(dir, 'CHANGELOG.md');
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return '';
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .join('\n')
    .trim();
}

const sections = published.map(({ name, version }) => {
  const dir = packageDirs.get(name);
  const body = dir ? changelogSection(dir, version) : '';
  // Nest each package's "### Minor Changes" headings under its own heading.
  const notes = body ? body.replace(/^### /gm, '#### ') : '_Released in lockstep with the other packages; no changes of its own._';
  return `## ${name}@${version}\n\n${notes}`;
});

process.stdout.write(`${sections.join('\n\n')}\n`);
