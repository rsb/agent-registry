// The changes job: is this PR code, or documentation only? Prints
// code=true|false and appends it to $GITHUB_OUTPUT when that is set. A
// path is documentation when it matches DOCS; anything else is code, so
// an unknown file runs everything. --root, --base, --head as the rule
// scripts take them.

import { appendFileSync } from 'node:fs';
import { changedPaths, err, globToRegExp, ok, parseArgs, resolveRange } from '../rules/lib.mjs';

// What a docs-only PR changes (monorepo rule 11's non-code paths, plus
// the repo's prose). Nothing under apps/ or packages/ but their
// AGENTS.md and README.md.
const DOCS = [
  '*.md',
  '**/AGENTS.md',
  '**/README.md',
  '.github/pull_request_template.md',
  'product/**',
  'decisions/**',
  'engineering/**',
].map(globToRegExp);

const isDocs = (path) => DOCS.some((re) => re.test(path));

function isCode(changes) {
  return changes.some((c) => !isDocs(c.path) || (c.from !== null && !isDocs(c.from)));
}

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const changes = changedPaths(opts.value.root, range.value);
  if (!changes.ok) return changes;
  return ok(isCode(changes.value));
}

function output(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined || file === '') return ok(null);
  try {
    appendFileSync(file, `${line}\n`);
    return ok(null);
  } catch (e) {
    return err(`${file}: ${e.message}`);
  }
}

function main() {
  const code = check(process.argv.slice(2));
  if (!code.ok) {
    console.error(`changes: ${code.error}`);
    return 2;
  }
  const line = `code=${code.value}`;
  console.log(line);
  const written = output(line);
  if (!written.ok) {
    console.error(`changes: ${written.error}`);
    return 2;
  }
  return 0;
}

process.exitCode = main();
