#!/usr/bin/env node
// Remove your thumbs up or down from a comment, given its url.
// Usage: unvote.ts [--dry-run] COMMENT_URL

import { api, die } from './lib.ts';

const argv = process.argv.slice(2);
const dryRun = argv[0] === '--dry-run';
const url = dryRun ? argv[1] : argv[0];
if (!url || url === '-h' || url === '--help') die('unvote.ts', 'usage: unvote.ts [--dry-run] COMMENT_URL');

const owner = url.split('/')[3];
const repo = url.split('/')[4];
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

for (const line of found.split('\n')) {
  const [rid, content] = line.split('\t');
  if (!rid) continue;
  if (dryRun) {
    console.log(`would remove ${content} (reaction ${rid})`);
    continue;
  }
  try {
    await api(['-X', 'DELETE', `repos/${owner}/${repo}/${kind!}/${id!}/reactions/${rid}`]);
    console.log(`removed ${content}`);
  } catch {
    die('unvote.ts', `could not remove reaction ${rid}`);
  }
}
