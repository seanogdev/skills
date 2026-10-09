# CI

Read this file when the branch has an open PR, in either mode.

Each path below is relative to the skill directory, the one that holds `SKILL.md`. Expand it to a full path before you run a command.

## Reading the checks

`node scripts/fetch.ts [PR]` returns a `ci` field for the head commit of the PR. Read it at the start of the pass, together with the feedback. On a local pass, run the same command and use only that field.

- **`ci: null`** means no check reported on the head commit. On the first read of the pass, the PR has no CI. No CI is not a failing CI. There is nothing to fix and nothing to wait for. The summary says "No CI on this PR" one time, under the table, and has no CI rows.
- **`failing`** holds each check that ended in a state other than `SUCCESS`, `SKIPPED` or `NEUTRAL`. Each one is an item of the pass.
- **`pending`** holds each check that has not finished. Its result is not known yet, so it is not a failure.

Only the checks on the head commit count. A failure on an older commit is history.

## Working a failure

Each failing check is an item, worked by a subagent as **Working the items** in `SKILL.md` says. Pass the check's `name`, `url`, `workflow`, `runId` and `jobId`, and say whether it was already rerun this pass. Two checks that fail for one cause are one item: one commit, and both rows name that sha.

## Waiting for the head

Each push starts CI again on the new head. A rerun starts it again on the same head. Before the summary, wait for the checks on the final head to finish. Start one watch, with its output in a file:

```bash
gh pr checks PR --watch --interval 60 > CHECKS_LOG 2>&1
```

Run it in the background where the harness allows, and let its exit wake you. Do not poll it, tail its log, or sleep in a loop while it runs: every check-in re-reads the whole conversation. If your harness limits how long one command can run, start it again when it stops.

Run this only when the first read of `ci` was not null. On a PR with no checks, `gh pr checks` exits non-zero with "no checks reported". That exit code tells you nothing about a failure.

When the watch exits, read `ci` from `fetch.ts` again, one time. That read decides the result, not the exit code of `gh pr checks`. Directly after a push, `ci` can be null for some seconds before the checks register. Read again before you decide that CI went away. A new failure becomes a new item.

A check that has not finished when you stop to wait gets a Pending row.
