// run.mjs exits 1 on a finding, a script error or failed pointers. With
// --ci a finding exits 0; the errors still exit 1.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { clone, rulesDir } from './fixture.mjs';

const runAll = (root, extra = ['--base', 'main']) => {
  const r = spawnSync(process.execPath, [join(rulesDir, 'run.mjs'), '--root', root, '--head', 'HEAD', ...extra], { encoding: 'utf8' });
  return { status: r.status, lines: r.stdout.trim().split('\n').map((l) => JSON.parse(l)) };
};

const line = (lines, rule) => lines.find((l) => l.rule === rule);

describe('run.mjs', () => {
  test('a clean change exits 0', () => {
    const r = clone();
    r.commit({ 'README.md': 'changed\n' });
    const { status, lines } = runAll(r.root);
    assert.equal(status, 0);
    assert.deepEqual(lines[0], { check: 'pointers', status: 'ok' });
    assert.ok(lines.slice(1).every((l) => l.status === 'ok' && l.new.length === 0));
  });

  test('a finding exits 1 by default and 0 with --ci; the scorecard judges it', () => {
    const r = clone();
    const workflow = join(r.root, '.github/workflows/pr.yml');
    r.commit({ '.github/workflows/pr.yml': `${readFileSync(workflow, 'utf8')}# changed\n` });
    const strict = runAll(r.root);
    assert.equal(strict.status, 1);
    assert.ok(line(strict.lines, 'rl-0009').new.length > 0);
    const ci = runAll(r.root, ['--ci', '--base', 'main']);
    assert.equal(ci.status, 0);
    assert.deepEqual(ci.lines, strict.lines);
  });

  for (const mode of [[], ['--ci']]) {
    const name = mode.length === 0 ? 'by default' : 'with --ci';

    test(`a script in error exits 1 ${name}`, () => {
      const r = clone();
      const { status, lines } = runAll(r.root, [...mode, '--base', 'no-such-rev']);
      assert.equal(status, 1);
      assert.ok(lines.slice(1).some((l) => l.status === 'error'));
    });

    test(`failed pointers exit 1 ${name}`, () => {
      const r = clone();
      r.commit({ 'AGENTS.md': 'no rules region\n' });
      const { status, lines } = runAll(r.root, [...mode, '--base', 'main']);
      assert.equal(status, 1);
      assert.equal(lines[0].status, 'error');
    });
  }
});
