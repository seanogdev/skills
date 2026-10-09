---
name: address-pr
description: Take a GitHub PR to a conclusion, every review comment and every failing CI check, or work through a local review. Use when a review has landed or CI has gone red and the user says "address the PR", "address the review", "fix the review comments", "respond to the comments", "work through the feedback", "fix CI", "the checks are failing", "get this PR green", or points at existing review feedback, PR comments, or failing checks to resolve. Not for opening a new PR, writing its initial description, giving a first review, or merging.
license: MIT
argument-hint: '[PR number, url or branch, or a path to a review file]'
---

Take a PR to a conclusion. Fix each item of live feedback, or push back on it. Fix each failing CI check, or trace it to a cause outside the branch. Then account for the whole pass to the user. On a PR, also reply to each comment either way, vote on it, and resolve the thread.

## Where the feedback is

**A PR.** The default. If no PR was named, use the open PR for the current branch.

**Local.** A review that sits in this conversation: a `/code-review` report, a pasted set of comments, or the user listing what they want changed. A file the user points at is local too. The items are worked the same way.

`$ARGUMENTS` holds what the user typed after the skill name. It is empty when they gave nothing.

Route the invocation like this:

- A path or an `@file` in the invocation means the file.
- The user pointing at feedback already in the conversation ("address that", "fix those", "work through the review above") with no PR named means the conversation.
- Otherwise it is the PR.
- If the user names both, read both. Run each under its own rules. Then give one summary that covers the lot.

Then read the file for that mode before you do anything else. Each path in this skill is relative to the directory that holds this file. Expand it to a full path before you use it.

- A PR: `references/github.md`.
- Local: `references/local.md`.

The mode file holds the rules this file does not repeat.

If the branch has an open PR, CI is part of the pass in either mode. Read `references/ci.md` too. A PR with no CI is not a failing PR.

## Working the items

Split the feedback into items, one per distinct point. Each failing check is an item too. Where two items raise the same issue, make them one item, so one commit fixes both. A thread that came back only to accept the last answer or say thanks is not an item: it gets an Acknowledged row in the summary and nothing else.

Hand each item to a subagent, one at a time, since they all commit to the same branch. The subagent checks the claim, makes the fix, commits, and drafts the reply. Its file reads, edits and test output stay in its own context, so yours stays small across a long pass.

Pick the checkout first. If `git worktree list` shows a checkout of the PR branch, use that one. Then send each subagent this prompt, filled in. Expand `SKILL_DIR` to the full path of the directory that holds this file.

```
Work one item of PR feedback. Read SKILL_DIR/references/item.md first and follow it.

Checkout: <full path>
Reply file: <full path, one per item>
Item:
<a comment: url, author, isBot, path:line, isOutdated, whether it came back
 from an earlier pass, the user's vote, and every comment in the thread>
<a check: name, url, workflow, runId, jobId, head sha, base branch, and
 whether it was already rerun>
<anything the user said about this item>
```

Each subagent returns an outcome, a commit, evidence, a one-line change, and notes. Weigh each return before you act on it:

- Read the evidence line yourself before you accept a decline of a comment the user voted up.
- If a return does not hold up, send the same subagent back with what is wrong, rather than a fresh one.
- An Asked outcome on local feedback is a question for the user. Ask it.
- Where the subagent ran a rerun, the wait in `references/ci.md` covers it.

Push to the PR branch once, after the last item and **before** any reply goes out. Each reply must point at code that is already on the PR. A local pass with no PR pushes nothing.

## Finishing

**Re-read the feedback before the summary.** Run `node scripts/fetch.ts` again. The pass took time, and a reviewer may have commented during it. On local feedback, read the file again for the same reason. Also check whether the user has said anything since the invocation that changes the ask. Anything the first read missed goes through the same items, reply, vote and resolve loop. Then query once more. A thread you have just answered and resolved drops out of the next read. Each push starts CI again, so wait for the checks on the final head as `references/ci.md` says. Write the summary only when a fresh query comes back with nothing left to act on, and no check on the head fails or is still running.

