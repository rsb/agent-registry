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

// pr.yml's shape: a comment that names a command, a folded run:, and a
// with: input called name.
const WORKFLOW = `jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - run: pnpm lint
  tests:
    runs-on: ubuntu-24.04
    steps:
      # pnpm test, split so the db package's tests are a stage of their
      # own; the two filters cover the same packages.
      - run: node tools/ci/run-stage.mjs --stage db-tests -- pnpm --filter @gm/db test
      - name: schema.sql matches the migrations
        if: \${{ !cancelled() }}
        run: >-
          node tools/ci/run-stage.mjs --stage schema-diff -- sh -ec '
          pnpm db:schema'
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v7
        with:
          name: scorecard-tests
`;

function ciFixture(job, step) {
  const root = mkdtempSync(join(tmpdir(), 'rules-pointers-'));
  const ci = { file: 'pr.yml', job, step };
  const rules = [{ id: 'rl-0001', source: null, checks: [{ kind: 'ci-step', ref: 'pr.yml', ci }] }];
  write(root, {
    'pr.yml': WORKFLOW,
    'AGENTS.md': '<!-- rsb:rules:begin -->\n- rl-0001: a\n<!-- rsb:rules:end -->\n',
    'rules.json': JSON.stringify({ rules }),
  });
  return pointers(['--root', root, '--config', join(root, 'rules.json')]);
}

test('a CI pointer to a run line, a folded run line or a step name passes', () => {
  for (const step of ['pnpm --filter @gm/db test', 'pnpm db:schema', 'schema.sql matches the migrations']) {
    assert.equal(ciFixture('tests', step).status, 0, step);
  }
});

// The regression: rl-0003 and rl-0005 pointed at "pnpm test" after the
// tests job split it, and the comment kept the pointer passing.
test('a CI pointer that matches only a comment fails', () => {
  const r = ciFixture('tests', 'pnpm test');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pr\.yml job tests has no step "pnpm test"/);
});

test("a CI pointer to another job's step, or to a with: input, fails", () => {
  assert.equal(ciFixture('tests', 'pnpm lint').status, 1);
  assert.equal(ciFixture('tests', 'scorecard-tests').status, 1);
  assert.match(ciFixture('deploy', 'pnpm lint').stderr, /pr\.yml has no job deploy/);
});
