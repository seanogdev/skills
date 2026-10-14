# Local feedback

Read this file when the feedback is local: a review that sits in this conversation, or a file the user points at. Everything else in the pass follows `SKILL.md`.

## Reading the feedback

**Read it at the start of the pass, every time.** The user edits these files, so a copy from earlier in this conversation is stale. If the feedback is in the conversation, the latest version wins, and the user narrowing it or adding to it later is part of it.

A paragraph that raises three things is three items. Keep the `path:line` each one points at for the summary.

Every item is live. Nothing in `references/github.md` applies. What stands in for a vote is the user saying it out loud: "the second one matters", "ignore the lint one". Pass that to the item's subagent as the user's vote.

## Applying and replying

Work the items as **Working the items** in `SKILL.md` says.

Push and post only when the user named the PR or asked to push or post. A local review is not a request to write on a PR. Otherwise the commits stay on the branch. The summary says so and names the PR that the branch has, if any, so the user can ask for the push.

When you do push, leave one comment on the PR that says what changed this round and why, so the new commits are accounted for on the PR. Keep it to a line per point. Each line opens with its outcome and names its sha. Build it from the subagents' replies.

Post it through `apply.ts` as a single item with only a `prId` and a `bodyFile`:

```json
[{ "ref": "round summary", "prId": "PR_kwDO...", "bodyFile": "/tmp/round.md" }]
```

`gh pr view --json id --jq .id` is where that `prId` comes from when no `fetch.ts` ran this pass.

That comment is the only place the round goes. The PR description follows **Finishing** in `SKILL.md`, as on any pass.

Leave the feedback file itself as it is.