A thread can come back with nothing new to decide and still not be done. `fetch.ts` returns a thread whenever `isResolved` is false, whether or not a human has spoken since. If the last comment on it is your own reply and it is still unresolved, that is not a thread you already handled: the vote or the resolve from earlier in the pass did not land. Cast the vote and resolve the thread now. Do not read an unchanged thread as settled; read `isResolved` on it.

**Bring the PR description up to date.** Read the PR body once the re-read above comes back with nothing left to act on. This covers a local pass too, wherever the branch has an open PR. With no PR there is nothing to do here. The fixes this pass made can change what the branch does, or make a claim in the body false. If either happened, write the body again from scratch for the branch as it stands, and post it with `gh pr edit --body-file`. That replaces the whole body, so keep every image, video and `user-attachments` link the author added, with its heading and caption, and every issue or PR reference the diff cannot regenerate. If the fixes changed nothing the body states, leave the body as it is. Do this once, here, not once per comment.

Do not add a revision history, in a `<details>` block or anywhere else. Do not leave a note beside a claim that says the claim no longer holds: remove the claim. The reviewer needs the branch as it stands, not the path it took to get there.

The summary goes to the user. It is the last thing the pass produces. Write it once the fixes are pushed and every thread is settled, so the shas and the outcomes in it are real.

Lead with a table, one row per piece of feedback, in query order:

| Comment                       | Outcome            | Change                                                                      |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------- |
| [`useFoo.ts:24`](COMMENT_URL) | Fixed              | Moved the normalisation into the transformer (`a1b2c3d`)                    |
| [`Bar.vue:88`](COMMENT_URL)   | Declined           | The null guard on line 24 already covers it                                 |
| [`Qux.ts:40`](COMMENT_URL)    | Partially accepted | Renamed the prop (`b2c3d4e`). The default stays, because the parent sets it |
| [`Baz.ts:12`](COMMENT_URL)    | Out of scope       | Tracked in #418                                                             |

How to fill it in:

- Link every row to its `url`, so the user can read the feedback without hunting for it. A local item has no url: label it `path:line` and leave it unlinked.
- Use one of ten outcomes and nothing else: Fixed, Partially accepted, Worked around, Declined, Out of scope, Asked, Outdated, Acknowledged, Rerun, Pending. Acknowledged is for a thread that came back only to accept the last answer, so it is PR-only. Rerun is for a flaky check that passed when it ran again, and Pending is for a check that did not finish. Those two are CI-only.
- Fixed means the problem is gone. A change that hides the symptom is Worked around, and that row names the real fix. A comment that you took only in part is Partially accepted, and that row names both parts.
- Name the commit sha for every fix.
- Keep each Change cell to one line.
- Take the Change cell from the subagent's one-line change.
- Do not repeat the Outcome word in the Change cell. "Fixed" beside "Fixed the null guard" says it twice.
- Do not repeat the file or the line from the Comment cell.
- Give the review bodies and the conversation comments a row each. Mark the Comment cell on any row that is not inline: `review body` or `conversation`.
- Give each failing check a row after the feedback. Its Comment cell is `CI: <check name>`, linked to the check's `url`.

Then, under the table, add the parts a table cannot hold. Add only what the table cannot carry. Never restate a row:

- Every comment the user voted up, or said out loud that they wanted, that you declined anyway, with the reason. This one goes first.
- Every thread that came back from an earlier pass, and whether the reviewer's answer moved your call.
- Anything you resolved on thin reasoning.
- Every point you worked around rather than fixed, and what the real fix is.
- Any thread you left open, and any automated comment you left unvoted.
- Any check that still fails on the head, and why.
- Anything that needs the user's call.

A resolved thread is easy for the reviewer to scroll past. The user should know where you closed a door on their behalf.
