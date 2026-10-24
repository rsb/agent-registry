// rl-0011: every workflow pins its actions by commit SHA and declares
// top-level permissions. Local actions (./) are exempt; a docker:// image
// needs an @sha256: digest. `new` is what head has and the merge-base did
// not; `total` is every finding at head.

import { listFiles, ok, parseArgs, report, resolveRange, showFile } from './lib.mjs';

const RULE = 'rl-0011';
const DIR = '.github/workflows';

function findingsIn(path, text) {
  const out = [];
  const lines = text.split('\n');
  if (!lines.some((l) => /^permissions:/.test(l))) {
    out.push({ path, line: null, message: 'no top-level permissions' });
  }
  lines.forEach((l, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/.exec(l);
    if (m === null || m[1].startsWith('./')) return;
    const ref = m[1];
    const pinned = ref.startsWith('docker://') ? /@sha256:[0-9a-f]{64}$/.test(ref) : /@[0-9a-f]{40}$/.test(ref);
    if (!pinned) out.push({ path, line: i + 1, message: `not pinned by SHA: ${ref}` });
  });
  return out;
}

function findingsAt(root, rev) {
  const files = listFiles(root, rev, DIR);
  if (!files.ok) return files;
  const all = [];
  for (const p of files.value.filter((f) => /\.ya?ml$/.test(f))) {
    const text = showFile(root, rev, p);
    if (!text.ok) return text;
    if (text.value !== null) all.push(...findingsIn(p, text.value));
  }
  return ok(all);
}

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const root = opts.value.root;
  const head = findingsAt(root, range.value.head);
  if (!head.ok) return head;
  const base = findingsAt(root, range.value.base);
  if (!base.ok) return base;
  // Compared without line numbers, so a finding that only moved is not new.
  const key = (f) => `${f.path}\0${f.message}`;
  const before = new Set(base.value.map(key));
  const findings = head.value.filter((f) => !before.has(key(f)));
  return ok({ findings, total: head.value.length });
}

process.exitCode = report(RULE, check(process.argv.slice(2)));
