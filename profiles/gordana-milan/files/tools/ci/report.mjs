// What the scorecard shows: the PR comment and the history row, built
// from the verdict and what the jobs reported. Pure; no I/O.

export const MARKER = '<!-- rsb-scorecard -->';

// The test stages, in the comment's order.
const SUITES = [
  { stage: 'unit', label: 'unit' },
  { stage: 'db-tests', label: 'db (Postgres)' },
  { stage: 'e2e', label: 'e2e journeys' },
];

const na = (v) => (v === null || v === undefined ? 'n/a' : String(v));

// The stage a rule's CI step runs as: the pr.yml step that names the
// step's text (its command or its name) and runs through run-stage.
export function stageForStep(workflow, step) {
  for (const block of workflow.split(/\n(?=\s*- (?:name|uses|run|if|id):)/)) {
    const m = /--stage ([a-z][a-z0-9-]*)/.exec(block);
    if (m !== null && block.includes(step)) return m[1];
  }
  return null;
}

// `git diff --shortstat` output, `3 files changed, 120 insertions(+), 34
// deletions(-)`; empty when nothing changed.
export function parseShortstat(text) {
  const n = (re) => Number(re.exec(text)?.[1] ?? 0);
  return { added: n(/(\d+) insertions?\(\+\)/), deleted: n(/(\d+) deletions?\(-\)/) };
}

// A PR body line `<key>: <value>`, as the exception lines are read; null
// if absent.
export function bodyLine(body, key) {
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = new RegExp(`^${key}:[ \\t]+(\\S.*?)\\s*$`).exec(line);
    if (m !== null) return m[1];
  }
  return null;
}

// One row per non-draft rule. A script rule shows its JSON line, and has
// no row if it did not report; a CI-step rule shows the stages it is
// checked by.
// input: { rules, ruleLines, exceptions: Map | null, stages, workflow }
export function ruleRows(input) {
  const rows = [];
  for (const rule of input.rules.filter((r) => r.lifecycle !== 'draft')) {
    if (rule.checks.some((c) => c.kind === 'script')) {
      const line = (input.ruleLines ?? []).find((l) => l.rule === rule.id);
      if (line === undefined) continue;
      if (line.status === 'error') {
        rows.push({ rule: rule.id, by: 'script', new: 'error', total: null, suppressed: null });
        continue;
      }
      const n = (line.new ?? []).length;
      const excepted = n > 0 && input.exceptions !== null && input.exceptions.has(rule.id);
      rows.push({ rule: rule.id, by: 'script', new: n, total: line.total ?? null, suppressed: excepted ? n : 0 });
      continue;
    }
    const by = rule.checks
      .filter((c) => c.ci !== undefined)
      .map((c) => {
        const stage = stageForStep(input.workflow, c.ci.step);
        if (stage === null) return `${c.ci.step}: no stage`;
        return `${stage} ${input.stages[stage]?.status ?? 'n/a'}`;
      });
    rows.push({ rule: rule.id, by: [...new Set(by)].join(', '), new: null, total: null, suppressed: null });
  }
  return rows;
}

// The tests' totals across the suites that ran. null if a suite ran and
// its counts are unknown; 0 if none ran.
export function testTotals(stages) {
  const totals = { passed: 0, failed: 0, flaky: 0 };
  for (const { stage } of SUITES) {
    const s = stages[stage];
    if (s === undefined) continue;
    if (s.counts === null || s.counts === undefined) return { passed: null, failed: null, flaky: null };
    for (const k of Object.keys(totals)) totals[k] += s.counts[k];
  }
  return totals;
}

// input: { result, sha, seconds, clockError, lines: { added, deleted } |
// { error }, stages, rows }
export function renderComment(input) {
  const { result, lines } = input;
  const changed = lines.error !== undefined ? `n/a (${lines.error})` : `${lines.added + lines.deleted} (+${lines.added} / -${lines.deleted})`;
  const out = [
    MARKER,
    `## Scorecard: ${result.verdict}`,
    '',
    '| | |',
    '|---|---|',
    `| Commit | \`${input.sha.slice(0, 7) || 'local'}\` |`,
    `| Verdict time | ${input.seconds === null ? `n/a (${input.clockError})` : `${input.seconds} s`} |`,
    `| Lines changed | ${changed} |`,
    '',
  ];
  const reasons = [...result.red.map((m) => `- RED: ${m}`), ...result.amber.map((m) => `- AMBER: ${m}`)];
  if (reasons.length > 0) out.push(...reasons, '');
  out.push('### Tests', '| Suite | Passed | Failed | Flaky | Patch coverage |', '|---|--:|--:|--:|--:|');
  for (const { stage, label } of SUITES) {
    const c = input.stages[stage]?.counts ?? null;
    out.push(`| ${label} | ${na(c?.passed)} | ${na(c?.failed)} | ${na(c?.flaky)} | n/a |`);
  }
  out.push('', '### Rules', '| Rule | Checked by | New | Total | Suppressed |', '|---|---|--:|--:|--:|');
  for (const r of input.rows) out.push(`| ${r.rule} | ${r.by} | ${na(r.new)} | ${na(r.total)} | ${na(r.suppressed)} |`);
  out.push('');
  return out.join('\n');
}

// The history row (step 6's fourteen fields). timestamp is the merge
// time and is null here; the desk script fills it, and re-reads
// read_diff, at merge.
// input: { runId, repo, sha, pr, verdict, stages, lines, seconds, pull }
export function historyRow(input) {
  const t = testTotals(input.stages);
  const labels = input.pull?.labels ?? [];
  const readDiff = labels.includes('read-diff:yes') ? 'yes' : labels.includes('read-diff:no') ? 'no' : null;
  return {
    run_id: input.runId,
    repo: input.repo,
    sha: input.sha,
    pr: input.pr,
    verdict: input.verdict,
    tests_pass: t.passed,
    tests_failed: t.failed,
    flaky: t.flaky,
    lines_changed: input.lines.error !== undefined ? null : input.lines.added + input.lines.deleted,
    verdict_seconds: input.seconds,
    agent: bodyLine(input.pull?.body, 'Agent'),
    model: bodyLine(input.pull?.body, 'Model'),
    timestamp: null,
    read_diff: readDiff,
  };
}
