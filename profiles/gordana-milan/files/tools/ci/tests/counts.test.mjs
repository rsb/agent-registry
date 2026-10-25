// The runners' summaries, as pr.yml's stages print them.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCounts } from '../counts.mjs';

describe('vitest', () => {
  test('one package, all passed', () => {
    const out = ' ✓ tests/a.test.ts (3 tests) 5ms\n\n Test Files  2 passed (2)\n      Tests  41 passed (41)\n   Duration  1.2s\n';
    assert.deepEqual(parseCounts('vitest', out), { passed: 41, failed: 0, flaky: 0, skipped: 0 });
  });

  test('a recursive run sums the packages, through the pnpm prefix and colours', () => {
    const out = [
      'apps/api test:  Test Files  1 failed | 1 passed (2)',
      'apps/api test:       Tests  \x1b[31m1 failed\x1b[39m | \x1b[32m9 passed\x1b[39m (10)',
      'apps/web test:       Tests  30 passed | 2 skipped | 1 todo (33)',
    ].join('\n');
    assert.deepEqual(parseCounts('vitest', out), { passed: 39, failed: 1, flaky: 0, skipped: 3 });
  });

  test('no summary line is null', () => {
    assert.equal(parseCounts('vitest', 'No test files found, exiting with code 1\n'), null);
  });
});

describe('playwright', () => {
  test('passed only', () => {
    assert.deepEqual(parseCounts('playwright', '···\n\n  3 passed (12.3s)\n'), { passed: 3, failed: 0, flaky: 0, skipped: 0 });
  });

  test('failed, flaky and skipped, with the tests listed under them', () => {
    const out = [
      '··F',
      '  1) [chromium] › sign-in.spec.ts:3:1 › signs in ───',
      '  1 failed',
      '    [chromium] › sign-in.spec.ts:3:1 › signs in ───',
      '  1 flaky',
      '    [chromium] › log.spec.ts:9:1 › logs ───',
      '  1 skipped',
      '  2 passed (20.1s)',
    ].join('\n');
    assert.deepEqual(parseCounts('playwright', out), { passed: 2, failed: 1, flaky: 1, skipped: 1 });
  });

  test('no summary line is null', () => {
    assert.equal(parseCounts('playwright', 'Error: webServer timed out\n'), null);
  });
});
