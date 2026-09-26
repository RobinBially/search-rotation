#!/usr/bin/env node
// Points the pinned version in the user-facing documents at a release.
//
// The release driver runs this before tagging a release so no document
// advertises a version other than the one being published. Keep DOCUMENTS limited to files
// that carry a release pin; historical documents such as docs/release-notes.md
// must stay untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'search-rotation';
const REPOSITORY = 'localfoundry/search-rotation-mcp';
const DOCUMENTS = ['README.md', 'docs/clients.md', 'docs/operations.md'];
const SERVER_MANIFEST = 'server.json';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function target(argv) {
  const index = argv.indexOf('--version');
  const raw = index === -1
    ? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    : argv[index + 1];
  const version = String(raw ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Expected a release version such as v0.4.8, received ' + JSON.stringify(raw));
  }
  return version;
}

// Never move a document backwards: a branch that already references a newer
// release keeps its version.
function isOlder(current, wanted) {
  const left = current.split('.').map(Number);
  const right = wanted.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

const argv = process.argv.slice(2);
const version = target(argv);
const check = argv.includes('--check');
const pin = new RegExp('(github:' + REPOSITORY + '#)v(\\d+\\.\\d+\\.\\d+)', 'g');
const archive = new RegExp(PACKAGE + '-(\\d+\\.\\d+\\.\\d+)\\.tgz', 'g');
const updated = [];

for (const relative of DOCUMENTS) {
  const file = join(ROOT, relative);
  const before = readFileSync(file, 'utf8');
  const after = before
    .replace(pin, (match, prefix, current) => (isOlder(current, version) ? prefix + 'v' + version : match))
    .replace(archive, (match, current) => (isOlder(current, version) ? PACKAGE + '-' + version + '.tgz' : match));
  if (after === before) continue;
  updated.push(relative);
  if (!check) writeFileSync(file, after);
}

// server.json feeds the MCP Registry and must name the version that is about to
// be published, so it follows the package version exactly instead of moving
// forward only like the document pins above.
try {
  const manifestFile = join(ROOT, SERVER_MANIFEST);
  const before = readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(before);
  let changed = false;
  if (manifest.version !== version) {
    manifest.version = version;
    changed = true;
  }
  for (const entry of manifest.packages ?? []) {
    if (entry.version !== version) {
      entry.version = version;
      changed = true;
    }
  }
  if (changed) {
    updated.push(SERVER_MANIFEST);
    if (!check) writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (check && updated.length > 0) {
  console.error('Outdated version references, expected v' + version + ': ' + updated.join(', '));
  process.exit(1);
}
console.log(updated.length > 0
  ? (check ? 'Would update ' : 'Updated ') + updated.join(', ') + ' to v' + version
  : 'Version references already at v' + version + '.');
