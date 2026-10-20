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

## Conflicts with the base

If the branch has an open PR, read `mergeable` from `node scripts/fetch.ts` in either mode. `CONFLICTING` means you resolve the conflicts before you make any worktree, so each item starts from the updated head. Invoke the `resolve-conflicts` skill on the PR branch and let it push. If that skill is not installed, merge the base into the PR branch, resolve each conflict so that both sides keep their intent, run the project's checks, and push. Then run `fetch.ts` again, because the push replaced the head that `ci` describes. `UNKNOWN` means GitHub has not computed it yet: read again after a short wait. A local pass that will not push resolves nothing: the summary names the conflict.

## Working the items

Split the feedback into items, one per distinct point. Each failing check is an item too. Where two items raise the same issue, make them one item, so one commit fixes both. A thread that came back only to accept the last answer or say thanks is not an item: it gets an Acknowledged row in the summary and nothing else.

Hand each item to its own subagent and start them all in one turn, so they run in parallel. The subagent checks the claim, makes the fix, commits, and drafts the reply. Its file reads, edits and test output stay in its own context, so yours stays small across a long pass. Run it one tier below your own model. In Claude Code, that is `model: "sonnet"` on the Agent call. In another harness, pick its mid-tier model, or leave the default where the harness offers no choice. You keep the judgment on its return.

Parallel subagents cannot share one checkout, so give each its own. Pick the PR branch checkout first: if `git worktree list` shows a checkout of the PR branch, use that one. Then, from it, make one worktree per item on a scratch branch at the current head, all in one command:

```bash
git fetch origin BASE
git worktree add -b address-pr/ITEM_N ../WORKTREE_DIR_N HEAD
```

The fetch keeps `origin/BASE..HEAD` to the commits of this PR after the base moved. Run it once, before the worktrees, so the subagents do not race on the ref.

A fresh worktree has no installed dependencies, so its commit hooks and checks fail. In the same command, install them in each worktree with the repo's lockfile install, for example `pnpm install --frozen-lockfile --prefer-offline`. Each subagent then commits through the hooks.

Send each subagent this prompt, filled in. Expand `SKILL_DIR` to the full path of the directory that holds this file.

```
Work one item of PR feedback. Read SKILL_DIR/references/item.md first and follow it.

Checkout: <full path of this item's worktree>
Reply file: <full path, one per item>
PR: <`pr` and `base` from fetch.ts, or "none" and the default branch>
Item:
<a comment: url, author, isBot, path:line, isOutdated, whether it came back
 from an earlier pass, the user's vote, and every comment in the thread>
<a check: name, url, workflow, runId, jobId, head sha, and whether it was
 already rerun>
<anything the user said about this item>
```

Each subagent returns an outcome, a commit, evidence, a one-line change, and notes. Weigh each return before you act on it:

- Read the evidence line yourself before you accept a decline of a comment the user voted up.
- Read the evidence line of a return with a commit (Fixed, Partially accepted or Worked around) when this PR changed the flagged line. The fix must keep the purpose of that change.
- If a return does not hold up, send the same subagent back with what is wrong, rather than a fresh one.
- An Asked outcome on local feedback is a question for the user. Ask it.
- An Asked return that stopped on a hook failure: if the cause is the worktree setup, for example a missing install, fix it and send the subagent back. Otherwise show the user the hook output and ask.
- Where the subagent ran a rerun, the wait in `references/ci.md` covers it.

Once every subagent has returned, bring the commits onto the PR branch. In the PR branch checkout, cherry-pick each item's commit in query order with `git cherry-pick`. Where one conflicts, resolve it if the fix is plain. Otherwise abort the pick and send that subagent back with the conflict, in a fresh worktree off the new head. A cherry-pick makes a new sha. So read each item's sha back from the PR branch with `git log`, and replace the `SHORT_SHA` and `FULL_SHA` placeholders in its reply file. Then remove the worktrees and scratch branches: `git worktree remove --force PATH` and `git branch -D address-pr/ITEM_N`.

Batch your own calls: independent reads in one call, and the push with the `git log` that reads the shas back.

Push to the PR branch once, after the last item and **before** any reply goes out. Each reply must point at code that is already on the PR. A local pass pushes nothing, unless the user named the PR or asked to push or post, as `references/local.md` says.

## Finishing

**Re-read the feedback.** Run `node scripts/fetch.ts` again, or read the local file again: a reviewer may have commented during the pass, and the user may have changed the ask since. Anything new becomes an item. `mergeable: CONFLICTING` means the base moved during the pass: resolve it as **Conflicts with the base** says. A thread that comes back unresolved with your own reply last is one where the vote or the resolve did not land: cast and resolve it now. Then wait for CI on the final head as `references/ci.md` says. Move on once a fresh read has nothing left to act on and no check on the head fails or is still running.

**Bring the PR description up to date**, once, wherever this pass pushed to an open PR. If the fixes made a claim in the body false, or changed what the branch does, edit only the sentences that no longer hold. Add a sentence where the branch now does something the body does not say. Post the result with `gh pr edit --body-file`. That replaces the whole body, so copy every other line unchanged: each template heading, each checkbox and its state, each image, video and `user-attachments` link with its caption, and each issue or PR reference. Add no new section, and do not rewrite text that is still true. Remove a claim that no longer holds, and put no revision history or note in its place. If the fixes changed nothing the body states or should state, leave it.

## Summary

The summary goes to the user, last, once every fix is pushed and every thread is settled. Lead with a table, one row per item, in query order:

| Comment                       | Outcome            | Change                                                                      |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------- |
| [`useFoo.ts:24`](COMMENT_URL) | Fixed              | Moved the normalisation into the transformer (`a1b2c3d`)                    |
| [`Bar.vue:88`](COMMENT_URL)   | Declined           | The null guard on line 24 already covers it                                 |
| [`Qux.ts:40`](COMMENT_URL)    | Partially accepted | Renamed the prop (`b2c3d4e`). The default stays, because the parent sets it |
| [`Baz.ts:12`](COMMENT_URL)    | Out of scope       | Tracked in #418                                                             |

- **Comment**: linked to the item's `url`. A local item has no url, so label it `path:line`. Mark a row that is not inline `review body` or `conversation`. Failing checks come after the feedback, as `CI: <check name>` linked to the check's `url`.
- **Outcome**: one of Fixed, Partially accepted, Worked around, Declined, Out of scope, Asked, Outdated, Acknowledged, Rerun (a flaky check that passed when it ran again), Pending (a check that did not finish).
- **Change**: the subagent's one-line change, with the sha of every fix.

Under the table, add only what a row cannot carry:

- Every comment the user voted up, or said they wanted, that was declined anyway, with the reason. This one goes first.
- Every thread that came back from an earlier pass, and whether the reviewer's answer moved the call.
- Anything resolved on thin reasoning. A resolved thread is easy for the reviewer to scroll past.
- Every point worked around rather than fixed, and what the real fix is.
- Any thread left open, and any automated comment left unvoted.
- Any check that still fails on the head, and why.
- Each conflict resolution with the base, with the report that `resolve-conflicts` gave.
- Anything that needs the user's call.
