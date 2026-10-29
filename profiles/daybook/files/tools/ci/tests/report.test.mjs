// The comment and the history row, from fixtures.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MARKER, bodyLine, historyRow, parseShortstat, renderComment, ruleRows, stageForStep } from '../report.mjs';

const WORKFLOW = `
    steps:
      - run: node tools/ci/run-stage.mjs --stage lint -- pnpm lint
      - if: \${{ !cancelled() }}
        run: node tools/ci/run-stage.mjs --stage unit --counts vitest -- pnpm --recursive --filter '!@gm/db' test
      - name: schema.sql matches the migrations
        if: \${{ !cancelled() }}
        run: >-
          node tools/ci/run-stage.mjs --stage schema-diff -- sh -ec '
          pnpm db:schema'
      - run: pnpm install --frozen-lockfile
`;

const ciRule = (id, step) => ({ id, lifecycle: 'trial', checks: [{ kind: 'ci-step', ci: { file: 'pr.yml', job: 'x', step } }] });
const scriptRule = (id, lifecycle = 'trial') => ({ id, lifecycle, checks: [{ kind: 'script', ref: 'x.mjs' }] });
const stage = (name, status = 'ok', counts = null) => ({ stage: name, status, seconds: 1, exit_code: 0, counts, error: null });

describe('stageForStep', () => {
  test('finds the stage by command or by step name', () => {
    assert.equal(stageForStep(WORKFLOW, 'pnpm lint'), 'lint');
    assert.equal(stageForStep(WORKFLOW, "pnpm --recursive --filter '!@gm/db' test"), 'unit');
    assert.equal(stageForStep(WORKFLOW, 'schema.sql matches the migrations'), 'schema-diff');
  });

  test('a step that is not a stage is null', () => {
    assert.equal(stageForStep(WORKFLOW, 'pnpm install --frozen-lockfile'), null);
  });
});

describe('ruleRows', () => {
  const rules = [ciRule('rl-0001', 'pnpm lint'), ciRule('rl-0004', 'schema.sql matches the migrations'), scriptRule('rl-0008'), scriptRule('rl-0009'), scriptRule('rl-0010'), scriptRule('rl-0013', 'draft')];
  const finding = { path: 'x', line: null, message: 'm' };
  const rows = ruleRows({
    rules,
    ruleLines: [
      { check: 'pointers', status: 'ok' },
      { rule: 'rl-0008', status: 'ok', new: [], total: null },
      { rule: 'rl-0009', status: 'ok', new: [finding, finding], total: 5 },
    ],
    exceptions: new Map([['rl-0009', 'alignment']]),
    stages: { lint: stage('lint', 'failed') },
    workflow: WORKFLOW,
  });

  test('one row per non-draft rule that reported, zero rows included', () => {
    assert.deepEqual(rows, [
      { rule: 'rl-0001', by: 'lint failed', new: null, total: null, suppressed: null },
      { rule: 'rl-0004', by: 'schema-diff n/a', new: null, total: null, suppressed: null },
      { rule: 'rl-0008', by: 'script', new: 0, total: null, suppressed: 0 },
      { rule: 'rl-0009', by: 'script', new: 2, total: 5, suppressed: 2 },
    ]);
  });

  test('without an exception nothing is suppressed; an error shows as such', () => {
    const r = ruleRows({
      rules: [scriptRule('rl-0009'), scriptRule('rl-0010')],
      ruleLines: [{ rule: 'rl-0009', status: 'ok', new: [finding], total: null }, { rule: 'rl-0010', status: 'error', error: 'bad' }],
      exceptions: null,
      stages: {},
      workflow: '',
    });
    assert.deepEqual(r.map((x) => [x.new, x.suppressed]), [[1, 0], ['error', null]]);
  });
});

