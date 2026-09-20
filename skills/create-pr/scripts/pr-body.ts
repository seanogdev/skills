#!/usr/bin/env node
// Read a PR body, or write one back without dropping the author's attachments.
// Usage: pr-body.ts save [PR]
//        pr-body.ts check NEW.md [PR]
//        pr-body.ts edit  NEW.md [PR]

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

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  const [cmdArg, ...rest] = process.argv.slice(2);
  if (!cmdArg || cmdArg === '-h' || cmdArg === '--help') {
    console.log(
      'Usage: pr-body.ts save [PR]\n       pr-body.ts check NEW.md [PR]\n       pr-body.ts edit  NEW.md [PR]',
    );
    process.exit(0);
  }

  let newFile = '';
  let pr = '';
  if (cmdArg === 'save') {
    pr = rest[0] ?? '';
  } else if (cmdArg === 'check' || cmdArg === 'edit') {
    newFile = rest[0] ?? '';
    if (!newFile) die(`${cmdArg} needs a body file`);
    pr = rest[1] ?? '';
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
  try {
    const result = await run(
      'gh',
      pr ? ['pr', 'view', pr, '--json', 'body', '-q', '.body'] : ['pr', 'view', '--json', 'body', '-q', '.body'],
    );
    bodyRaw = result.stdout;
  } catch (error) {
    die(`cannot read PR '${pr || '(current branch)'}': ${errText(error)}`);
  }
  const body = chompOne(bodyRaw);

  if (cmdArg === 'save') {
    process.stdout.write(body);
    process.exit(0);
  }

  const missing = attachments(body).filter((url) => !newBody.includes(url));
  if (missing.length > 0) {
    console.error(
      `pr-body.ts: ${cmdArg} would drop attachments the author added:\n${missing.map((u) => `  ${u}`).join('\n')}`,
    );
    console.error('Put every one of them back, in its own section, before editing.');
    process.exit(1);
  }

  const kept = attachments(body).length;

  if (cmdArg === 'check') {
    console.log(`ok: ${kept} attachment(s) in the current body all survive`);
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
