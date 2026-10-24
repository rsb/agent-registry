// rl-0009: owned governance files change only with a recorded exception.
// This reports every change to an owned path or marked AGENTS.md region;
// the scorecard counts one as suppressed when the PR carries the
// exception label and body line. No path is carved out here.

import { changedPaths, err, globToRegExp, loadConfig, ok, parseArgs, report, resolveRange, showFile } from './lib.mjs';

const RULE = 'rl-0009';

// The lines between <!-- name:begin --> and <!-- name:end -->, with the
// begin marker's line number, or null if the region is absent.
function region(text, name) {
  if (text === null) return null;
  const lines = text.split('\n');
  const begin = lines.indexOf(`<!-- ${name}:begin -->`);
  const end = lines.indexOf(`<!-- ${name}:end -->`);
  if (begin === -1 || end === -1 || end < begin) return null;
  return { line: begin + 1, body: lines.slice(begin + 1, end).join('\n') };
}

function check(argv) {
  const opts = parseArgs(argv);
  if (!opts.ok) return opts;
  const config = loadConfig();
  if (!config.ok) return config;
  const { owned_paths: paths, owned_regions: regions } = config.value;
  if (!Array.isArray(paths) || !Array.isArray(regions)) {
    return err('rules.json needs owned_paths and owned_regions');
  }
  const range = resolveRange(opts.value);
  if (!range.ok) return range;
  const root = opts.value.root;

  const globs = paths.map((g) => ({ glob: g, re: globToRegExp(g) }));
  const ownedBy = (p) => (p === null ? undefined : globs.find((g) => g.re.test(p)));

  const changes = changedPaths(root, range.value);
  if (!changes.ok) return changes;
  const findings = [];
  for (const c of changes.value) {
    const hit = ownedBy(c.path) ?? ownedBy(c.from);
    if (hit !== undefined) {
      const from = c.from !== null ? ` from ${c.from}` : '';
      findings.push({ path: c.path, line: null, message: `${c.status}${from}: owned path (${hit.glob})` });
    }
  }

  const changed = new Set(changes.value.map((c) => c.path));
  for (const r of regions) {
    if (!changed.has(r.path)) continue;
    const before = showFile(root, range.value.base, r.path);
    if (!before.ok) return before;
    const after = showFile(root, range.value.head, r.path);
    if (!after.ok) return after;
    const a = region(before.value, r.region);
    const b = region(after.value, r.region);
    if (a?.body !== b?.body) {
      findings.push({ path: r.path, line: b?.line ?? null, message: `owned region ${r.region} changed` });
    }
  }
  return ok({ findings, total: null });
}

process.exitCode = report(RULE, check(process.argv.slice(2)));
