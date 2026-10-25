// The verdict function's fixtures: RED, AMBER, GREEN, all-na, a script
// error, an exception used.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { STAGES, parseExceptions, verdict } from '../verdict.mjs';

const ok = (stage) => ({ stage, status: 'ok', seconds: 1, exit_code: 0, counts: null, error: null });
const allStages = () => Object.fromEntries(STAGES.map((s) => [s.name, ok(s.name)]));
const docsStages = () => Object.fromEntries(STAGES.filter((s) => !s.code).map((s) => [s.name, ok(s.name)]));
const pointers = { check: 'pointers', status: 'ok' };
const clean = (rule) => ({ rule, status: 'ok', new: [], total: null });
const finding = (rule) => ({ rule, status: 'ok', new: [{ path: '.githooks/commit-msg', line: null, message: 'M: owned path' }], total: null });
const SCRIPTS = ['rl-0008', 'rl-0009'];

const input = (over = {}) => ({
  code: true,
  stages: allStages(),
  ruleLines: [pointers, clean('rl-0008'), clean('rl-0009')],
  scriptRules: SCRIPTS,
  exceptions: { ok: true, value: new Map() },
  errors: [],
  ...over,
});

describe('verdict', () => {
  test('GREEN: every stage ok, no findings', () => {
    assert.deepEqual(verdict(input()), { verdict: 'GREEN', red: [], amber: [] });
  });

  test('RED: a failed stage', () => {
    const stages = { ...allStages(), e2e: { ...ok('e2e'), status: 'failed', exit_code: 1 } };
    const r = verdict(input({ stages }));
    assert.equal(r.verdict, 'RED');
    assert.deepEqual(r.red, ['e2e failed']);
  });

  test('RED: a failed test count, even on an ok stage', () => {
    const stages = { ...allStages(), unit: { ...ok('unit'), counts: { passed: 4, failed: 1, flaky: 0 } } };
    assert.deepEqual(verdict(input({ stages })).red, ['unit: 1 failed']);
  });

  test('RED: a finding with no exception', () => {
    const r = verdict(input({ ruleLines: [pointers, clean('rl-0008'), finding('rl-0009')] }));
    assert.equal(r.verdict, 'RED');
    assert.deepEqual(r.red, ['rl-0009: 1 new, no exception']);
  });

  test('RED: an exception for another rule does not cover the finding', () => {
    const exceptions = { ok: true, value: new Map([['rl-0008', 'alignment']]) };
    const r = verdict(input({ ruleLines: [pointers, clean('rl-0008'), finding('rl-0009')], exceptions }));
    assert.equal(r.verdict, 'RED');
  });

  test('RED: a finding when the exceptions could not be read', () => {
    const exceptions = { ok: false, error: 'GET /pulls/7: 403 Forbidden' };
    const r = verdict(input({ ruleLines: [pointers, clean('rl-0008'), finding('rl-0009')], exceptions }));
    assert.equal(r.verdict, 'RED');
    assert.match(r.red[0], /could not be read: GET \/pulls\/7: 403/);
  });

  test('GREEN: unreadable exceptions do not matter without findings', () => {
    const exceptions = { ok: false, error: 'no GITHUB_TOKEN' };
    assert.equal(verdict(input({ exceptions })).verdict, 'GREEN');
  });

  test('AMBER: an exception used', () => {
    const exceptions = { ok: true, value: new Map([['rl-0009', 'alignment']]) };
    const r = verdict(input({ ruleLines: [pointers, clean('rl-0008'), finding('rl-0009')], exceptions }));
    assert.deepEqual(r, { verdict: 'AMBER', red: [], amber: ['rl-0009: 1 new, exception: alignment'] });
  });

  test('AMBER: a flaky test', () => {
    const stages = { ...allStages(), e2e: { ...ok('e2e'), counts: { passed: 3, failed: 0, flaky: 1 } } };
    assert.deepEqual(verdict(input({ stages })), { verdict: 'AMBER', red: [], amber: ['e2e: 1 flaky'] });
  });

  test('RED: a rule script in error', () => {
    const r = verdict(input({ ruleLines: [pointers, clean('rl-0008'), { rule: 'rl-0009', status: 'error', error: 'git diff: bad revision' }] }));
    assert.equal(r.verdict, 'RED');
    assert.deepEqual(r.red, ['rl-0009 errored: git diff: bad revision']);
  });

  test('RED: a script rule that did not report, and broken pointers', () => {
    const r = verdict(input({ ruleLines: [{ check: 'pointers', status: 'error', error: 'rl-0004: no step' }, clean('rl-0008')] }));
    assert.deepEqual(r.red, ['pointers: rl-0004: no step', 'rl-0009 did not report']);
  });

  test('RED: the rules stage ran and wrote no lines', () => {
    assert.deepEqual(verdict(input({ ruleLines: null })).red, ['rules wrote no results']);
  });

  test('GREEN: all-na on a docs-only change', () => {
    assert.equal(verdict(input({ code: false, stages: docsStages() })).verdict, 'GREEN');
  });

  test('RED: all-na while code changed', () => {
    const r = verdict(input({ stages: docsStages() }));
    assert.equal(r.verdict, 'RED');
    assert.deepEqual(r.red, STAGES.filter((s) => s.code).map((s) => `${s.name} did not report`));
  });

  test('RED: nothing reported at all', () => {
    const r = verdict(input({ code: null, stages: {}, ruleLines: null }));
    assert.equal(r.verdict, 'RED');
    assert.equal(r.red[0], 'changes did not report, so code stages cannot be judged');
    assert.ok(r.red.includes('tools did not report'));
    assert.ok(r.red.includes('rules did not report'));
  });

  test('RED: an unreadable stage file', () => {
    assert.deepEqual(verdict(input({ errors: ['lint.json: Unexpected end of JSON input'] })).red, ['lint.json: Unexpected end of JSON input']);
  });

  test('the rules stage exit code is not judged, its lines are', () => {
    const stages = { ...allStages(), rules: { ...ok('rules'), status: 'failed', exit_code: 1 } };
    const exceptions = { ok: true, value: new Map([['rl-0009', 'alignment']]) };
    const r = verdict(input({ stages, ruleLines: [pointers, clean('rl-0008'), finding('rl-0009')], exceptions }));
    assert.equal(r.verdict, 'AMBER');
  });
});

describe('parseExceptions', () => {
  test('needs the label', () => {
    assert.equal(parseExceptions([], 'Exception: rl-0009 alignment').size, 0);
  });

  test('reads one line per rule, CRLF included', () => {
    const m = parseExceptions(['exception', 'other'], 'Body.\r\n\r\nException: rl-0009 alignment\r\nException: rl-0011 pin later  \r\n');
    assert.deepEqual([...m], [['rl-0009', 'alignment'], ['rl-0011', 'pin later']]);
  });

  test('a line without a reason, or not at the start, does not count', () => {
    const m = parseExceptions(['exception'], 'Exception: rl-0009\nException: rl-0009   \n> Exception: rl-0010 quoted\nexception: rl-0011 lower');
    assert.equal(m.size, 0);
  });

  test('a null body has none', () => {
    assert.equal(parseExceptions(['exception'], null).size, 0);
  });
});
