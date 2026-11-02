#!/usr/bin/env node
// Usage: fetch.ts [username] [owner/repo] > prs.json

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseArgs, scoreRisk } from './lib.ts';
import type { Pr } from './types.ts';

// eslint-disable-next-line typescript/strict-void-return -- promisify resolves execFile's callback overload
const run = promisify(execFile);

async function gh(args: string[]): Promise<string> {
  const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

interface Listed {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string };
  repo: string;
}

interface Detail {
  additions: number;
  deletions: number;
  body: string;
  files: { path: string }[];
}

async function list(user: string | undefined, repo: string | undefined): Promise<Listed[]> {
  const fields = 'number,title,url,isDraft,author';
  if (user === undefined) {
    const raw = await gh([
      'search',
      'prs',
      '--review-requested=@me',
      '--state=open',
      '--limit',
      '50',
      '--json',
      `${fields},repository`,
    ]);
    return (JSON.parse(raw) as (Omit<Listed, 'repo'> & { repository: { nameWithOwner: string } })[]).map((p) =>
      Object.assign(p, { repo: p.repository.nameWithOwner }),
    );
  }
  const target = repo ?? (await gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']));
  const raw = await gh([
    'pr',
    'list',
    '--author',
    user,
    '--state',
    'open',
    '--limit',
    '50',
    '-R',
    target,
    '--json',
    fields,
  ]);
  return (JSON.parse(raw) as Omit<Listed, 'repo'>[]).map((p) => Object.assign(p, { repo: target }));
}

async function detail(p: Listed, viewer: string): Promise<Pr> {
  const raw = await gh(['pr', 'view', String(p.number), '-R', p.repo, '--json', 'additions,deletions,body,files']);
  const d = JSON.parse(raw) as Detail;
  const files = d.files.map((f) => f.path);
  const { risk, signals } = scoreRisk(files, d.additions, d.deletions);
  return {
    additions: d.additions,
    author: p.author.login,
    baseRisk: risk,
    body: d.body,
    deletions: d.deletions,
    files,
    id: `${p.repo}#${p.number}`,
    isDraft: p.isDraft,
    isOwn: p.author.login.toLowerCase() === viewer.toLowerCase(),
    number: p.number,
    repo: p.repo,
    signals,
    title: p.title,
    url: p.url,
  };
}

try {
  const { user, repo } = parseArgs(process.argv.slice(2));
  const [listed, viewer] = await Promise.all([list(user, repo), gh(['api', 'user', '-q', '.login'])]);
  const prs = await Promise.all(listed.map(async (p) => detail(p, viewer)));
  console.log(JSON.stringify(prs, undefined, 2));
} catch (error) {
  const e = error as { stderr?: string; message?: string };
  console.error(`fetch.ts: ${(e.stderr || e.message || String(error)).trim()}`);
  process.exit(1);
}
