// run-stage.mjs writes its stage file and keeps the exit code;
// changes.mjs tells a docs-only change from a code change; scorecard.mjs
// turns a .scorecard/ directory into a verdict, an exit code, the comment
// and the history row.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { repo } from '../../rules/tests/fixture.mjs';

const CI = fileURLToPath(new URL('..', import.meta.url));
const node = (script, args, env = {}) =>
  spawnSync(process.execPath, [join(CI, script), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
const temp = () => mkdtempSync(join(tmpdir(), 'ci-'));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

describe('run-stage', () => {
  test('an ok command writes status ok', () => {
    const dir = temp();
    const r = node('run-stage.mjs', ['--stage', 'lint', '--dir', dir, '--', process.execPath, '-e', '']);
    assert.equal(r.status, 0);
    const s = readJson(join(dir, 'lint.json'));
    assert.equal(s.stage, 'lint');
    assert.equal(s.status, 'ok');
    assert.equal(s.exit_code, 0);
    assert.equal(s.counts, null);
  });

  test('a failing command writes status failed and keeps its exit code', () => {
    const dir = temp();
    const r = node('run-stage.mjs', ['--stage', 'unit', '--dir', dir, '--', process.execPath, '-e', 'process.exit(3)']);
    assert.equal(r.status, 3);
    assert.equal(readJson(join(dir, 'unit.json')).status, 'failed');
  });

  test('a missing command is failed, with the error', () => {
    const dir = temp();
    const r = node('run-stage.mjs', ['--stage', 'knip', '--dir', dir, '--', 'no-such-command-here']);
    assert.notEqual(r.status, 0);
    assert.match(readJson(join(dir, 'knip.json')).error, /ENOENT/);
  });

  test('--counts reads the summary from stdout and still prints it', () => {
    const dir = temp();
    const out = 'apps/web test:       Tests  2 failed | 40 passed (42)';
    const r = node('run-stage.mjs', ['--stage', 'unit', '--dir', dir, '--counts', 'vitest', '--', process.execPath, '-e', 'console.log(process.argv[1])', out]);
    assert.equal(r.stdout, `${out}\n`);
    assert.deepEqual(readJson(join(dir, 'unit.json')).counts, { passed: 40, failed: 2, flaky: 0, skipped: 0 });
  });

  test('an unknown --counts kind is a usage error', () => {
    const r = node('run-stage.mjs', ['--stage', 'unit', '--counts', 'jest', '--', process.execPath, '-e', '']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--counts is one of vitest, playwright/);
  });

  test('--tee keeps stdout in a file and still prints it', () => {
    const dir = temp();
    const r = node('run-stage.mjs', ['--stage', 'rules', '--dir', dir, '--tee', join(dir, 'rules.jsonl'), '--', process.execPath, '-e', 'console.log("{}")']);
    assert.equal(r.stdout, '{}\n');
    assert.equal(readFileSync(join(dir, 'rules.jsonl'), 'utf8'), '{}\n');
  });
});

describe('changes', () => {
  const base = { 'README.md': 'x\n', 'apps/api/src/index.ts': 'export {};\n', 'product/prd.md': 'x\n' };
  const changes = (root) => node('changes.mjs', ['--root', root, '--base', 'main', '--head', 'HEAD']);

  test('docs only is code=false', () => {
    const r = repo(base);
    r.commit({ 'README.md': 'y\n', 'product/prd.md': 'y\n', 'product/ux/a.html': '<p>\n', 'apps/api/AGENTS.md': 'x\n' });
    assert.equal(changes(r.root).stdout, 'code=false\n');
  });

  test('a source file, an unknown file or a workflow is code=true', () => {
    for (const files of [{ 'apps/api/src/index.ts': 'export const a = 1;\n' }, { 'notes.txt': 'x\n' }, { '.github/workflows/pr.yml': 'x\n' }]) {
      const r = repo(base);
      r.commit(files);
      assert.equal(changes(r.root).stdout, 'code=true\n', JSON.stringify(files));
    }
  });

  test('a code file renamed into a docs path is code=true', () => {
    const r = repo(base);
    r.git(['mv', 'apps/api/src/index.ts', 'product/index.ts']);
    r.commit({});
    assert.equal(changes(r.root).stdout, 'code=true\n');
  });

  test('a bad base is an error', () => {
    const r = repo(base);
    const out = node('changes.mjs', ['--root', r.root, '--base', 'nope']);
    assert.equal(out.status, 2);
    assert.match(out.stderr, /^changes: /);
  });
});

describe('scorecard', () => {
  const stage = (dir, name, status = 'ok') =>
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ stage: name, status, seconds: 1, exit_code: 0, counts: null, error: null }));
  const docsOnly = (rules) => {
    const dir = temp();
    for (const s of ['typecheck', 'lint', 'knip', 'rules', 'tools']) stage(dir, s);
    writeFileSync(join(dir, 'rules.jsonl'), `${rules.map((l) => JSON.stringify(l)).join('\n')}\n`);
    return dir;
  };
  const clean = ['rl-0008', 'rl-0009', 'rl-0010', 'rl-0011', 'rl-0012'].map((rule) => ({ rule, status: 'ok', new: [], total: null }));
  const scorecard = (dir, env) => {
    const row = join(temp(), 'row.json');
    return { ...node('scorecard.mjs', ['--dir', dir, '--row', row], env), row };
  };

  test('a docs-only run with clean rules is GREEN, exits 0 and writes the comment and row', () => {
    const file = join(temp(), 'summary.md');
    const r = scorecard(docsOnly([{ check: 'pointers', status: 'ok' }, ...clean]), { CODE: 'false', GITHUB_STEP_SUMMARY: file });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(file, 'utf8'), /^<!-- rsb-scorecard -->\n## Scorecard: GREEN\n/);
    assert.match(r.stdout, /\| rl-0009 \| script \| 0 \| n\/a \| 0 \|/);
    assert.match(r.stdout, /\| rl-0001 \| lint ok \| n\/a \| n\/a \| n\/a \|/);
    assert.match(r.stdout, /verdict=GREEN verdict_seconds=null/);
    const row = readJson(r.row);
    assert.equal(Object.keys(row).length, 14);
    assert.equal(row.verdict, 'GREEN');
    assert.equal(row.tests_pass, 0);
  });

  test('a finding without a token to read exceptions is RED and exits 1', () => {
    const rules = [{ check: 'pointers', status: 'ok' }, ...clean.slice(0, 1), { rule: 'rl-0009', status: 'ok', new: [{ path: 'x', line: null, message: 'm' }], total: null }, ...clean.slice(2)];
    const r = scorecard(docsOnly(rules), { CODE: 'false' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RED: rl-0009: 1 new, and the exceptions could not be read: /);
  });

  test('a code run missing its tests is RED', () => {
    const r = scorecard(docsOnly([{ check: 'pointers', status: 'ok' }, ...clean]), { CODE: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RED: db-tests did not report/);
  });
});