test('parseShortstat', () => {
  assert.deepEqual(parseShortstat(' 3 files changed, 120 insertions(+), 34 deletions(-)\n'), { added: 120, deleted: 34 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 deletion(-)\n'), { added: 0, deleted: 1 });
  assert.deepEqual(parseShortstat(''), { added: 0, deleted: 0 });
});

test('bodyLine', () => {
  assert.equal(bodyLine('Fixes #3.\r\nAgent: claude-code\r\nModel: some-model  \r\n', 'Model'), 'some-model');
  assert.equal(bodyLine('Agent:\n> Agent: quoted', 'Agent'), null);
  assert.equal(bodyLine(null, 'Agent'), null);
});

describe('renderComment', () => {
  const base = {
    result: { verdict: 'AMBER', red: [], amber: ['rl-0009: 2 new, exception: alignment'] },
    sha: 'abc1234def',
    seconds: 143,
    clockError: null,
    lines: { added: 120, deleted: 34 },
    stages: { unit: stage('unit', 'ok', { passed: 41, failed: 0, flaky: 0, skipped: 0 }), 'db-tests': stage('db-tests') },
    rows: [{ rule: 'rl-0009', by: 'script', new: 2, total: null, suppressed: 2 }],
  };

  test('the fixed layout, marker first', () => {
    assert.equal(
      renderComment(base),
      [
        MARKER,
        '## Scorecard: AMBER',
        '',
        '| | |',
        '|---|---|',
        '| Commit | `abc1234` |',
        '| Verdict time | 143 s |',
        '| Lines changed | 154 (+120 / -34) |',
        '',
        '- AMBER: rl-0009: 2 new, exception: alignment',
        '',
        '### Tests',
        '| Suite | Passed | Failed | Flaky | Patch coverage |',
        '|---|--:|--:|--:|--:|',
        '| unit | 41 | 0 | 0 | n/a |',
        '| db (Postgres) | n/a | n/a | n/a | n/a |',
        '| e2e journeys | n/a | n/a | n/a | n/a |',
        '',
        '### Rules',
        '| Rule | Checked by | New | Total | Suppressed |',
        '|---|---|--:|--:|--:|',
        '| rl-0009 | script | 2 | n/a | 2 |',
        '',
      ].join('\n'),
    );
  });

  test('no clock and no diff show why', () => {
    const text = renderComment({ ...base, seconds: null, clockError: 'no GITHUB_TOKEN', lines: { error: 'no BASE' } });
    assert.match(text, /\| Verdict time \| n\/a \(no GITHUB_TOKEN\) \|/);
    assert.match(text, /\| Lines changed \| n\/a \(no BASE\) \|/);
  });
});

describe('historyRow', () => {
  const input = {
    runId: 42,
    repo: 'rsb/daybook',
    sha: 'abc',
    pr: 7,
    verdict: 'GREEN',
    stages: {
      unit: stage('unit', 'ok', { passed: 40, failed: 0, flaky: 0, skipped: 1 }),
      'db-tests': stage('db-tests', 'ok', { passed: 18, failed: 0, flaky: 0, skipped: 0 }),
      e2e: stage('e2e', 'ok', { passed: 3, failed: 0, flaky: 1, skipped: 0 }),
    },
    lines: { added: 10, deleted: 2 },
    seconds: 99,
    pull: { number: 7, labels: ['read-diff:no'], body: 'Agent: claude-code\nModel: m-1' },
  };

  test('the fourteen fields', () => {
    assert.deepEqual(historyRow(input), {
      run_id: 42,
      repo: 'rsb/daybook',
      sha: 'abc',
      pr: 7,
      verdict: 'GREEN',
      tests_pass: 61,
      tests_failed: 0,
      flaky: 1,
      lines_changed: 12,
      verdict_seconds: 99,
      agent: 'claude-code',
      model: 'm-1',
      timestamp: null,
      read_diff: 'no',
    });
  });

  test('a suite that ran without counts makes the totals unknown; nothing known is null, never guessed', () => {
    const row = historyRow({ ...input, stages: { ...input.stages, e2e: stage('e2e') }, lines: { error: 'x' }, pull: null });
    assert.deepEqual([row.tests_pass, row.flaky, row.lines_changed, row.agent, row.read_diff], [null, null, null, null, null]);
  });

  test('no suite ran: zero tests', () => {
    assert.equal(historyRow({ ...input, stages: {} }).tests_pass, 0);
  });
});
