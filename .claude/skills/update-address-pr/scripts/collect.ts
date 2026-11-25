#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildItems, chunk, hasSignal, renderItem, silentFixes } from './lib.ts';
import type { GqlPr, Item } from './lib.ts';

const HELP = `Collect the review feedback a PR author answered, and what happened after each answer.
Usage: collect.ts [--repo OWNER/NAME] [--days N] [--author LOGIN] [--batch N] [--audit N]
  --repo    default: the repository of the current checkout
  --days    PRs updated in the last N days. Default: 30
  --author  whose PRs and answers. Default: the gh user
  --batch   items per judge-N.md. Default: 40
  --audit   silent fixes in audit.md. Default: 20
Writes items.json, judge-N.md with the items that drew a later response, and audit.md with a spread of silent fixes, to a new temp directory and prints its path and counts.`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

const repo = arg('repo', '') || gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
const me = arg('author', '') || gh(['api', 'user', '-q', '.login']);
const days = Number(arg('days', '30'));
const batch = Number(arg('batch', '40'));
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const COMMENT = `id url body createdAt author { login __typename }`;
const QUERY = `
query($q:String!, $cursor:String) {
  search(query:$q, type:ISSUE, first:10, after:$cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number url
      commits(last:100) { nodes { commit { oid messageHeadline committedDate } } }
      reviewThreads(first:100) { nodes {
        isResolved isOutdated path line originalLine
        comments(first:50) { totalCount nodes { ${COMMENT} reactionGroups { content viewerHasReacted } } }
      } }
      reviews(first:100) { nodes { ${COMMENT} reactionGroups { content viewerHasReacted } } }
      comments(first:100) { nodes { ${COMMENT} isMinimized reactionGroups { content viewerHasReacted } } }
    } }
  }
}`;

interface Page {
  data: { search: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlPr[] } };
}

const prs: GqlPr[] = [];
let cursor = '';
for (;;) {
  const args = ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=repo:${repo} is:pr author:${me} updated:>=${since}`];
  if (cursor) args.push('-f', `cursor=${cursor}`);
  const { search } = (JSON.parse(gh(args)) as Page).data;
  prs.push(...search.nodes.filter((n) => n.number));
  if (!search.pageInfo.hasNextPage) break;
  cursor = search.pageInfo.endCursor;
}

const items: Item[] = prs.flatMap((pr) => buildItems(pr, me));
const dir = mkdtempSync(join(tmpdir(), 'address-pr-feedback-'));
writeFileSync(join(dir, 'items.json'), JSON.stringify(items, undefined, 2));
const batches = chunk(items.filter((i) => hasSignal(i)), batch);
for (const [i, group] of batches.entries()) {
  writeFileSync(join(dir, `judge-${i + 1}.md`), group.map((item) => renderItem(item)).join('\n\n---\n\n'));
}
const audit = silentFixes(items, Number(arg('audit', '20')));
writeFileSync(join(dir, 'audit.md'), audit.map((item) => renderItem(item)).join('\n\n---\n\n'));

const count = (pred: (i: Item) => boolean) => items.filter(pred).length;
console.log(
  [
    `dir: ${dir}`,
    `PRs: ${prs.length}, with answered feedback: ${new Set(items.map((i) => i.pr)).size}`,
    `items: ${items.length} (threads ${count((i) => i.kind === 'thread')}, reviews ${count((i) => i.kind === 'review')}, conversation ${count((i) => i.kind === 'conversation')})`,
    `from bots: ${count((i) => i.reviewerIsBot)}, reviewers: ${new Set(items.map((i) => i.reviewer)).size}`,
    `reviewer spoke after the answer: ${count((i) => i.after.length > 0)}, later feedback on the same spot: ${count((i) => i.laterFeedback.length > 0)}`,
    `to judge: ${count((i) => hasSignal(i))}, silent: ${count((i) => !hasSignal(i))}`,
    `judge files: ${batches.map((_, i) => `judge-${i + 1}.md`).join(', ')}`,
    `audit.md: ${audit.length} silent fixes`,
  ].join('\n'),
);
