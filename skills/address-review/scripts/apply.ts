#!/usr/bin/env node
// Execute a review-response plan: reply, vote and resolve across every thread at once.
// Usage: apply.ts PLAN.json   (PLAN of "-" reads stdin)

import { readFile } from 'node:fs/promises';

import { api, die as dieBase, errText, gql, retry } from './lib.ts';

const die = (msg: string): never => dieBase('apply.ts', msg);

type Vote = 'THUMBS_UP' | 'THUMBS_DOWN';
type State = 'ok' | 'failed' | 'skipped' | 'duplicate';

interface PlanItem {
  ref: string;
  threadId?: string;
  prId?: string;
  commentId?: string;
  bodyFile?: string;
  vote?: Vote;
  resolve?: boolean;
}

interface Result {
  ref: string;
  reply: State;
  replyUrl: string;
  vote: State;
  resolve: State;
  err: string;
}

const JOBS = Number(process.env.ADDRESS_REVIEW_JOBS) || 4;

const Q = {
  comment: `mutation($subjectId:ID!, $body:String!) {
    addComment(input: {subjectId: $subjectId, body: $body}) { commentEdge { node { url } } }
  }`,
  resolve: `mutation($threadId:ID!) {
    resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
  }`,
  vote: `mutation($subjectId:ID!, $content:ReactionContent!) {
    addReaction(input: {subjectId: $subjectId, content: $content}) { reaction { content } }
  }`,
};

const Q_EXISTING = {
  pr: `query($id:ID!) {
    node(id:$id) { ... on PullRequest {
      comments(last:50) { nodes { author { login } body url } } } }
  }`,
  thread: `query($id:ID!) {
    node(id:$id) { ... on PullRequestReviewThread {
      comments(first:50) { nodes { databaseId author { login } body url } }
      pullRequest { number repository { nameWithOwner } } } }
  }`,
};

interface Comment {
  databaseId?: number;
  author: { login: string } | null;
  body: string;
  url: string;
}

const duplicateOf = (nodes: Comment[], body: string, viewer: string) =>
  nodes.find((n) => n.author?.login === viewer && n.body.trim() === body.trim())?.url;

// A reply is the one call here that is not idempotent, so re-running a plan
// would post it twice. This read looks for it, and doubles as the source of the
// REST coordinates the reply needs.
const readThread = async (threadId: string) => {
  const raw = await gql(Q_EXISTING.thread, ['-f', `id=${threadId}`], '.data.node');
  const node: {
    comments: { nodes: Comment[] };
    pullRequest: { number: number; repository: { nameWithOwner: string } };
  } = JSON.parse(raw);
  return {
    comments: node.comments.nodes,
    number: node.pullRequest.number,
    replyTo: node.comments.nodes[0]?.databaseId,
    repo: node.pullRequest.repository.nameWithOwner,
  };
};

const readConversation = async (prId: string): Promise<Comment[]> => {
  const raw = await gql(Q_EXISTING.pr, ['-f', `id=${prId}`], '.data.node.comments.nodes');
  return JSON.parse(raw || '[]');
};

async function postReply(item: PlanItem, viewer: string, out: Result): Promise<void> {
  if (!item.bodyFile) return;
  const body = await readFile(item.bodyFile, 'utf8');

  try {
    if (item.threadId) {
      const thread = await readThread(item.threadId);
      const existing = duplicateOf(thread.comments, body, viewer);
      if (existing) {
        out.reply = 'duplicate';
        out.replyUrl = existing;
        return;
      }
      if (!thread.replyTo) throw new Error('thread has no comment to reply to');
      // REST, not addPullRequestReviewThreadReply: that mutation files the reply
      // under an open pending review, where only its author can read it.
      out.replyUrl = await api(
        [
          '--method',
          'POST',
          `repos/${thread.repo}/pulls/${thread.number}/comments/${thread.replyTo}/replies`,
          '-F',
          `body=@${item.bodyFile}`,
        ],
        '.html_url',
      );
    } else {
      const existing = duplicateOf(await readConversation(item.prId!), body, viewer);
      if (existing) {
        out.reply = 'duplicate';
        out.replyUrl = existing;
        return;
      }
      out.replyUrl = await gql(
        Q.comment,
        ['-f', `subjectId=${item.prId}`, '-F', `body=@${item.bodyFile}`],
        '.data.addComment.commentEdge.node.url',
      );
    }
    out.reply = 'ok';
  } catch (error) {
    out.reply = 'failed';
    out.err = errText(error);
  }
}

