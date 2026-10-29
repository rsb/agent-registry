// The scorecard job: reads the stage files the other jobs uploaded and
// the rules job's JSON lines, reads the PR's exceptions live through the
// API, and turns them into a verdict. It posts the verdict as one sticky
// PR comment, found by its marker and updated in place, writes the same
// text to the job summary, and writes the history row to row.json.
// Exits 1 on RED only. Node built-ins only.
//
// verdict_seconds runs from the start of the run's current attempt
// (run_started_at, the run's created_at on a first attempt) to just
// before the comment is posted, so a rerun after an exception does not
// count the owner's wait. Run outside Actions (no GITHUB_TOKEN), it reads no
// exceptions, posts nothing, reports no verdict_seconds and prints the
// comment.
//
//   node tools/ci/scorecard.mjs [--dir .scorecard] [--row row.json]
//
// Env: GITHUB_TOKEN, CODE (the changes job's output), PR_NUMBER (empty
// on push), HEAD_SHA, BASE (what lines changed is counted from), and the
// runner's GITHUB_* defaults.

import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { err, git, loadConfig, ok, parseJson, readText } from '../rules/lib.mjs';
import { MARKER, historyRow, parseShortstat, renderComment, ruleRows } from './report.mjs';
import { STAGES, parseExceptions, verdict } from './verdict.mjs';

const env = process.env;

// The directory's .json files; none if it does not exist.
function listJson(dir) {
  try {
    return ok(readdirSync(dir).filter((f) => f.endsWith('.json')));
  } catch (e) {
    return e.code === 'ENOENT' ? ok([]) : err(`${dir}: ${e.message}`);
  }
}

function readStages(dir) {
  const stages = {};
  const errors = [];
  const names = listJson(dir);
  if (!names.ok) return { stages, errors: [names.error] };
  const known = new Set(STAGES.map((s) => s.name));
  for (const name of names.value) {
    const text = readText(join(dir, name));
    const parsed = text.ok ? parseJson(text.value, name) : text;
    if (!parsed.ok) errors.push(parsed.error);
    else if (!known.has(parsed.value.stage)) errors.push(`${name}: unknown stage ${parsed.value.stage}`);
    else stages[parsed.value.stage] = parsed.value;
  }
  return { stages, errors };
}

function readRuleLines(dir) {
  const text = readText(join(dir, 'rules.jsonl'));
  if (!text.ok) return { lines: null, errors: [] };
  const lines = [];
  const errors = [];
  for (const l of text.value.split('\n').filter((x) => x.trim() !== '')) {
    const parsed = parseJson(l, 'rules.jsonl');
    if (parsed.ok) lines.push(parsed.value);
    else errors.push(parsed.error);
  }
  return { lines, errors };
}

const nonDraft = (rules) => rules.filter((r) => r.lifecycle !== 'draft');
const scriptRules = (rules) => nonDraft(rules).filter((r) => r.checks.some((c) => c.kind === 'script')).map((r) => r.id);

