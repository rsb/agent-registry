// Runs pointers.mjs, then every script rule in rules.json that is not a
// draft, passing the arguments through (--base, --head, --root, --all).
// Prints each script's JSON line. Exits 1 if any script errors, reports a
// new finding, or the pointers fail. Rules backed by a CI step are not
// run here; the scorecard reads those steps' results.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseJson } from './lib.mjs';

const node = (script, argv) =>
  spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...argv], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

// The script's JSON line; output that does not parse becomes an error line.
function runScript(ref, argv) {
  const r = node(`../../${ref}`, argv);
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  const parsed = parseJson(line, ref);
  return parsed.ok ? parsed.value : { rule: null, status: 'error', error: `${parsed.error}; exit ${r.status}` };
}

function main() {
  const argv = process.argv.slice(2);
  const rootAt = argv.indexOf('--root');
  const pointers = node('./pointers.mjs', rootAt === -1 ? [] : ['--root', argv[rootAt + 1]]);
  let failed = pointers.status !== 0;

  const config = loadConfig();
  if (!config.ok) {
    console.error(`run: ${config.error}`);
    return 2;
  }
  for (const rule of config.value.rules) {
    if (rule.lifecycle === 'draft') continue;
    for (const c of rule.checks.filter((k) => k.kind === 'script')) {
      const out = runScript(c.ref, argv);
      console.log(JSON.stringify(out));
      if (out.status === 'error' || (out.new ?? []).length > 0) failed = true;
    }
  }
  return failed ? 1 : 0;
}

process.exitCode = main();
