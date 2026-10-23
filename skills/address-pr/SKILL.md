---
name: address-pr
description: Take a GitHub PR to a conclusion, every review comment and every failing CI check, or work through a local review. Use when a review has landed or CI has gone red and the user says "address the PR", "address the review", "fix the review comments", "respond to the comments", "work through the feedback", "fix CI", "the checks are failing", "get this PR green", or points at existing review feedback, PR comments, or failing checks to resolve. Not for opening a new PR, writing its initial description, giving a first review, or merging.
license: MIT
argument-hint: '[PR number, url or branch, or a path to a review file]'
---

# Address PR

## Source

- **In session** — the findings are already in the context: a review report, comments the user pasted, or a file the user points at. Skip **Fetch** and **Reply**.
- **GitHub PR** — the feedback is on a PR. Do every section.

Use GitHub mode whenever the findings are on a PR, even if this session also produced them.

## Fetch

`scripts/fetch.ts` sits in the directory that holds this file. Expand it to a full path before you run it.

```bash
node scripts/fetch.ts [PR]   # defaults to the current branch's PR
```

Returns unresolved inline threads, review bodies and conversation comments. Run it at the start of every pass; earlier reads are stale. Skip bot CI and coverage noise. Hide a bot comment that only tallies its inline findings ("🚨 1 blocking, 4 non-blocking") right away:

```bash
gh api graphql -f query='mutation($id:ID!){minimizeComment(input:{subjectId:$id,classifier:RESOLVED}){minimizedComment{isMinimized}}}' -f id=COMMENT_ID
```

When `commentCount` is more than the comments you got, the middle of that thread is missing; read it on the PR before you reply.

In a thread the first comment is the feedback and the rest is the discussion so far. A review body or conversation comment has no thread: a `me` comment that links to it is its discussion. A vote (`userVotes`) from `me`, or a non-`isBot` `me` comment, is the author's position; an `isBot` `me` comment is feedback to act on. Don't reply again to a thread whose last comment is a non-`isBot` `me` comment unless it asks something new; if that reply was not an `Asked`, the resolve did not land, so resolve it now.

## Conflicts

GitHub mode. If `mergeable` is `CONFLICTING`, merge the base (`base` from `fetch.ts`) into the branch first: `git fetch origin <base> && git merge FETCH_HEAD`. Fetch it, don't merge a bare local `<base>` that may be stale or missing, and don't rebase, which breaks the commit links in earlier replies. Keep both sides' intent in each conflict, and push. `UNKNOWN` means GitHub is still computing it: wait a few seconds before re-fetching. In both cases run `fetch.ts` again.

## Decide

Check each claim against the file as it stands now, not the diff hunk or the snippet quoted in the comment. Fix it when it holds up. When it names a real risk but its suggested fix is wrong, fix the risk the correct way and say how your fix differs. Decline when it misreads the code, is already handled, or would break something outside the diff. Ask when it's ambiguous. Out of scope when it's right but doesn't belong in this change; propose a follow-up task in the summary rather than creating one. For `isOutdated` threads, confirm the concern still applies.

Every finding gets an outcome. A 👍, 👎 or reply from `me` in the thread settles the close calls; when it disagrees with what the code shows, follow the code and say so in the summary.

Some calls are the author's, not yours: which of two valid fixes to take, whether flagged behaviour was deliberate, whether a decline is one they'll defend under their name. In GitHub mode, when the thread and the code don't answer them, put those to the user in one batched question at the end of this step so nothing is fixed or posted before they answer, each option a concrete outcome — "fix as suggested", "decline: already handled at line 24", "follow-up task". This isn't the `Asked` outcome, which is a question posted to the reviewer.

In session, act and report the outcome instead of asking.

## Apply

Fix the cause, not the symptom: suppressing a warning, skipping a test, loosening an assertion, editing a workflow or special-casing the reviewer's input is not a fix. Fix in small commits.

## Reply

GitHub mode. Push the fixes before you post.

1. Write each reply to a file; never pass a body inline on the shell. Read shas, line numbers and issue numbers from their source right before use. Link shas as `[a1b2c3d](https://github.com/REPO/commit/FULL_SHA)` via `git log -1 --format='%h %H'`.
2. Post:
   - Inline thread: `gh api repos/REPO/pulls/N/comments/<comments[0].databaseId>/replies -F body=@FILE`
   - Review body or conversation comment: `gh pr comment N --body-file FILE`, opening with a link to what it answers: `Re [short label](url)`.
3. Vote on the feedback (`comments[0].id` of a thread, or the `id` of a review body or conversation comment) unless `userVotes` already holds one. `THUMBS_UP` when it should be addressed: fixed, or agreed but out of scope. `THUMBS_DOWN` when declined, but only on an automated comment (`isBot`); a human's decline is carried by the reply alone. No vote when asked or outdated.
   `gh api graphql -f query='mutation($id:ID!,$c:ReactionContent!){addReaction(input:{subjectId:$id,content:$c}){reaction{content}}}' -f id=ID -f c=THUMBS_UP`
4. Resolve every thread you replied to, and hide every conversation comment you replied to with the minimize command from **Fetch**: fixed, declined, out of scope and outdated alike. Only an `Asked` one stays open, because the reviewer has not answered it yet.
   `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=THREAD_ID`

Replies are one or two sentences, outcome first. Fixed: what changed plus the linked sha, and the reason when the fix is not the one suggested. Declined: the line or symbol that answers the comment. Out of scope: agree and say it goes to a follow-up. No openers like "Great point" or "You're right", and no recap of their comment.

## CI

GitHub mode, when `checks` is true — after any fixes are pushed, or right away if there were none. Wait for the checks on the head with `gh pr checks N --watch --interval 30` in the background. Restart it if it stops early, including the "no checks reported" exit it gives for a few seconds after a push, but at most twice; if it still reports nothing the head has no checks, so report the check as Pending and move on. For each failing check, read `gh run view --job JOB_ID --log-failed` and find the first error, not the last line. Fix the cause and push. Out of scope when the base branch fails the same way (`gh run list --branch <base> --workflow NAME --limit 5`). If the error names infrastructure, not code, rerun once with `gh run rerun RUN_ID --failed`; a second failure is the branch's.

## Finish

In GitHub mode, run `fetch.ts` again and loop on anything new.

If there is a PR, compare its description with `git diff <base>...HEAD` and update it where the branch no longer matches; no revision history, no "no longer applies" notes.

Then summarise to the user, one row per item, linked to its `url`:

| Comment                            | Outcome      | Vote | Change                                               |
| ---------------------------------- | ------------ | ---- | ---------------------------------------------------- |
| [`useFoo.ts:24`](URL)              | Fixed        | 👍   | Moved normalisation into the transformer (`a1b2c3d`) |
| [`Bar.vue:88`](URL)                | Declined     |      | The null guard on line 24 already covers it          |
| [review body: error handling](URL) | Out of scope | 👍   | Proposed as a follow-up task below                   |

Outcomes: Fixed, Declined, Out of scope, Asked, Outdated. `Asked` and `Outdated` are GitHub only. A failing check is a `CI: <name>` row linked to its url, with outcome Fixed, Rerun, Out of scope or Pending. Below the table, list only what the user should know: where you went against a vote or reply of theirs, and what needs their call.

In session, drop the `url` link and the Vote column, and name each finding by its `file:line` and its severity/category tag.
