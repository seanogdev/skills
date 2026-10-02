---
name: resolve-conflicts
description: Resolve the merge conflicts on a branch, have the resolution reviewed, fix what the review finds, and push. Use when the user says "resolve the conflicts", "fix the merge conflicts", "this PR has conflicts", "update my branch with main", "rebase onto main and sort out the conflicts", or a merge, rebase or cherry-pick stops on a conflict. Not for addressing review comments, merging a PR into its base, or a first review of a branch.
license: MIT
argument-hint: "[PR number, url or branch] [base branch]"
---

Bring a branch up to date with its base. Resolve every conflict so that both sides keep what they meant to do. Then get a fresh review of the resolution, take each finding to a conclusion, and push. Account for the whole pass to the user at the end.

`$ARGUMENTS` holds what the user typed after the skill name. It is empty when they gave nothing.

## 1. Find the conflict

Pick the branch. A PR or a branch in `$ARGUMENTS` wins. Otherwise use the current branch. If `git worktree list` shows a checkout of that branch, work in that checkout.

Pick the base. A base in `$ARGUMENTS` wins. Then the PR's base: `gh pr view --json baseRefName`. Then the remote default branch: `git symbolic-ref refs/remotes/origin/HEAD`.

Check what git is in the middle of. `git status` names an in-progress merge, rebase or cherry-pick. Continue that operation. Do not start a different one.

With nothing in progress, check the working tree first. Uncommitted changes that are not yours to commit mean you stop and ask. Then `git fetch` and start the update:

- **Merge** by default: `git merge origin/<base>`. A merge adds a commit and rewrites nothing, so the push needs no force.
- **Rebase** only when the user asked for it, or the branch history shows it is kept linear: no merge commits from the base, and earlier pushes were force pushes. A rebase rewrites published commits, so the push needs `--force-with-lease`.

Record the branch head before the update: `git rev-parse HEAD`. The review needs it.

If the update finishes with no conflicts, the conflict list is empty. Go on to step 3 anyway. A clean textual merge can still break the code.

## 2. Resolve each conflict

List the conflicted files: `git diff --name-only --diff-filter=U`. Every file on that list gets a resolution. Done means the list is empty and `git grep -nE '^(<<<<<<<|=======|>>>>>>>)( |$)'` finds no marker left in a tracked file.

For each conflicted hunk, learn the intent of both sides before you write anything:

- Read the commits that touched the file on each side: `git log --oneline <merge-base>..HEAD -- <file>` and `git log --oneline <merge-base>..MERGE_HEAD -- <file>`. In a rebase, the side being replayed is `REBASE_HEAD`.
- Read `git diff <merge-base> <side> -- <file>` for each side. The base version shows what each side changed, which the two conflict halves alone do not.
- Read the whole file and the code that calls into the hunk, not only the markers.

Write the resolution that keeps both intents. Taking one side whole is correct only when the other side's change is already present in another form, or the other side deleted the code on purpose. Say which, in the summary.

Some files follow their own rule:

- **Lockfiles and generated files.** Take the base version, then run the tool that generates them. Never merge their text by hand.
- **A file deleted on one side and changed on the other.** Find out why it was deleted. If the code moved, carry the change to where it moved. If it was removed on purpose, drop the change and say so.
- **A rename on one side.** Apply the other side's edits to the renamed file, and update any new caller that still uses the old name.

When the intent of a hunk is unclear, ask the user. A guessed resolution looks finished and hides a bug.

Look past the conflict list for **semantic conflicts**: code that merged cleanly but no longer fits together. One side renames a function, changes a signature or a type, or removes an export. The other side adds a new use of the old form. Search the merged tree for every name either side renamed or removed.

Run the project's checks: build, type check, lint and tests, whatever the repo defines. A failure that the base branch also has is not yours. Confirm that on the base before you say so. Fix any failure the update caused.

Then finish the operation. Stage the files and run `git merge --continue`, `git rebase --continue` or `git cherry-pick --continue`. Keep the default merge message. A rebase stops again at each commit that conflicts. Run this step for each stop until the operation ends.

