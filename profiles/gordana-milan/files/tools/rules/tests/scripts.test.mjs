// Each script rule flags a seeded violation and passes a clean change.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { repo, rulesDir, run } from './fixture.mjs';

const messages = (out) => out.new.map((f) => f.message);

describe('rl-0008 frozen-migrations', () => {
  const M = 'packages/db/migrations';
  const base = { [`${M}/20260101000000_a.sql`]: 'create table a ();\n' };

  test('a modified migration is a finding', () => {
    const r = repo(base);
    r.commit({ [`${M}/20260101000000_a.sql`]: 'create table a (id int);\n' });
    const { status, out } = run('frozen-migrations.mjs', r.root);
    assert.equal(status, 0);
    assert.equal(out.rule, 'rl-0008');
    assert.match(messages(out).join(), /modifies a migration/);
  });

  test('a deleted, renamed or out-of-order migration is a finding', () => {
    const r = repo({ ...base, [`${M}/20260102000000_b.sql`]: 'create table b ();\n' });
    r.git(['rm', '-q', `${M}/20260102000000_b.sql`]);
    r.git(['mv', `${M}/20260101000000_a.sql`, `${M}/20260103000000_a.sql`]);
    r.commit({ [`${M}/20260101500000_c.sql`]: 'create table c ();\n' });
    const { out } = run('frozen-migrations.mjs', r.root);
    assert.deepEqual(out.new.map((f) => f.message.split(' ')[0]).sort(), ['deletes', 'renames', 'sorts']);
  });

  test('a new migration after the newest is clean', () => {
    const r = repo(base);
    r.commit({ [`${M}/20260201000000_b.sql`]: 'create table b ();\n', 'README.md': 'x\n' });
    const { status, out } = run('frozen-migrations.mjs', r.root);
    assert.equal(status, 0);
    assert.deepEqual(out.new, []);
  });
});

describe('rl-0009 owned-files', () => {
  const agents = (rules, intro = 'intro') =>
    `${intro}\n<!-- rsb:containment:begin -->\nkeep\n<!-- rsb:containment:end -->\n<!-- rsb:rules:begin -->\n${rules}\n<!-- rsb:rules:end -->\n`;
  const base = { 'AGENTS.md': agents('- rl-0001: a'), '.github/workflows/pr.yml': 'name: PR\n', 'README.md': 'x\n' };

  test('an owned path or region change is a finding', () => {
    const r = repo(base);
    r.commit({ '.github/workflows/pr.yml': 'name: CI\n', 'AGENTS.md': agents('- rl-0001: b') });
    const { out } = run('owned-files.mjs', r.root);
    assert.deepEqual(messages(out), ['M: owned path (.github/workflows/**)', 'owned region rsb:rules changed']);
  });

  test('a change outside owned paths and regions is clean', () => {
    const r = repo(base);
    r.commit({ 'README.md': 'y\n', 'AGENTS.md': agents('- rl-0001: a', 'new intro') });
    const { out } = run('owned-files.mjs', r.root);
    assert.deepEqual(out.new, []);
  });
});

describe('rl-0010 no-ai-attribution', () => {
  const hook = readFileSync(join(rulesDir, '../../.githooks/commit-msg'), 'utf8');

  test('an attribution trailer is a finding', () => {
    const r = repo({ '.githooks/commit-msg': hook });
    r.commit({ 'a.txt': 'a\n' }, 'feat: a\n\nCo-Authored-By: Someone <noreply@anthropic.com>');
    const { out } = run('no-ai-attribution.mjs', r.root);
    assert.equal(out.new.length, 1);
    assert.equal(out.new[0].line, 3);
  });

  test('a plain message is clean', () => {
    const r = repo({ '.githooks/commit-msg': hook });
    r.commit({ 'a.txt': 'a\n' }, 'feat: a\n\nAuthored by hand.');
    const { out } = run('no-ai-attribution.mjs', r.root);
    assert.deepEqual(out.new, []);
  });

  test('a PR that loosens the hook is judged by the base hook', () => {
    const r = repo({ '.githooks/commit-msg': hook });
    const loose = hook.replace(/grep -Eiq '[^']+'/, "grep -Eiq '^never-matches$'");
    assert.notEqual(loose, hook);
    r.commit({ '.githooks/commit-msg': loose }, 'chore: relax the hook');
    r.commit({ 'a.txt': 'a\n' }, 'feat: a\n\nCo-Authored-By: Someone <noreply@anthropic.com>');
    const { out } = run('no-ai-attribution.mjs', r.root);
    assert.equal(out.new.length, 1);
    assert.equal(out.new[0].line, 3);
  });

  test('a hook without its pattern is an error', () => {
    const r = repo({ '.githooks/commit-msg': '#!/bin/sh\n' });
    r.commit({ 'a.txt': 'a\n' });
    const { status, out } = run('no-ai-attribution.mjs', r.root);
    assert.equal(status, 1);
    assert.equal(out.status, 'error');
  });
});

describe('rl-0011 workflow-pins', () => {
  const sha = 'a'.repeat(40);
  const good = `name: ok\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@${sha} # v7\n      - uses: ./local\n`;

  test('a tag pin and missing permissions are findings', () => {
    const r = repo({ '.github/workflows/ok.yml': good });
    r.commit({ '.github/workflows/bad.yml': 'name: bad\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n' });
    const { out } = run('workflow-pins.mjs', r.root);
    assert.deepEqual(messages(out), ['no top-level permissions', 'not pinned by SHA: actions/checkout@v7']);
    assert.equal(out.total, 2);
  });

  test('SHA pins with permissions are clean', () => {
    const r = repo({ '.github/workflows/ok.yml': good });
    r.commit({ '.github/workflows/ok2.yml': good });
    const { out } = run('workflow-pins.mjs', r.root);
    assert.deepEqual(out.new, []);
    assert.equal(out.total, 0);
  });
});

describe('rl-0012 secret-scan', () => {
  // Built at run time, so this file holds no token shape itself.
  const awsKey = ['AKIA', 'Q'.repeat(16)].join('');
  const remoteUrl = ['postgres://app:', 'hunter2', '@db.example.com:5432/x'].join('');

  test('a token shape or remote database password is a finding', () => {
    const r = repo({ 'README.md': 'x\n' });
    r.commit({ 'config.ts': `export const a = 1;\nconst k = '${awsKey}';\nconst u = '${remoteUrl}';\n` });
    const { out } = run('secret-scan.mjs', r.root);
    assert.deepEqual(out.new, [
      { path: 'config.ts', line: 2, message: 'AWS access key id' },
      { path: 'config.ts', line: 3, message: 'Postgres URL with a password' },
    ]);
  });

  test('a local throwaway URL and a variable are clean', () => {
    const r = repo({ 'README.md': 'x\n' });
    r.commit({
      'ci.yml': 'url: postgres://postgres:postgres@localhost:5432/postgres\nprod: postgres://app:${PASSWORD}@db.example.com/x\n',
    });
    const { out } = run('secret-scan.mjs', r.root);
    assert.deepEqual(out.new, []);
  });
});
