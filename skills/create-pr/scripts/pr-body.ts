#!/usr/bin/env node
// Read a PR body, or write one back without dropping the author's attachments.
// Usage: pr-body.ts save [PR]
//        pr-body.ts check NEW.md [PR] [--baseline FILE|none]
//        pr-body.ts edit  NEW.md [PR] [--baseline FILE|none]
//
// save writes the body to stdout and to a baseline file named after the PR.
// check and edit guard against that baseline, not against the live body, so a
// body another run has overwritten cannot make the guard defend the wrong PR's
// attachments.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// eslint-disable-next-line typescript/strict-void-return -- promisify resolves execFile's callback overload correctly; the sync-return overload it's flagging against is unreachable here
const run = promisify(execFile);

// Thrown by die() and caught at the bottom, which is where process.exit()
// belongs — not buried inside a helper function.
class DieError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DieError';
  }
}

function die(msg: string): never {
  throw new DieError(`pr-body.ts: ${msg}`);
}

function errText(e: unknown): string {
  const x = e as { stderr?: string; stdout?: string; message?: string };
  return (x.stderr || x.stdout || x.message || String(e)).trim();
}

// `gh` appends a newline that would grow the body by a blank line on every run.
function chompOne(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}
const ATTACHMENT = /https:\/\/[^ )">]*(?:user-attachments|githubusercontent)[^ )">]*/gu;
function attachments(body: string): string[] {
  return [...new Set(body.match(ATTACHMENT))].toSorted();
}

// The baseline is what this PR held when the run started. Naming it after the
// PR keeps parallel runs off each other's file.
function baselineFile(number: number): string {
  return path.join(tmpdir(), `pr-body-baseline-${number}.md`);
}

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  const [cmdArg, ...rest] = process.argv.slice(2);
  if (!cmdArg || cmdArg === '-h' || cmdArg === '--help') {
    console.log(
      'Usage: pr-body.ts save [PR]\n       pr-body.ts check NEW.md [PR] [--baseline FILE|none]\n       pr-body.ts edit  NEW.md [PR] [--baseline FILE|none]',
    );
    process.exit(0);
  }

  let baselineArg = '';
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--baseline') {
      baselineArg = rest[i + 1] ?? die('--baseline needs a file, or none');
      i += 1;
    } else if (arg.startsWith('--baseline=')) {
      baselineArg = arg.slice('--baseline='.length);
    } else {
      positional.push(arg);
    }
  }

  let newFile = '';
  let pr = '';
  if (cmdArg === 'save') {
    pr = positional[0] ?? '';
  } else if (cmdArg === 'check' || cmdArg === 'edit') {
    newFile = positional[0] ?? '';
    if (!newFile) die(`${cmdArg} needs a body file`);
    pr = positional[1] ?? '';
  } else {
    die(`unknown command '${cmdArg}'. One of save, check, edit.`);
  }

  let newBody = '';
  if (newFile) {
    try {
      newBody = await readFile(newFile, 'utf8');
    } catch {
      die(`no such body file: ${newFile}`);
    }
  }

  let bodyRaw: string;
  let number: number;
  try {
    const view = ['pr', 'view', '--json', 'body,number'];
    const result = await run('gh', pr ? ['pr', 'view', pr, '--json', 'body,number'] : view);
    const parsed = JSON.parse(result.stdout) as { body: string; number: number };
    bodyRaw = parsed.body;
    number = parsed.number;
  } catch (error) {
    die(`cannot read PR '${pr || '(current branch)'}': ${errText(error)}`);
  }
  const body = chompOne(bodyRaw);

  if (cmdArg === 'save') {
    const file = baselineFile(number);
    await writeFile(file, body);
    console.error(`pr-body.ts: baseline for #${number} saved to ${file}`);
    process.stdout.write(body);
    process.exit(0);
  }

  // Guard against the baseline this run saved. The live body is only a stand-in
  // for it, and a wrong one once another run has written over this PR.
  let baseline = body;
  let baselineFrom = 'the live body, having no saved baseline';
  if (baselineArg === 'none') {
    baseline = '';
    baselineFrom = 'nothing, by --baseline none';
  } else {
    const file = baselineArg || baselineFile(number);
    try {
      baseline = chompOne(await readFile(file, 'utf8'));
      baselineFrom = file;
    } catch {
      if (baselineArg) die(`no such baseline file: ${baselineArg}`);
    }
  }

  const missing = attachments(baseline).filter((url) => !newBody.includes(url));
  if (missing.length > 0) {
    console.error(
      `pr-body.ts: ${cmdArg} would drop attachments the author added:\n${missing.map((u) => `  ${u}`).join('\n')}`,
    );
    console.error(`Baseline: ${baselineFrom}`);
    console.error('Put every one of them back, in its own section, before editing.');
    process.exit(1);
  }

  // The live body holding an attachment the baseline never had means someone
  // else wrote to this PR since save. That is either a second run that posted
  // the wrong body here, or a person who added a screenshot.
  const appeared = attachments(body).filter((url) => !attachments(baseline).includes(url));
  if (appeared.length > 0) {
    console.error(
      `pr-body.ts: #${number} gained attachments since the baseline:\n${appeared.map((u) => `  ${u}`).join('\n')}`,
    );
    console.error(`Baseline: ${baselineFrom}`);
    console.error('Read the live body. Re-run save if it is right, or keep your baseline if it is not.');
    process.exit(1);
  }

  const kept = attachments(baseline).length;

  if (cmdArg === 'check') {
    console.log(`ok: ${kept} attachment(s) in the baseline all survive`);
    process.exit(0);
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'pr-body-'));
  const tmp = path.join(dir, 'body.md');
  try {
    await writeFile(tmp, chompOne(newBody));
    try {
      await run('gh', pr ? ['pr', 'edit', pr, '--body-file', tmp] : ['pr', 'edit', '--body-file', tmp]);
    } catch (error) {
      die(`gh pr edit failed: ${errText(error)}`);
    }
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
  console.log(`Updated the body, ${kept} attachment(s) intact`);
} catch (error) {
  if (!(error instanceof DieError)) throw error;
  console.error(error.message);
  process.exit(2);
}
