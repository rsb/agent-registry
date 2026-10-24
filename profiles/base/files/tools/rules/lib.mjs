// Shared by the rule scripts. Node built-ins only, so no install step.
// Every function returns { ok: true, value } or { ok: false, error }.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// git's empty tree: `--all` diffs the whole head against it.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return err(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) return err(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return ok(r.stdout);
}

export function readText(path) {
  try {
    return ok(readFileSync(path, 'utf8'));
  } catch (e) {
    return err(`${path}: ${e.message}`);
  }
}

export function parseJson(text, what) {
  try {
    return ok(JSON.parse(text));
  } catch (e) {
    return err(`${what}: ${e.message}`);
  }
}

// rules.json beside this file: the hand-render of the registry.
export function loadConfig() {
  const text = readText(new URL('./rules.json', import.meta.url));
  if (!text.ok) return text;
  return parseJson(text.value, 'rules.json');
}

// --root <repo> (default: cwd), --base <rev> (default: origin/main),
// --head <rev> (default: HEAD), --all (base is the empty tree).
export function parseArgs(argv) {
  const opts = { root: process.cwd(), base: 'origin/main', head: 'HEAD', all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--root' || a === '--base' || a === '--head') {
      const v = argv[i + 1];
      if (v === undefined) return err(`${a} needs a value`);
      opts[a.slice(2)] = v;
      i += 1;
    } else return err(`unknown argument: ${a}`);
  }
  return ok(opts);
}

// The revision the PR is compared with: the merge-base of base and head,
// or the empty tree with --all.
export function resolveRange(opts) {
  const head = git(opts.root, ['rev-parse', '--verify', `${opts.head}^{commit}`]);
  if (!head.ok) return head;
  if (opts.all) return ok({ base: EMPTY_TREE, head: head.value.trim(), all: true });
  const base = git(opts.root, ['merge-base', opts.base, head.value.trim()]);
  if (!base.ok) return base;
  return ok({ base: base.value.trim(), head: head.value.trim(), all: false });
}

// git diff --name-status as [{ status, path, from }]; `from` is the old
// path of a rename or copy.
export function changedPaths(root, range) {
  const out = git(root, ['diff', '--name-status', '-M', '-z', range.base, range.head]);
  if (!out.ok) return out;
  const parts = out.value.split('\0');
  const entries = [];
  let i = 0;
  while (i < parts.length && parts[i] !== '') {
    const status = parts[i];
    if (status[0] === 'R' || status[0] === 'C') {
      entries.push({ status: status[0], from: parts[i + 1], path: parts[i + 2] });
      i += 3;
    } else {
      entries.push({ status: status[0], from: null, path: parts[i + 1] });
      i += 2;
    }
  }
  return ok(entries);
}

// The file at a revision, or null if it does not exist there.
export function showFile(root, rev, path) {
  if (rev === EMPTY_TREE) return ok(null);
  const exists = git(root, ['cat-file', '-e', `${rev}:${path}`]);
  if (!exists.ok) return ok(null);
  return git(root, ['show', `${rev}:${path}`]);
}

export function listFiles(root, rev, pathspec) {
  if (rev === EMPTY_TREE) return ok([]);
  const out = git(root, ['ls-tree', '-r', '--name-only', '-z', rev, '--', pathspec]);
  if (!out.ok) return out;
  return ok(out.value.split('\0').filter((p) => p !== ''));
}

// A glob as a RegExp: `**` crosses directories, `*` does not.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// The one JSON line every rule script prints.
export function report(rule, result) {
  if (!result.ok) {
    console.log(JSON.stringify({ rule, status: 'error', error: result.error }));
    return 1;
  }
  const { status = 'ok', findings, total = null } = result.value;
  console.log(JSON.stringify({ rule, status, new: findings, total }));
  return 0;
}
