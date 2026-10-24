// A throwaway git repo per test: a base commit on main, then a PR branch.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = fileURLToPath(new URL('..', import.meta.url));

// No hooks and no user config, so the fixture's commits are what it says.
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false'];

function sh(cwd, args) {
  const r = spawnSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, error: `git ${args.join(' ')}: ${r.stderr}` };
  return { ok: true, value: r.stdout };
}

export function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    if (text === null) rmSync(full);
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  }
}

// base: files on main. Returns { root, commit(files, message), git(args) }.
export function repo(base) {
  const root = mkdtempSync(join(tmpdir(), 'rules-fixture-'));
  sh(root, ['init', '-q', '-b', 'main']);
  write(root, base);
  sh(root, ['add', '-A']);
  sh(root, ['commit', '-q', '-m', 'chore: base']);
  sh(root, ['switch', '-q', '-c', 'pr']);
  return {
    root,
    git: (args) => sh(root, args),
    commit(files, message = 'chore: change') {
      write(root, files);
      sh(root, ['add', '-A']);
      return sh(root, ['commit', '-q', '-m', message]);
    },
  };
}

// Runs a rule script against the fixture and returns its JSON line.
export function run(script, root, extra = []) {
  const r = spawnSync(process.execPath, [join(RULES, script), '--root', root, '--base', 'main', '--head', 'HEAD', ...extra], {
    encoding: 'utf8',
  });
  return { status: r.status, out: JSON.parse(r.stdout.trim().split('\n').at(-1)), stderr: r.stderr };
}

export const rulesDir = RULES;
