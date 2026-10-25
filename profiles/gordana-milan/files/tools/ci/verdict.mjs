// The scorecard's verdict: a pure function of what the jobs reported, so
// it is the part with fixtures. No I/O here.
//
// RED: a failed test or stage, a stage or rule script in error, a rule
// with new findings and no matching exception, or a stage that did not
// report while the changes job says code changed. AMBER: otherwise, a
// flaky test or a used exception. GREEN: otherwise.

// Every stage pr.yml writes. code: true runs only when code changed.
// The rules stage is judged by its JSON lines, not its exit code: the
// lines carry the findings, and an error or failed pointers line too.
// pr.yml runs it with --ci, so a finding alone does not fail the stage.
export const STAGES = [
  { name: 'typecheck', code: true },
  { name: 'lint', code: true },
  { name: 'knip', code: true },
  { name: 'build', code: true },
  { name: 'startup', code: true },
  { name: 'db-tests', code: true },
  { name: 'unit', code: true },
  { name: 'e2e', code: true },
  { name: 'schema-diff', code: true },
  { name: 'rules', code: false, byLines: true },
  { name: 'tools', code: false },
];

const LABEL = 'exception';

// The exceptions a PR records: the label, and one body line per rule,
// `Exception: <rule-id> <reason>`, reason non-empty. Without the label
// there are none.
export function parseExceptions(labels, body) {
  const map = new Map();
  if (!labels.includes(LABEL)) return map;
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = /^Exception:[ \t]+(rl-\d{4})[ \t]+(\S.*?)\s*$/.exec(line);
    if (m !== null) map.set(m[1], m[2]);
  }
  return map;
}

function judgeStages(input, red, amber) {
  if (input.code === null) red.push('changes did not report, so code stages cannot be judged');
  for (const s of STAGES) {
    const r = input.stages[s.name];
    const expected = !s.code || input.code === true;
    if (r === undefined) {
      if (expected) red.push(`${s.name} did not report`);
      continue;
    }
    if (s.byLines) continue;
    if (r.status === 'na' && expected) red.push(`${s.name} is na`);
    else if (r.status === 'failed') red.push(`${s.name} failed${r.error ? `: ${r.error}` : ''}`);
    else if (r.status !== 'ok' && r.status !== 'na') red.push(`${s.name} has status ${r.status}`);
    if ((r.counts?.failed ?? 0) > 0) red.push(`${s.name}: ${r.counts.failed} failed`);
    if ((r.counts?.flaky ?? 0) > 0) amber.push(`${s.name}: ${r.counts.flaky} flaky`);
  }
}

function judgeRules(input, red, amber) {
  if (input.stages.rules === undefined) return;
  if (input.ruleLines === null) {
    red.push('rules wrote no results');
    return;
  }
  const seen = new Set();
  for (const line of input.ruleLines) {
    if (line.check === 'pointers') {
      if (line.status !== 'ok') red.push(`pointers: ${line.error ?? line.status}`);
      continue;
    }
    seen.add(line.rule);
    if (line.status === 'error') {
      red.push(`${line.rule ?? 'a rule script'} errored: ${line.error}`);
      continue;
    }
    const n = (line.new ?? []).length;
    if (n === 0) continue;
    if (!input.exceptions.ok) {
      red.push(`${line.rule}: ${n} new, and the exceptions could not be read: ${input.exceptions.error}`);
      continue;
    }
    const reason = input.exceptions.value.get(line.rule);
    if (reason === undefined) red.push(`${line.rule}: ${n} new, no exception`);
    else amber.push(`${line.rule}: ${n} new, exception: ${reason}`);
  }
  if (!input.ruleLines.some((l) => l.check === 'pointers')) red.push('pointers did not report');
  for (const id of input.scriptRules) if (!seen.has(id)) red.push(`${id} did not report`);
}

// input: {
//   code: true | false | null,          the changes job's output, null if it did not report
//   stages: { [name]: stage file },     what .scorecard/ holds
//   ruleLines: [line] | null,           rules.jsonl, null if absent
//   scriptRules: [id],                  the non-draft script rules in rules.json
//   exceptions: { ok, value: Map } | { ok: false, error },
//   errors: [string],                   files that could not be read
// }
// Returns { verdict, red: [string], amber: [string] }.
export function verdict(input) {
  const red = [...input.errors];
  const amber = [];
  judgeStages(input, red, amber);
  judgeRules(input, red, amber);
  const v = red.length > 0 ? 'RED' : amber.length > 0 ? 'AMBER' : 'GREEN';
  return { verdict: v, red, amber };
}
