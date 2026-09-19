#!/usr/bin/env node
// Read a PR body, or write one back without dropping the author's attachments.
// Usage: pr-body.ts save [PR]
//        pr-body.ts check NEW.md [PR]
//        pr-body.ts edit  NEW.md [PR]

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile),
  die = (msg: string): never => {
    console.error(`pr-body.ts: ${msg}`);
    process.exit(2);
  },
  errText = (e: unknown): string => {
    const x = e as { stderr?: string; stdout?: string; message?: string };
    return (x.stderr || x.stdout || x.message || String(e)).trim();
  },
  // `gh` appends a newline that would grow the body by a blank line on every run.
  chompOne = (s: string): string => (s.endsWith('\n') ? s.slice(0, -1) : s),
  ATTACHMENT = /https:\/\/[^ )">]*(?:user-attachments|githubusercontent)[^ )">]*/g,
  attachments = (body: string): string[] => [...new Set(body.match(ATTACHMENT) ?? [])].sort(),
  [, , cmdArg, ...rest] = process.argv;
if (!cmdArg || cmdArg === '-h' || cmdArg === '--help') {
  console.log('Usage: pr-body.ts save [PR]\n       pr-body.ts check NEW.md [PR]\n       pr-body.ts edit  NEW.md [PR]');
  process.exit(0);
}

let newFile = '',
  pr = '';
if (cmdArg === 'save') {
  pr = rest[0] ?? '';
} else if (cmdArg === 'check' || cmdArg === 'edit') {
  newFile = rest[0] ?? '';
  if (!newFile) die(`${cmdArg} needs a body file`);
  pr = rest[1] ?? '';
} else {
  die(`unknown command '${cmdArg}'. One of save, check, edit.`);
}

const newBody = newFile ? await readFile(newFile, 'utf8').catch(() => die(`no such body file: ${newFile}`)) : '',
  body = chompOne(
    await run(
      'gh',
      pr ? ['pr', 'view', pr, '--json', 'body', '-q', '.body'] : ['pr', 'view', '--json', 'body', '-q', '.body'],
    )
      .then((r) => r.stdout)
      .catch((error) => die(`cannot read PR '${pr || '(current branch)'}': ${errText(error)}`)),
  );

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

const dir = await mkdtemp(join(tmpdir(), 'pr-body-')),
  tmp = join(dir, 'body.md');
try {
  await writeFile(tmp, chompOne(newBody));
  await run('gh', pr ? ['pr', 'edit', pr, '--body-file', tmp] : ['pr', 'edit', '--body-file', tmp]).catch((error) =>
    die(`gh pr edit failed: ${errText(error)}`),
  );
} finally {
  await rm(dir, { force: true, recursive: true });
}
console.log(`Updated the body, ${kept} attachment(s) intact`);
