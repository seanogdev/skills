#!/usr/bin/env node
// Read the unresolved inline threads, review bodies and unhidden conversation comments on a PR,
// and whether it conflicts with its base (mergeable: MERGEABLE, CONFLICTING or UNKNOWN).
// base: the branch the PR merges into. checks: whether CI has reported on the PR yet.
// userVotes: 👍/👎 already on the feedback from this account. isBot: a GitHub App author.
// Usage: fetch.ts [PR]   (number, url or branch; defaults to the current branch's PR)

import { die as dieBase, DieError, errText, gh } from './lib.ts';

function die(msg: string): never {
  return dieBase('fetch.ts', msg);
}

interface Author {
  login: string;
  // eslint-disable-next-line no-underscore-dangle -- GraphQL's field name
  __typename: string;
}

interface Reacted {
  viewerHasReacted: boolean;
}

interface Voteable {
  id: string;
  url: string;
  body: string;
  author: Author | null;
  up: Reacted;
  down: Reacted;
}

interface ThreadComment extends Voteable {
  databaseId: number;
}

interface Page {
  hasPreviousPage: boolean;
}

interface Response {
  data: {
    viewer: { login: string };
    repository: {
      nameWithOwner: string;
      pullRequest: {
        number: number;
        url: string;
        mergeable: string;
        baseRefName: string;
        commits: { nodes: { commit: { statusCheckRollup: unknown } }[] };
        reviewThreads: {
          pageInfo: Page;
          nodes: ({
            id: string;
            isResolved: boolean;
            isOutdated: boolean;
            path: string;
            line: number | null;
            originalLine: number | null;
            comments: { totalCount: number; nodes: ThreadComment[] };
            tail: { nodes: ThreadComment[] };
          } | null)[];
        };
        reviews: { pageInfo: Page; nodes: Voteable[] };
        comments: { pageInfo: Page; nodes: (Voteable & { isMinimized: boolean })[] };
      };
    };
  };
}

const QUERY = `
fragment C on PullRequestReviewComment {
  id databaseId url body
  author { login __typename }
  up: reactions(content:THUMBS_UP) { viewerHasReacted }
  down: reactions(content:THUMBS_DOWN) { viewerHasReacted }
}
query($owner:String!, $repo:String!, $number:Int!) {
  viewer { login }
  repository(owner:$owner, name:$repo) {
    nameWithOwner
    pullRequest(number:$number) {
      number url mergeable baseRefName
      commits(last:10) { nodes { commit { statusCheckRollup { state } } } }
      reviewThreads(last:100) {
        pageInfo { hasPreviousPage }
        nodes { id isResolved isOutdated path line originalLine
                comments(first:20) { totalCount nodes { ...C } }
                tail: comments(last:5) { nodes { ...C } } }
      }
      reviews(last:100) { pageInfo { hasPreviousPage }
                          nodes { id url body author { login __typename }
                                  up: reactions(content:THUMBS_UP) { viewerHasReacted }
                                  down: reactions(content:THUMBS_DOWN) { viewerHasReacted } } }
      comments(last:100) { pageInfo { hasPreviousPage }
                           nodes { id url body isMinimized author { login __typename }
                                   up: reactions(content:THUMBS_UP) { viewerHasReacted }
                                   down: reactions(content:THUMBS_DOWN) { viewerHasReacted } } }
    }
  }
}`;

function votes(c: Voteable): string[] {
  return [c.up.viewerHasReacted && 'THUMBS_UP', c.down.viewerHasReacted && 'THUMBS_DOWN'].filter(Boolean) as string[];
}

function isBot(c: Voteable): boolean {
  // eslint-disable-next-line no-underscore-dangle -- GraphQL's field name
  return c.author?.__typename === 'Bot';
}

function feedback(c: Voteable) {
  return { author: c.author?.login, body: c.body, id: c.id, isBot: isBot(c), url: c.url, userVotes: votes(c) };
}

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  // eslint-disable-next-line prefer-destructuring -- destructuring argv[2] needs two ignored slots, less readable than an index
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log(
      "Read the unresolved threads, review bodies and conversation comments on a PR, and whether it conflicts with its base.\nUsage: fetch.ts [PR]   (number, url or branch; defaults to the current branch's PR)",
    );
    process.exit(0);
  }

  let url: string;
  try {
    url = await gh(
      arg ? ['pr', 'view', arg, '--json', 'url', '--jq', '.url'] : ['pr', 'view', '--json', 'url', '--jq', '.url'],
    );
  } catch (error) {
    die(
      arg
        ? `no PR for '${arg}': ${errText(error)}`
        : `no PR for this branch: ${errText(error)}. Pass a number, url or branch.`,
    );
  }

  const [owner, repo, , number] = url.split('/').slice(3);
  if (!owner || !repo || !number) die(`cannot read owner/repo/number out of ${url}`);

  // REST does not expose thread resolution state, so all three sources come over GraphQL in one read.
  const raw = await gh([
    'api',
    'graphql',
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `number=${number}`,
    '-f',
    `query=${QUERY}`,
  ]);
  const { data } = JSON.parse(raw) as Response;
  const { viewer, repository } = data;
  const pr = repository.pullRequest;

  // Not paged: last:N keeps the newest, so a dropped item is older. Warn, don't fail.
  if ([pr.reviewThreads, pr.reviews, pr.comments].some((c) => c.pageInfo.hasPreviousPage)) {
    console.error('fetch.ts: warning: more reviews, threads or comments exist than were fetched; some may be missing');
  }

  const threads = pr.reviewThreads.nodes.flatMap((t) => {
    if (!t || t.isResolved) return [];
    const seen = new Set<string>();
    const comments = [...t.comments.nodes, ...t.tail.nodes].filter((c) => !seen.has(c.id) && seen.add(c.id));
    const [first] = comments;
    return [
      {
        commentCount: t.comments.totalCount,
        comments: comments.map((c) => ({
          author: c.author?.login,
          body: c.body,
          databaseId: c.databaseId,
          id: c.id,
          url: c.url,
        })),
        id: t.id,
        isBot: isBot(first),
        isOutdated: t.isOutdated,
        line: t.line ?? t.originalLine,
        path: t.path,
        userVotes: votes(first),
      },
    ];
  });

  const out = {
    base: pr.baseRefName,
    checks: pr.commits.nodes.some((n) => n.commit.statusCheckRollup !== null),
    conversation: pr.comments.nodes.filter((c) => !c.isMinimized).map((c) => feedback(c)),
    me: viewer.login,
    mergeable: pr.mergeable,
    number: pr.number,
    pr: pr.url,
    repo: repository.nameWithOwner,
    reviews: pr.reviews.nodes.filter((r) => r.body !== '').map((r) => feedback(r)),
    threads,
  };

  console.log(JSON.stringify(out, undefined, 2));
} catch (error) {
  if (!(error instanceof DieError)) throw error;
  console.error(error.message);
  process.exit(2);
}
