# CI

Read this file when the branch has an open PR, in either mode. The rules that decide and fix an issue live in `SKILL.md`. They apply to a failing check the same way they apply to a comment.

Each path below is relative to the skill directory, the one that holds `SKILL.md`. Expand it to a full path before you run a command.

## Reading the checks

`node scripts/fetch.ts [PR]` returns a `ci` field for the head commit of the PR. Read it at the start of the pass, together with the feedback. On a local pass, run the same command and use only that field.

- **`ci: null`** means no check reported on the head commit. On the first read of the pass, the PR has no CI. No CI is not a failing CI. There is nothing to fix and nothing to wait for. The summary says "No CI on this PR" one time, under the table, and has no CI rows.
- **`failing`** holds each check that ended in a state other than `SUCCESS`, `SKIPPED` or `NEUTRAL`. Each one is an item of the pass.
- **`pending`** holds each check that has not finished. Its result is not known yet, so it is not a failure.

Only the checks on the head commit count. A failure on an older commit is history.

## Deciding a failure

Read the log before you decide. For a check with a `jobId`, this prints the steps that failed:

```bash
gh run view --job JOB_ID --log-failed
```

A check with no `jobId` runs on a service outside GitHub Actions. Read what its `url` shows. If you cannot get to the log, give the check an Asked row and tell the user where it is.

Find the first error in the log, not the last line. A later step often fails only because an earlier step failed. Then trace the error to its cause, and put the check in one of these three cases:

- **The branch causes it.** Fix the cause, as **Applying the fixes** in `SKILL.md` says. Run the failing command locally before you push, when you can. The log names the command. If the branch changed a behaviour on purpose and a test still asserts the old behaviour, the fix is the test. If the test catches a regression, the fix is the code. The check must pass because the code is correct. Never make it pass by a change to the check: a skipped or deleted test, a lower threshold, `continue-on-error`, or an edit to the workflow file.
- **The base branch fails the same way.** The failure is older than the branch. Compare with `gh run list --branch BASE --workflow WORKFLOW --limit 5`. It is Out of scope. Do not fix it on this PR unless the user asks.
- **The code does not cause it.** The error names the infrastructure, not the code: a runner that stopped, a network timeout, a registry outage, a test that fails at random. A cancelled check with no error in its log is in this case too. Run the failed jobs again one time with `gh run rerun RUN_ID --failed`. If the job fails again with the same error, it is not a flake. Decide it again under the first two cases.

Two checks that fail for one cause get one commit, and both rows name that sha. A CI fix gets no reply on the PR. The commit is the record.

## Waiting for the head

Each push starts CI again on the new head. A rerun starts it again on the same head. Before the summary, wait for the checks on the final head to finish:

```bash
gh pr checks PR --watch
```

Run this only when the first read of `ci` was not null. On a PR with no checks, `gh pr checks` exits non-zero with "no checks reported". That exit code tells you nothing about a failure. If your harness limits how long one command can run, run it in the background or run it again.

Then read `ci` from `fetch.ts` again. That read decides the result, not the exit code of `gh pr checks`. Directly after a push, `ci` can be null for some seconds before the checks register. Read again before you decide that CI went away. A new failure goes through **Deciding a failure** again.

A check that has not finished when you stop to wait gets a Pending row.
