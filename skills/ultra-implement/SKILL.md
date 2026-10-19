---
name: ultra-implement
description: Implement every sub-issue of a parent issue as its own PR, unattended. Sub-issues run in dependency order, and the ones whose predecessors are ready run in parallel. Each PR gets tests, browser checks and screenshots where they fit, and a three-lens review. Run it by typing /ultra-implement with the parent issue.
license: MIT
argument-hint: "<parent issue link or reference>"
disable-model-invocation: true
---

`$ARGUMENTS` holds the parent issue. If it is empty, ask for it and stop.

Call the Workflow tool with `scriptPath` set to `workflow.js` in this skill's directory and `args` set to `{ "parent": "<the parent issue>" }`. Typing this skill's command is the user's opt-in to the workflow.

The workflow:

1. Reads the parent issue. Its description is the spec for every sub-issue.
2. Orders the open sub-issues by their dependency links. It skips the ones that need a person (a release, a sign-off, an open decision) and the ones in a dependency cycle.
3. Starts each sub-issue when its predecessors are ready, in its own worktree. The branch and the PR base are the predecessor's branch, or the default branch when there is none.
4. Per sub-issue: implement with tests first, browser checks and screenshots where the change is visible, a PR, then correctness, design and spec reviewers in parallel, then a finisher that fixes the findings, re-checks the tests and moves the issue to review.
5. Stops a sub-issue that needs a change outside the repo, and blocks the sub-issues after it.

For an unattended run, start the session in auto permission mode, then send it to the background.

When the workflow returns, give a table with one row per sub-issue: the issue, the PR link, and the status. Add the reason for each skipped, blocked or failed one. Then list what the user must do next: the blocked backend changes, the skipped sub-issues, and the PRs to review.