async function api(path, method = 'GET', body = undefined) {
  const token = env.GITHUB_TOKEN ?? '';
  if (token === '') return err('no GITHUB_TOKEN');
  const url = `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return err(`${method} ${path}: ${res.status} ${res.statusText}`);
    return ok(await res.json());
  } catch (e) {
    return err(`${method} ${path}: ${e.message}`);
  }
}

// The PR, read live so a label or body edit and a rerun take effect:
// { number, labels, body }, or null on a push with no merged PR. On push,
// the PR the merge commit came from. The pulls endpoints, not /issues,
// so pull-requests is the only permission it needs.
async function pullRequest() {
  const shape = (p) => ok({ number: p.number, labels: p.labels.map((l) => l.name), body: p.body });
  const pr = env.PR_NUMBER ?? '';
  if (pr !== '') {
    const pull = await api(`/pulls/${pr}`);
    return pull.ok ? shape(pull.value) : pull;
  }
  const sha = env.GITHUB_SHA ?? '';
  if (sha === '') return err('no PR_NUMBER and no GITHUB_SHA');
  const pulls = await api(`/commits/${sha}/pulls`);
  if (!pulls.ok) return pulls;
  const merged = pulls.value.find((p) => p.merge_commit_sha === sha);
  return merged === undefined ? ok(null) : shape(merged);
}

// The comment holding the marker, or null. Paginated.
async function findComment(pr) {
  for (let page = 1; ; page += 1) {
    const list = await api(`/issues/${pr}/comments?per_page=100&page=${page}`);
    if (!list.ok) return list;
    const found = list.value.find((c) => typeof c.body === 'string' && c.body.includes(MARKER));
    if (found !== undefined) return ok(found.id);
    if (list.value.length < 100) return ok(null);
  }
}

async function postComment(pr, body) {
  const found = await findComment(pr);
  if (!found.ok) return found;
  return found.value === null
    ? api(`/issues/${pr}/comments`, 'POST', { body })
    : api(`/issues/comments/${found.value}`, 'PATCH', { body });
}

// Lockfiles excluded.
function linesChanged() {
  const base = env.BASE ?? '';
  const head = env.HEAD_SHA || 'HEAD';
  if (base === '') return { error: 'no BASE' };
  const r = git(process.cwd(), ['diff', '--shortstat', `${base}...${head}`, '--', ':(glob,exclude)**/pnpm-lock.yaml']);
  return r.ok ? parseShortstat(r.value) : { error: r.error };
}

async function attemptStart() {
  const run = await api(`/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT || 1}`);
  if (!run.ok) return run;
  const t = Date.parse(run.value.run_started_at);
  return Number.isNaN(t) ? err(`run run_started_at: ${run.value.run_started_at}`) : ok(t);
}

function appendFile(file, text) {
  try {
    appendFileSync(file, text);
    return ok(null);
  } catch (e) {
    return err(`${file}: ${e.message}`);
  }
}

function writeFile(file, text) {
  try {
    writeFileSync(file, text);
    return ok(null);
  } catch (e) {
    return err(`${file}: ${e.message}`);
  }
}

function parse(argv) {
  const opts = { dir: '.scorecard', row: 'row.json' };
  for (let i = 0; i < argv.length; i += 2) {
    if ((argv[i] !== '--dir' && argv[i] !== '--row') || argv[i + 1] === undefined) return err('usage: scorecard.mjs [--dir <dir>] [--row <file>]');
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  return ok(opts);
}

async function main() {
  const opts = parse(process.argv.slice(2));
  if (!opts.ok) {
    console.error(opts.error);
    return 2;
  }
  const { dir, row } = opts.value;
  const t0 = attemptStart();
  const { stages, errors: stageErrors } = readStages(dir);
  const { lines, errors: lineErrors } = readRuleLines(dir);
  const config = loadConfig();
  const rules = config.ok ? config.value.rules : [];
  const workflow = readText('.github/workflows/pr.yml');
  const errors = [...stageErrors, ...lineErrors, ...(config.ok ? [] : [config.error])];
  const code = env.CODE === 'true' ? true : env.CODE === 'false' ? false : null;

  const pull = await pullRequest();
  const exceptions = pull.ok ? ok(parseExceptions(pull.value?.labels ?? [], pull.value?.body ?? null)) : pull;
  const result = verdict({ code, stages, ruleLines: lines, scriptRules: scriptRules(rules), exceptions, errors });
  const changed = linesChanged();
  const start = await t0;
  const seconds = start.ok ? Math.round((Date.now() - start.value) / 1000) : null;
  const sha = env.HEAD_SHA || env.GITHUB_SHA || '';

  const text = renderComment({
    result,
    sha,
    seconds,
    clockError: start.ok ? null : start.error,
    lines: changed,
    stages,
    rows: ruleRows({
      rules: nonDraft(rules),
      ruleLines: lines,
      exceptions: exceptions.ok ? exceptions.value : null,
      stages,
      workflow: workflow.ok ? workflow.value : '',
    }),
  });
  const pr = (env.PR_NUMBER ?? '') !== '' ? Number(env.PR_NUMBER) : null;
  const failures = [];
  if (pr !== null) {
    const posted = await postComment(pr, text);
    if (!posted.ok) failures.push(`comment: ${posted.error}`);
  }
  console.log(text);
  console.log(`verdict=${result.verdict} verdict_seconds=${seconds ?? 'null'}`);

  const record = historyRow({
    runId: Number(env.GITHUB_RUN_ID ?? 0) || null,
    repo: env.GITHUB_REPOSITORY ?? null,
    sha: sha || null,
    pr: pr ?? (pull.ok ? (pull.value?.number ?? null) : null),
    verdict: result.verdict,
    stages,
    lines: changed,
    seconds,
    pull: pull.ok ? pull.value : null,
  });
  const writes = [writeFile(row, `${JSON.stringify(record)}\n`)];
  if ((env.GITHUB_STEP_SUMMARY ?? '') !== '') writes.push(appendFile(env.GITHUB_STEP_SUMMARY, text));
  for (const w of writes) if (!w.ok) failures.push(w.error);
  // Not the verdict: shown as an annotation, and the exit code stays the
  // verdict's.
  for (const f of failures) console.log(`::error title=scorecard::${f}`);
  return result.verdict === 'RED' ? 1 : 0;
}

process.exitCode = await main();