async function voteAndResolve(item: PlanItem, out: Result): Promise<Result> {
  // A thread with no reply must not end up voted and closed.
  if (out.reply === 'failed') return out;

  // Both are idempotent, so both retry, and neither waits on the other.
  const [vote, resolve] = await Promise.allSettled([
    item.vote
      ? retry(async () => gql(Q.vote, ['-f', `subjectId=${item.commentId}`, '-f', `content=${item.vote}`]))
      : Promise.resolve(null),
    item.resolve ? retry(async () => gql(Q.resolve, ['-f', `threadId=${item.threadId}`])) : Promise.resolve(null),
  ]);

  function record(key: 'vote' | 'resolve', settled: PromiseSettledResult<unknown>, wanted: unknown) {
    if (!wanted) return;
    if (settled.status === 'fulfilled') {
      out[key] = 'ok';
      return;
    }
    out[key] = 'failed';
    out.err = [out.err, errText(settled.reason)].filter(Boolean).join('; ');
  }
  record('vote', vote, item.vote);
  record('resolve', resolve, item.resolve);

  return out;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const CHECKS: [(v: PlanItem) => boolean, string][] = [
  [(v) => !v.ref, 'missing ref'],
  [(v) => Boolean(v.threadId) === Boolean(v.prId), 'needs exactly one of threadId or prId'],
  [(v) => Boolean(v.vote) && !['THUMBS_UP', 'THUMBS_DOWN'].includes(v.vote!), 'vote must be THUMBS_UP or THUMBS_DOWN'],
  [(v) => Boolean(v.vote) && !v.commentId, 'vote needs a commentId'],
  [(v) => Boolean(v.resolve) && !v.threadId, 'resolve needs a threadId'],
  [(v) => !v.bodyFile && !v.vote && !v.resolve, 'no reply, vote or resolve'],
];

function validate(plan: PlanItem[]): string[] {
  return plan.flatMap((v, i) => {
    const at = `item ${i} (${v.ref || 'no ref'})`;
    return CHECKS.filter(([check]) => check(v)).map(([, message]) => `${at}: ${message}`);
  });
}

const table = (rows: string[][], head: string[]): string => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(w[i]))
      .join('  ')
      .trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
};

const target = process.argv[2];
if (!target || target === '-h' || target === '--help') die('usage: apply.ts PLAN.json');

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const raw =
  target === '-' ? await readStdin() : await readFile(target, 'utf8').catch(() => die(`no such plan: ${target}`));

let plan: PlanItem[];
try {
  plan = JSON.parse(raw);
} catch (error) {
  die(`plan is not valid JSON: ${(error as Error).message}`);
}
if (!Array.isArray(plan!) || plan!.length === 0) die('plan must be a non-empty JSON array');

// Validate the whole plan before sending anything. A plan that fails halfway is
// the expensive failure, so every check happens up front.
const errors = validate(plan!);
if (errors.length > 0) {
  console.error(`apply.ts: invalid plan\n  ${errors.join('\n  ')}`);
  process.exit(2);
}

const missing: string[] = [];
for (const item of plan!) {
  if (!item.bodyFile) continue;
  const body = await readFile(item.bodyFile, 'utf8').catch(() => null);
  if (!body || !body.trim()) missing.push(item.bodyFile);
}
if (missing.length > 0) {
  console.error(`apply.ts: missing or empty body files\n  ${missing.join('\n  ')}`);
  process.exit(2);
}

const viewer = await gql('{ viewer { login } }', [], '.data.viewer.login');
const results: Result[] = plan!.map((item) => ({
  err: '',
  ref: item.ref,
  reply: 'skipped',
  replyUrl: '',
  resolve: 'skipped',
  vote: 'skipped',
}));

// Every reply goes out, then every vote and resolve. Rounds, not per item, so a
// vote never lands on a thread ahead of the reply that explains it.
const pairs = plan!.map((item, i) => [item, results[i]] as const);
await pool(pairs, JOBS, async ([item, out]) => postReply(item, viewer, out));
await pool(pairs, JOBS, async ([item, out]) => voteAndResolve(item, out));

console.log(
  table(
    results.map((r) => [r.ref, r.reply, r.vote, r.resolve]),
    ['REF', 'REPLY', 'VOTE', 'RESOLVE'],
  ),
);

const landed = results.filter((r) => r.replyUrl);
if (landed.length > 0) console.log(`\n${landed.map((r) => `${r.ref}  ${r.replyUrl}`).join('\n')}`);

const failed = results.filter((r) => [r.reply, r.vote, r.resolve].includes('failed'));
if (failed.length > 0) {
  console.error(`\n${failed.length} item(s) failed:`);
  for (const r of failed) console.error(`  ${r.ref}: ${r.err}`);
  console.error(
    '\nA failed reply sends no vote and no resolve. Re-read those threads before retrying: GitHub sometimes posts a reply and then fails the response.',
  );
  process.exit(1);
}
