// Checks rules.json against the repo, so the hand-render cannot drift:
// ids are unique; each source pointer resolves to a numbered rule in
// engineering/*.md that is not a "Moved to" stub; each check's ref
// exists; each CI pointer names a job and step in its workflow; each
// script rule is the script's own id; and AGENTS.md's rules region lists
// every rule, in order. --root <repo> (default: cwd), --config <file>
// (default: rules.json beside this file).

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

function ciProblem(root, ci) {
  const text = readText(join(root, ci.file));
  if (!text.ok) return text.error;
  if (!new RegExp(`^  ${ci.job}:$`, 'm').test(text.value)) return `${ci.file} has no job ${ci.job}`;
  if (!text.value.includes(ci.step)) return `${ci.file} has no step "${ci.step}"`;
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
