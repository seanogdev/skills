#!/usr/bin/env node
// Remove your thumbs up or down from a comment, given its url.
// Usage: unvote.ts [--dry-run] COMMENT_URL

import { api, die, DieError } from './lib.ts';

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  const argv = process.argv.slice(2);
  const dryRun = argv[0] === '--dry-run';
  const url = dryRun ? argv[1] : argv[0];
  if (!url || url === '-h' || url === '--help') die('unvote.ts', 'usage: unvote.ts [--dry-run] COMMENT_URL');

  const [owner, repo] = url.split('/').slice(3, 5);
  const frag = url.split('#')[1] ?? '';

  let kind: string;
  let id: string;
  if (frag.startsWith('discussion_r')) {
    kind = 'pulls/comments';
    id = frag.slice('discussion_r'.length);
  } else if (frag.startsWith('issuecomment-')) {
    kind = 'issues/comments';
    id = frag.slice('issuecomment-'.length);
  } else if (frag.startsWith('pullrequestreview-')) {
    die(
      'unvote.ts',
      'REST has no reactions endpoint for a review body, so a vote on one cannot be undone here. Say so in the reply instead.',
    );
  } else {
    die('unvote.ts', `cannot tell what '${url}' points at. Needs a #discussion_r or #issuecomment- url.`);
  }
  if (!owner || !repo || !id!) die('unvote.ts', `cannot parse ${url}`);

  // removeReaction returns FORBIDDEN on this account, so this goes over REST,
  // which takes REST ids rather than node ids.
  const me = await api(['user'], '.login');
  const found = await api(
    [`repos/${owner}/${repo}/${kind!}/${id!}/reactions`],
    `.[] | select(.user.login == "${me}") | select(.content == "+1" or .content == "-1") | "\\(.id)\\t\\(.content)"`,
  );

  if (!found) {
    console.log(`No vote from ${me} on ${url}`);
    process.exit(0);
  }

  const reactions = found
    .split('\n')
    .map((line) => {
      const [rid, content] = line.split('\t');
      return rid ? { content, rid } : undefined;
    })
    .filter((r): r is { content: string; rid: string } => Boolean(r));

  if (dryRun) {
    for (const { rid, content } of reactions) console.log(`would remove ${content} (reaction ${rid})`);
  } else {
    await Promise.all(
      reactions.map(async ({ rid, content }) => {
        try {
          await api(['-X', 'DELETE', `repos/${owner}/${repo}/${kind!}/${id!}/reactions/${rid}`]);
          console.log(`removed ${content}`);
        } catch {
          die('unvote.ts', `could not remove reaction ${rid}`);
        }
      }),
    );
  }
} catch (error) {
  if (!(error instanceof DieError)) throw error;
  console.error(error.message);
  process.exit(2);
}
