// pointers.mjs passes on this repo and fails on a broken pointer.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rulesDir, write } from './fixture.mjs';

const pointers = (args) =>
  spawnSync(process.execPath, [join(rulesDir, 'pointers.mjs'), ...args], { encoding: 'utf8' });

test("the repo's rules.json resolves", () => {
  const r = pointers(['--root', join(rulesDir, '../..')]);
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
});

function fixture(number) {
  const root = mkdtempSync(join(tmpdir(), 'rules-pointers-'));
  const rules = [{ id: 'rl-0001', source: { file: 'engineering/x.md', number }, checks: [] }];
  write(root, {
    'engineering/x.md': '# x\n\n1. A rule.\n2. Moved to shared rule 9.\n',
    'AGENTS.md': '<!-- rsb:rules:begin -->\n- rl-0001: a (engineering/x.md #1)\n<!-- rsb:rules:end -->\n',
    'rules.json': JSON.stringify({ rules }),
  });
  return pointers(['--root', root, '--config', join(root, 'rules.json')]);
}

test('a pointer to a numbered rule passes', () => {
  assert.equal(fixture(1).status, 0);
});

test('a pointer to a missing rule fails', () => {
  const r = fixture(3);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /engineering\/x\.md has no rule 3/);
});

test('a pointer to a moved stub fails', () => {
  const r = fixture(2);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is a stub/);
});
