// Runs one CI step's command as a scorecard stage and writes
// .scorecard/<stage>.json: { stage, status, seconds, exit_code, counts,
// error }. status is ok or failed; a skipped step writes nothing, which
// the scorecard reads as na. Exits with the command's code, so the job
// still fails.
//
//   node tools/ci/run-stage.mjs --stage <name> [--tee <file>] [--counts <kind>] [--dir <dir>] -- <command...>
//
// --tee also writes the command's stdout to <file> (the rules job's JSON
// lines). --counts reads the test counts from the stdout of a vitest or
// playwright run; without it, or without a summary line, counts is null.
// stdout is passed through as it comes. Node built-ins only.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok } from '../rules/lib.mjs';
import { COUNT_KINDS, parseCounts } from './counts.mjs';

function parse(argv) {
  const opts = { stage: null, tee: null, counts: null, dir: '.scorecard', command: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      opts.command = argv.slice(i + 1);
      break;
    }
    const v = argv[i + 1];
    if (['--stage', '--tee', '--counts', '--dir'].includes(a) && v !== undefined) {
      opts[a.slice(2)] = v;
      i += 1;
    } else return err(`unknown argument: ${a}`);
  }
  if (opts.stage === null || !/^[a-z][a-z0-9-]*$/.test(opts.stage)) return err('--stage <name> is required');
  if (opts.counts !== null && !COUNT_KINDS.includes(opts.counts)) return err(`--counts is one of ${COUNT_KINDS.join(', ')}`);
  if (opts.command.length === 0) return err('no command after --');
  return ok(opts);
}

function writeFile(path, text) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return ok(path);
  } catch (e) {
    return err(`${path}: ${e.message}`);
  }
}

// Resolves, never rejects: a spawn error is the result's error.
function runCommand(command, capture) {
  const started = performance.now();
  return new Promise((resolve) => {
    const chunks = [];
    let spawnError = null;
    const child = spawn(command[0], command.slice(1), { stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'] });
    child.stdout?.on('data', (chunk) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.on('error', (e) => {
      spawnError = `${command[0]}: ${e.message}`;
    });
    child.on('close', (code, signal) => {
      const seconds = Math.round((performance.now() - started) / 100) / 10;
      const error = spawnError ?? (signal ? `killed by ${signal}` : null);
      resolve({ exitCode: code ?? 1, seconds, stdout: Buffer.concat(chunks).toString('utf8'), error });
    });
  });
}

async function main() {
  const opts = parse(process.argv.slice(2));
  if (!opts.ok) {
    console.error(`run-stage: ${opts.error}`);
    return 2;
  }
  const { stage, tee, counts, dir, command } = opts.value;
  const run = await runCommand(command, tee !== null || counts !== null);
  let exitCode = run.exitCode;
  if (tee !== null) {
    const teed = writeFile(tee, run.stdout);
    if (!teed.ok) {
      console.error(`run-stage: ${teed.error}`);
      exitCode = exitCode === 0 ? 2 : exitCode;
    }
  }
  const result = {
    stage,
    status: run.exitCode === 0 && run.error === null ? 'ok' : 'failed',
    seconds: run.seconds,
    exit_code: run.exitCode,
    counts: counts === null ? null : parseCounts(counts, run.stdout),
    error: run.error,
  };
  const written = writeFile(join(dir, `${stage}.json`), `${JSON.stringify(result)}\n`);
  if (!written.ok) {
    console.error(`run-stage: ${written.error}`);
    return exitCode === 0 ? 2 : exitCode;
  }
  return exitCode;
}

process.exitCode = await main();
