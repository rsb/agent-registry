// rl-0012: no raw secrets in the repo. Scans the lines a PR adds; --all
// scans the whole head. The pre-commit hook runs no scanner, so this is a
// short list of high-confidence token shapes, not gitleaks.

import { git, ok, parseArgs, report, resolveRange } from './lib.mjs';

const RULE = 'rl-0012';

const SHAPES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b[rs]k_live_[0-9A-Za-z]{20,}/],
  ['Axiom token', /\bxaa[pt]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
];

// A Postgres URL with a password, unless it points at this machine or the
// password is a variable.
const PG_URL = /postgres(?:ql)?:\/\/[^:@\s/]+:([^@\s]+)@([^/:?\s]+)/;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

function lineFindings(path, line, text) {
  const out = SHAPES.filter(([, re]) => re.test(text)).map(([name]) => ({ path, line, message: name }));
  const pg = PG_URL.exec(text);
  if (pg !== null && !LOCAL.has(pg[2]) && !/^\$/.test(pg[1])) {
    out.push({ path, line, message: 'Postgres URL with a password' });
  }
  return out;
}

// Added lines from a zero-context diff, with their line numbers at head.
function addedLines(diff) {
  const out = [];
  let path = null;
  let line = 0;
  let header = false;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      header = true;
    } else if (header && l.startsWith('+++ ')) {
      path = l === '+++ /dev/null' ? null : l.slice(6);
    } else if (l.startsWith('@@ ')) {
      header = false;
      const m = /\+(\d+)/.exec(l);
      line = m === null ? 0 : Number(m[1]);
    } else if (l.startsWith('+') && path !== null) {
      out.push({ path, line, text: l.slice(1) });
      line += 1;
    }
  }
  return out;
}

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const diff = git(opts.value.root, [
    'diff', '-U0', '--no-color', '--no-ext-diff', range.value.base, range.value.head,
  ]);
  if (!diff.ok) return diff;
  const findings = addedLines(diff.value).flatMap((a) => lineFindings(a.path, a.line, a.text));
  return ok({ findings, total: range.value.all ? findings.length : null });
}

process.exitCode = report(RULE, check(process.argv.slice(2)));
