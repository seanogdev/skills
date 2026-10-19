---
name: ultra-implement
description: Implement every sub-issue of a parent issue as its own PR, unattended. Sub-issues run in dependency order, and the ones whose predecessors are ready run in parallel. Each PR gets tests, browser checks and screenshots where they fit, and a three-lens review. Run it by typing /ultra-implement with the parent issue.
license: MIT
argument-hint: '<parent issue link or reference>'
disable-model-invocation: true
---

`$ARGUMENTS` holds the parent issue. If it is empty, ask for it and stop.

Read `workflow.js` in this skill's directory. Call the Workflow tool with its full contents as `script` and `args` set to `{ "parent": "<the parent issue>" }`. The tool refuses a `scriptPath` outside the working directory. Typing this skill's command is the user's opt-in to the workflow.

The workflow:

1. Reads the parent issue. Its description is the spec for every sub-issue. At the same time, a preflight checks that the dev server and the browser login work, and finds test data. When they do not work, the run stops before any sub-issue starts.
2. Orders the open sub-issues by their dependency links. It skips the ones that need a person (a release, a sign-off, an open decision) and the ones in a dependency cycle.
3. Starts each sub-issue when its predecessors are ready, in its own worktree. The branch and the PR base are the predecessor's branch, or the default branch when there is none.
4. Per sub-issue: implement with tests first, browser checks and screenshots where the change is visible, a PR, then correctness, design and spec reviewers in parallel, then a finisher that fixes the findings, re-checks the tests and moves the issue to review.
5. Stops a sub-issue that needs a change outside the repo, and blocks the sub-issues after it. A sub-issue whose only open checks need a person to set up returns needs_person and does not block the ones after it.

For an unattended run, start the session in auto permission mode, then send it to the background.

When the workflow returns with a blocked preflight, tell the user what to fix, such as logging in again, and to run the command again. Otherwise give a table with one row per sub-issue: the issue, the PR link, the status, and the tracker stage. Add the reason for each skipped, blocked, needs_person or failed one. Then list what the user must do next: the blocked backend changes, the checks that need a person, the skipped sub-issues, and the PRs to review.