## 3. Review the resolution

Get a review from a reviewer who did not write the resolution. Dispatch a subagent with a fresh context when your harness has one. Otherwise run the review yourself as a separate pass, after you read the brief below again.

Give the reviewer the base, the old branch head from step 1, the new head, and the brief below. The reviewer reads the code and reports. The reviewer changes nothing.

> Review how a branch update resolved its merge conflicts. Report findings only. Change no file.
>
> Read the resolution:
>
> - For a merge, `git show --remerge-diff <merge-commit>` shows how the resolution differs from git's own conflicted result. Every line in it is a decision a person made.
> - For a rebase, `git range-diff <base>..<old-head> <new-base>..<new-head>` shows how each replayed commit changed.
> - For any fixup commits after the update, `git log -p <update>..<new-head>`.
>
> Check each of these:
>
> 1. **Lost change.** A change from either side that the result no longer contains. Compare each side's diff from the merge base with the result.
> 2. **Wrong side.** A hunk that kept one side's version where the other side's change was the later or more correct one.
> 3. **Double change.** Code that both sides added in different forms, now present twice.
> 4. **Semantic conflict.** A call, import or type use that refers to something the other side renamed, moved, removed or changed.
> 5. **Stray text.** A conflict marker, a debug line, or an unrelated edit made during the resolution.
> 6. **Tests.** A test that one side added or changed and that the result drops, skips or weakens.
>
> For each finding give the file and line, what is wrong, the evidence, and the fix you suggest. Read the code at that line before you report it. Report "no findings" if there are none.

The review is done when it returns findings or an explicit "no findings".

## 4. Address the findings

Take every finding to a conclusion: fix it, or decline it with evidence.

Check each claim against the code as it now stands. Read the surrounding file and trace the path the finding describes. Fix it if the claim holds up. Decline it if it misreads the code or cannot be reproduced, and name the line that shows why.

Fix the cause. Restore a lost change from the side that made it. Commit each fix as its own small commit on top. Do not amend the merge commit. A fixup commit shows the reviewer of the PR what changed after the update.

After the fixes, run the project's checks again. If the fixes touched more than a line or two, send the new commits through step 3 once more. Stop when a review comes back with nothing left to act on.

## 5. Push

Push only once the checks pass and every finding is settled.

- After a merge: `git push`.
- After a rebase: `git push --force-with-lease`. Never use a plain `--force`. If the lease fails, someone pushed to the branch during the pass. Fetch, look at what they pushed, and bring it in before you push again.

Read the push result. A rejected push is not a finished pass.

If the branch has an open PR, check `gh pr view --json mergeable`. `MERGEABLE` means you are done. `CONFLICTING` means the base moved during the pass: go back to step 1. `UNKNOWN` means GitHub has not computed it yet: check again after a short wait.

## 6. Report

The summary goes to the user. Write it after the push, so the shas in it are real. Read every sha back with `git log`.

Lead with a table of the conflicts, one row per conflicted file:

| File                | Resolution                                                               |
| ------------------- | ------------------------------------------------------------------------ |
| `src/api/user.ts`   | Kept the base's new `fetchUser` signature and the branch's retry wrapper |
| `package-lock.json` | Regenerated from the base version                                        |
| `src/old/legacy.ts` | Deleted, as on the base. The branch's edit moved to `src/new/legacy.ts`  |

Then a second table of the review findings, one row per finding:

| Finding              | Outcome  | Change                                                |
| -------------------- | -------- | ----------------------------------------------------- |
| `src/api/user.ts:42` | Fixed    | Restored the timeout the branch added (`a1b2c3d`)     |
| `src/app.ts:10`      | Declined | The base re-exports `getUser` on line 3 of `index.ts` |

Use one of three outcomes: Fixed, Declined, Asked. Name the sha for every fix. Write "No findings" in place of the table when the review found nothing.

Under the tables, add only what they cannot hold:

- Whether the update was a merge or a rebase, and the push command you ran.
- Every hunk where you took one side whole, and why.
- Every check that fails on the base too, and so still fails.
- Anything that needs the user's call.
