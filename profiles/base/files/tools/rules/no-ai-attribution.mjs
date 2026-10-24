// rl-0010: commit messages carry no AI attribution. The server twin of
// .githooks/commit-msg, which --no-verify skips. The pattern is read from
// the hook at the merge-base, so a PR that weakens the hook is still judged
// by the old one. With --all there is no base, so the hook at head is used.

import { err, git, ok, parseArgs, report, resolveRange, showFile } from './lib.mjs';

const RULE = 'rl-0010';
const HOOK = '.githooks/commit-msg';

// The hook's attribution test is its one `grep -Eiq '<pattern>'`.
function hookPattern(root, rev) {
  const text = showFile(root, rev, HOOK);
  if (!text.ok) return text;
  if (text.value === null) return err(`${HOOK}: not found at ${rev.slice(0, 12)}`);
  const found = [...text.value.matchAll(/grep -Eiq '([^']+)'/g)];
  if (found.length !== 1) return err(`${HOOK}: expected one grep -Eiq pattern, found ${found.length}`);
  try {
    return ok(new RegExp(found[0][1], 'i'));
  } catch (e) {
    return err(`${HOOK}: ${e.message}`);
  }
}

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const root = opts.value.root;
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const pattern = hookPattern(root, range.value.all ? range.value.head : range.value.base);
  if (!pattern.ok) return pattern;
  const spec = range.value.all ? range.value.head : `${range.value.base}..${range.value.head}`;
  const log = git(root, ['log', '-z', '--format=%H%n%B', spec]);
  if (!log.ok) return log;

  const findings = [];
  for (const entry of log.value.split('\0').filter((e) => e.trim() !== '')) {
    const [sha, ...lines] = entry.replace(/^\n/, '').split('\n');
    lines.forEach((l, i) => {
      if (pattern.value.test(l)) {
        findings.push({ path: `commit ${sha.slice(0, 12)}`, line: i + 1, message: `AI attribution: ${l.trim()}` });
      }
    });
  }
  return ok({ findings, total: null });
}

process.exitCode = report(RULE, check(process.argv.slice(2)));
