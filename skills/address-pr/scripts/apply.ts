#!/usr/bin/env node
// Execute a review-response plan: reply, vote and resolve across every thread at once.
// Usage: apply.ts PLAN.json   (PLAN of "-" reads stdin)

import { readFile } from 'node:fs/promises';

import { api, die as dieBase, DieError, errText, gql, retry } from './lib.ts';

function die(msg: string): never {
  return dieBase('apply.ts', msg);
}

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

function duplicateOf(nodes: Comment[], body: string, viewer: string) {
  return nodes.find((n) => n.author?.login === viewer && n.body.trim() === body.trim())?.url;
}

// A reply is the one call here that is not idempotent, so re-running a plan
// would post it twice. This read looks for it, and doubles as the source of the
// REST coordinates the reply needs.
async function readThread(threadId: string) {
  const raw = await gql(Q_EXISTING.thread, ['-f', `id=${threadId}`], '.data.node');
  const node = JSON.parse(raw) as {
    comments: { nodes: Comment[] };
    pullRequest: { number: number; repository: { nameWithOwner: string } };
  };
  return {
    comments: node.comments.nodes,
    number: node.pullRequest.number,
    replyTo: node.comments.nodes[0]?.databaseId,
    repo: node.pullRequest.repository.nameWithOwner,
  };
}

async function readConversation(prId: string): Promise<Comment[]> {
  const raw = await gql(Q_EXISTING.pr, ['-f', `id=${prId}`], '.data.node.comments.nodes');
  return JSON.parse(raw || '[]') as Comment[];
}

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
      : Promise.resolve(),
    item.resolve ? retry(async () => gql(Q.resolve, ['-f', `threadId=${item.threadId}`])) : Promise.resolve(),
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
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop -- one job at a time per worker; concurrency comes from running several workers
      results[i] = await fn(items[i]);
    }
  }
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

function table(rows: string[][], head: string[]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  function line(cells: string[]) {
    return cells
      .map((c, i) => c.padEnd(w[i]))
      .join('  ')
      .trimEnd();
  }
  return [line(head), ...rows.map((r) => line(r))].join('\n');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  // eslint-disable-next-line prefer-destructuring -- destructuring argv[2] needs two ignored slots, less readable than an index
  const target = process.argv[2];
  if (!target || target === '-h' || target === '--help') die('usage: apply.ts PLAN.json');

  let raw: string;
  if (target === '-') {
    raw = await readStdin();
  } else {
    try {
      raw = await readFile(target, 'utf8');
    } catch {
      die(`no such plan: ${target}`);
    }
  }

  let plan: PlanItem[];
  try {
    plan = JSON.parse(raw) as PlanItem[];
  } catch (error) {
    die(`plan is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(plan!) || plan!.length === 0) die('plan must be a non-empty JSON array');

  // Validate the whole plan before sending anything. A plan that fails halfway is
  // the expensive failure, so every check happens up front.
  const errors = validate(plan!);
  if (errors.length > 0) die(`invalid plan\n  ${errors.join('\n  ')}`);

  const bodyFileChecks = await pool(
    plan!.filter((item) => item.bodyFile),
    JOBS,
    async (item) => {
      let body: string | undefined;
      try {
        body = await readFile(item.bodyFile!, 'utf8');
      } catch {
        body = undefined;
      }
      return !body || !body.trim() ? item.bodyFile : undefined;
    },
  );
  const missing = bodyFileChecks.filter((bodyFile): bodyFile is string => Boolean(bodyFile));
  if (missing.length > 0) die(`missing or empty body files\n  ${missing.join('\n  ')}`);

  const viewer = await gql('{ viewer { login } }', [], '.data.viewer.login');
  const results: Result[] = plan!.map((item) => ({
    err: '',
    ref: item.ref,
    reply: 'skipped',
    replyUrl: '',
    resolve: 'skipped',
    vote: 'skipped',
  }));

  // Reply then vote/resolve, per item, so a vote never lands ahead of the reply
  // that explains it, without making every item wait for the slowest reply.
  const pairs = plan!.map((item, i) => [item, results[i]] as const);
  await pool(pairs, JOBS, async ([item, out]) => {
    await postReply(item, viewer, out);
    await voteAndResolve(item, out);
  });

  console.log(
    table(
      results.map((r) => [r.ref, r.reply, r.vote, r.resolve]),
      ['REF', 'REPLY', 'VOTE', 'RESOLVE'],
    ),
  );

  const landed = results.filter((r) => r.replyUrl);
  if (landed.length > 0) console.log(`\n${landed.map((r) => `${r.ref}  ${r.replyUrl}`).join('\n')}`);

  // A reply that landed with no vote and no resolve is silent otherwise: this is
  // the shape of a plan item that forgot both fields, not an error apply.ts can
  // see. It is also the correct shape for a genuine "Asked" reply on an open
  // question, so this warns rather than fails.
  const silent = plan!
    .map((item, i) => [item, results[i]] as const)
    .filter(([item, r]) => item.threadId && r.reply === 'ok' && r.vote === 'skipped' && r.resolve === 'skipped');
  if (silent.length > 0) {
    console.error(`\n${silent.length} item(s) replied with no vote and no resolve:`);
    for (const [item] of silent) console.error(`  ${item.ref}`);
    console.error(
      '\nCorrect for a question left open. Wrong for anything else: confirm each one before you write the summary.',
    );
  }

  const failed = results.filter((r) => [r.reply, r.vote, r.resolve].includes('failed'));
  if (failed.length > 0) {
    console.error(`\n${failed.length} item(s) failed:`);
    for (const r of failed) console.error(`  ${r.ref}: ${r.err}`);
    console.error(
      '\nA failed reply sends no vote and no resolve. Re-read those threads before retrying: GitHub sometimes posts a reply and then fails the response.',
    );
    process.exit(1);
  }
} catch (error) {
  if (!(error instanceof DieError)) throw error;
  console.error(error.message);
  process.exit(2);
}
