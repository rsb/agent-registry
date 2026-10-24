// rl-0008, migration rule 9: a migration that exists at the merge-base is
// never modified, renamed or deleted, and a new one sorts after the newest
// there. A baseline (migration rule 18) is a recorded exception.

import { changedPaths, err, listFiles, loadConfig, ok, parseArgs, report, resolveRange } from './lib.mjs';

const RULE = 'rl-0008';

const verbs = { M: 'modifies', D: 'deletes', R: 'renames', T: 'changes the type of' };

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const config = loadConfig();
  if (!config.ok) return config;
  const dir = config.value.migrations_dir;
  if (typeof dir !== 'string') return err('rules.json has no migrations_dir');
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const root = opts.value.root;

  const inDir = (p) => p !== null && p.startsWith(`${dir}/`) && p.endsWith('.sql');
  const atBase = listFiles(root, range.value.base, dir);
  if (!atBase.ok) return atBase;
  const baseFiles = atBase.value.filter(inDir);
  const newest = baseFiles.map((p) => p.slice(dir.length + 1)).sort().at(-1) ?? null;

  const changes = changedPaths(root, range.value);
  if (!changes.ok) return changes;
  const findings = [];
  for (const c of changes.value) {
    const old = c.status === 'R' ? c.from : c.path;
    if (inDir(old) && verbs[c.status] !== undefined) {
      const to = c.status === 'R' ? ` to ${c.path}` : '';
      findings.push({
        path: old,
        line: null,
        message: `${verbs[c.status]} a migration already on the base${to} (migration rule 9)`,
      });
    }
    const added = c.status === 'A' || c.status === 'C' || (c.status === 'R' && !inDir(c.from));
    if (added && inDir(c.path) && newest !== null && c.path.slice(dir.length + 1) <= newest) {
      findings.push({
        path: c.path,
        line: null,
        message: `sorts before or at ${newest}, the newest migration on the base (migration rule 9)`,
      });
    }
  }
  return ok({ findings, total: null });
}

process.exitCode = report(RULE, check(process.argv.slice(2)));
