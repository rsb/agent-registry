// Checks rules.json against the repo, so the hand-render cannot drift:
// ids are unique; each source pointer resolves to a numbered rule in
// engineering/*.md that is not a "Moved to" stub; each check's ref
// exists; each CI pointer names a step of the named job in its workflow,
// by a run: line or a step name, never a comment; each script rule is
// the script's own id; and AGENTS.md's rules region lists every rule, in
// order. --root <repo> (default: cwd), --config <file> (default:
// rules.json beside this file).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, parseJson, readText } from './lib.mjs';

function args(argv) {
  const opts = { root: process.cwd(), config: new URL('./rules.json', import.meta.url) };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i + 1];
    if ((argv[i] === '--root' || argv[i] === '--config') && v !== undefined) {
      opts[argv[i].slice(2)] = v;
      i += 1;
    } else return err(`unknown argument: ${argv[i]}`);
  }
  return ok(opts);
}

function sourceProblem(root, source) {
  if (!/^engineering\/[a-z-]+\.md$/.test(source.file)) return `${source.file} is not engineering/*.md`;
  const text = readText(join(root, source.file));
  if (!text.ok) return text.error;
  const line = text.value.split('\n').find((l) => l.startsWith(`${source.number}. `));
  if (line === undefined) return `${source.file} has no rule ${source.number}`;
  if (/^\d+\. Moved to /.test(line)) return `${source.file} rule ${source.number} is a stub: ${line}`;
  return null;
}

// A plain YAML scalar, its quotes and any trailing comment off.
function scalar(value) {
  const q = /^(['"])(.*)\1$/.exec(value);
  return q !== null ? q[2] : value.replace(/\s+#.*$/, '');
}

// The run: and name: values of one job's steps, a block scalar's lines
// joined. Only a step's own keys count, never a comment or a with: input.
// null if the file has no such job.
function jobSteps(text, job) {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  if (start === -1) return null;
  const steps = { run: [], name: [] };
  let key = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {0,2}\S/.test(line)) break;
    const item = /^(\s*)- /.exec(line);
    if (item !== null) key = item[1].length + 2;
    if (key === -1) continue;
    const m = new RegExp(`^(?: {${key - 2}}- | {${key}})(run|name):\\s*(.*)$`).exec(line);
    if (m === null) continue;
    let value = m[2];
    if (/^[>|][+-]?$/.test(value)) {
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) > key)) {
        i += 1;
        body.push(lines[i].trim());
      }
      value = body.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else value = scalar(value);
    steps[m[1]].push(value);
  }
  return steps;
}

// A step is named by its command, which a run: value contains, or by its
// name: in full.
function ciProblem(root, ci) {
  const text = readText(join(root, ci.file));
  if (!text.ok) return text.error;
  const steps = jobSteps(text.value, ci.job);
  if (steps === null) return `${ci.file} has no job ${ci.job}`;
  if (!steps.run.some((r) => r.includes(ci.step)) && !steps.name.includes(ci.step)) {
    return `${ci.file} job ${ci.job} has no step "${ci.step}"`;
  }
  return null;
}

function scriptProblem(root, id, ref) {
  const text = readText(join(root, ref));
  if (!text.ok) return text.error;
  if (!text.value.includes(`const RULE = '${id}';`)) return `${ref} does not report as ${id}`;
  return null;
}

function regionIds(root) {
  const text = readText(join(root, 'AGENTS.md'));
  if (!text.ok) return text;
  const lines = text.value.split('\n');
  const begin = lines.indexOf('<!-- rsb:rules:begin -->');
  const end = lines.indexOf('<!-- rsb:rules:end -->');
  if (begin === -1 || end < begin) return err('AGENTS.md has no rsb:rules region');
  return ok(lines.slice(begin + 1, end).flatMap((l) => /^- (rl-\d{4}):/.exec(l)?.[1] ?? []));
}

function check(argv) {
  const opts = args(argv);
  if (!opts.ok) return opts;
  const root = opts.value.root;
  const text = readText(opts.value.config);
  if (!text.ok) return text;
  const config = parseJson(text.value, 'rules.json');
  if (!config.ok) return config;
  const rules = config.value.rules;
  if (!Array.isArray(rules)) return err('rules.json has no rules array');

  const problems = [];
  const seen = new Set();
  for (const r of rules) {
    const at = (p) => problems.push(`${r.id}: ${p}`);
    if (!/^rl-\d{4}$/.test(r.id)) at('id is not rl-NNNN');
    if (seen.has(r.id)) at('duplicate id');
    seen.add(r.id);
    if (r.source !== null) {
      const p = sourceProblem(root, r.source);
      if (p !== null) at(p);
    }
    for (const c of r.checks ?? []) {
      if (!existsSync(join(root, c.ref))) at(`ref ${c.ref} does not exist`);
      else if (c.kind === 'script') {
        const p = scriptProblem(root, r.id, c.ref);
        if (p !== null) at(p);
      }
      if (c.ci !== undefined) {
        const p = ciProblem(root, c.ci);
        if (p !== null) at(p);
      }
    }
  }
  for (const [name, id] of Object.entries(config.value.eslint_rule_map ?? {})) {
    if (!seen.has(id)) problems.push(`eslint_rule_map: ${name} maps to unknown ${id}`);
  }
  const listed = regionIds(root);
  if (!listed.ok) problems.push(listed.error);
  else if (listed.value.join(' ') !== rules.map((r) => r.id).join(' ')) {
    problems.push(`AGENTS.md rules region lists ${listed.value.join(' ') || 'nothing'}, rules.json has ${rules.map((r) => r.id).join(' ')}`);
  }
  return ok(problems);
}

function main() {
  const result = check(process.argv.slice(2));
  if (!result.ok) {
    console.error(`pointers: ${result.error}`);
    return 2;
  }
  for (const p of result.value) console.error(`pointers: ${p}`);
  return result.value.length === 0 ? 0 : 1;
}

process.exitCode = main();
