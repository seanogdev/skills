# A PR

Read this file when the feedback is on a GitHub PR. Each path below is relative to the skill directory. Expand it to a full path before you run a command.

## Reading the feedback

**Query first, every time.** A read from earlier in this conversation is stale: reviewers add comments while a pass runs.

```bash
node scripts/fetch.ts [PR]
```

Pass `$ARGUMENTS` as `[PR]` only when it names a PR, never a review file path. With no argument it reads the open PR for the current branch.

It reads inline threads, review bodies and conversation comments in one call, and keeps the threads that are still live: unresolved, plus any thread you replied in that someone spoke on since. GitHub leaves a thread resolved when a new comment lands on it, so those come back with `isResolved: true`.

Skip anything `viewer` wrote, except your own replies inside a thread: they are what the reviewer answers. Skip the CI and coverage chatter bots post as comments; the check state comes from `ci`. Keep every `url` for the summary. A reviewer often raises the main point in a review body or a conversation comment, and those are the easiest to miss.

`isBot` is true where a GitHub App wrote the comment. An automated reviewer on a machine user account comes back false, so read the author too.

## Threads that have come back

A thread with `isOutdated: true` usually means the code moved on. Pass that to its subagent.

`isResolved: true` on a thread means you settled it on an earlier pass and someone replied since. Tell its subagent it came back: the earlier call is not binding.

If the reviewer only accepts the answer or says thanks, it is not an item: the thread stays resolved, and a row in the summary is the whole of it.

Otherwise reply, re-vote where the call moved, and resolve again. Reactions add, so clear the old vote with `node scripts/unvote.ts` before you cast the new one. If the call moves to a decline on a human comment, the unvote is the whole action.

## Votes the user left

`userVotes` holds the reactions on this account. A vote from the user is the one vote that carries weight: they read the comment and formed a view before you got to it. Reactions from anyone else are left out.

`gh` runs as the user's account, so your own reactions look the same as theirs. Your reply in the thread tells them apart. No reply from you means the vote is theirs. If you replied, the vote is yours from that pass, unless it disagrees with the reply: then the user changed it, and that is the signal.

Pass the user's vote to the item's subagent; `references/item.md` says how it weighs. Two cases change what you do with its return:

- **`THUMBS_UP` declined anyway.** Tell the user in the summary. They may want to reverse that.
- **`THUMBS_DOWN` with a real defect behind it.** The subagent's notes say so. Leave that thread open, and put the evidence in the summary, so the user can change their mind.

## Applying, voting and replying

Build a plan and run it:

```bash
node scripts/apply.ts PLAN.json
```

It sends every reply, then every vote and resolve, so a vote never lands ahead of the reply that explains it. If a reply fails, that item's vote and resolve are skipped. Running the same plan twice is safe: a reply already posted in your name comes back as `duplicate`.

Resolve every thread you replied to, the declined ones included. Only the `THUMBS_DOWN` case in **Votes the user left** stays open. A conversation comment cannot be resolved; the reply and the vote close it.

One object per piece of feedback, `ref` naming the row the summary table will use:

```json
[
  {
    "ref": "useFoo.ts:24",
    "threadId": "PRRT_kwDO...",
    "commentId": "PRRC_kwDO...",
    "bodyFile": "/tmp/reply-usefoo.md",
    "vote": "THUMBS_UP",
    "resolve": true
  }
]
```

`apply.ts` rejects a malformed plan with the exact problem, so run it and read the error. What the shape cannot show:

- `threadId` replies into an inline thread. `prId` posts a conversation comment, which is how a review body or a conversation comment gets answered; open that body with the author's `@login`. Give exactly one of the two.
- `commentId` is what the vote lands on: the first comment in the thread, or the review or conversation node itself. Never your own reply.
- `bodyFile` is a path, never the body itself: a double-quoted body runs every backticked identifier as a command.

## What the vote means

The vote records only whether the comment should be addressed. Use `THUMBS_UP` and `THUMBS_DOWN` and no other reaction.

- **`THUMBS_UP`**: fixed in full or in part, or agreed but out of scope for this PR. Any author.
- **`THUMBS_DOWN`**: declined, on an automated comment only, where it feeds the reviewer's accuracy stats.
- **No vote**: every other case, a declined human comment, an Asked, an Outdated thread, and an "LGTM" body included. The reply carries a decline of a human comment.

Vote on the comment that raised the point: the first comment in the thread, or the review or conversation node itself. Cast one vote, matching what the reply says. A comment the user already voted on keeps their vote untouched; your reply carries your call.

Undo a vote with `node scripts/unvote.ts COMMENT_URL`. A vote on a review body cannot be undone, so be sure before you cast it.
