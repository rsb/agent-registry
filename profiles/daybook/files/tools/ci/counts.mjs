// A test suite's counts, read from the summary its runner prints: the
// stage file's counts, { passed, failed, flaky, skipped }. Pure; no I/O.
// null when no summary line is found, which the scorecard shows as n/a.
//
// Read from stdout, not a JSON reporter, so the commands in pr.yml stay
// as they are. A suite with no retries has no flaky tests.

// Colour codes off. pnpm's `<package> <script>: ` prefix is allowed for.
const ESC = String.fromCharCode(27);
const strip = (text) => text.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

const zero = () => ({ passed: 0, failed: 0, flaky: 0, skipped: 0 });

// vitest: `Tests  1 failed | 40 passed (41)`, once per package in a
// recursive run, so the lines are summed. `Test Files` lines do not match.
function vitest(text) {
  const counts = zero();
  let found = false;
  for (const m of text.matchAll(/(?:^|\s)Tests\s{2,}([^\n(]+)\(\d+\)/gm)) {
    found = true;
    for (const part of m[1].split('|')) {
      const p = /^\s*(\d+) (\w+)/.exec(part);
      if (p === null) continue;
      if (p[2] === 'passed' || p[2] === 'failed') counts[p[2]] += Number(p[1]);
      else if (p[2] === 'skipped' || p[2] === 'todo') counts.skipped += Number(p[1]);
    }
  }
  return found ? counts : null;
}

// Playwright: `  3 passed (12.3s)`, `  1 failed`, `  1 flaky`,
// `  2 skipped`, one per line at the end of the run.
function playwright(text) {
  const counts = zero();
  let found = false;
  for (const m of text.matchAll(/^(?:.*: )?\s*(\d+) (passed|failed|flaky|skipped)(?: \([^)]*\))?\s*$/gm)) {
    found = true;
    counts[m[2]] += Number(m[1]);
  }
  return found ? counts : null;
}

const PARSERS = { vitest, playwright };
export const COUNT_KINDS = Object.keys(PARSERS);

export function parseCounts(kind, text) {
  return PARSERS[kind](strip(text));
}
