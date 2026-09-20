#!/usr/bin/env node
// Read every piece of feedback on a PR: inline threads, review bodies, conversation.
// Usage: fetch.ts [PR]   (number, url or branch; defaults to the current branch's PR)

import { die as dieBase, DieError, errText, gh, gql } from './lib.ts';

function die(msg: string): never {
  return dieBase('fetch.ts', msg);
}

// die() throws; this is the one place that turns it into the process exit a
// CLI entrypoint is allowed to make directly (unicorn/no-process-exit only
// flags exits buried inside library functions, not top-level script code).
try {
  // eslint-disable-next-line prefer-destructuring -- destructuring argv[2] needs two ignored slots, less readable than an index
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log(
      "Read every piece of feedback on a PR: inline threads, review bodies, conversation.\nUsage: fetch.ts [PR]   (number, url or branch; defaults to the current branch's PR)",
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

  // REST does not expose thread resolution state, so all three sources come over
  // GraphQL in one read.
  const query = `
query($owner:String!, $repo:String!, $number:Int!) {
  viewer { login }
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      id
      reviewThreads(first:100) {
        nodes { id isResolved isOutdated path line comments(first:50) { nodes { ...c } } }
      }
      reviews(first:50) { nodes { id url state author { login __typename } body ...r } }
      comments(first:100) { nodes { ...c } }
    }
  }
}
fragment r on Reactable { reactionGroups { content viewerHasReacted } }
fragment c on Reactable {
  id
  reactionGroups { content viewerHasReacted }
  ... on PullRequestReviewComment { url author { login __typename } body }
  ... on IssueComment { url author { login __typename } body }
}`;

  const jq = `.data.viewer.login as $viewer
  | {viewer: $viewer}
  + (.data.repository.pullRequest
  | {prId: .id,
     threads: [.reviewThreads.nodes[]
               # Unresolved, plus any thread this account replied in that
               # someone has spoken on since. GitHub leaves a thread
               # resolved when a new comment lands, so a reviewer
               # answering a closed thread is invisible without this.
               | select(.isResolved == false
                        or (any(.comments.nodes[1:][]; .author.login == $viewer)
                            and (.comments.nodes | last | .author.login) != $viewer))
               | {id, path, line, isOutdated, isResolved,
                  comments: [.comments.nodes[] | {id, url, author: .author.login, isBot: (.author.__typename == "Bot"), body,
                             userVotes: [.reactionGroups[] | select(.viewerHasReacted) | .content]}]}],
     reviews: [.reviews.nodes[] | select(.body != "")
               | {id, url, state, author: .author.login, isBot: (.author.__typename == "Bot"), body,
                  userVotes: [.reactionGroups[] | select(.viewerHasReacted) | .content]}],
     conversation: [.comments.nodes[] | {id, url, author: .author.login, isBot: (.author.__typename == "Bot"), body,
                    userVotes: [.reactionGroups[] | select(.viewerHasReacted) | .content]}]})`;

  const raw = await gql(query, ['-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${number}`], jq);

  console.log(JSON.stringify({ pr: url, ...JSON.parse(raw) }, undefined, 2));
} catch (error) {
  if (!(error instanceof DieError)) throw error;
  console.error(error.message);
  process.exit(2);
}
