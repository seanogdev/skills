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

1. Reads the parent issue and the sub-issues once, and passes their descriptions to every later agent, so no agent reads the tracker for them again. The parent's description is the spec for every sub-issue. At the same time, a preflight checks that the dev server and the browser login work, finds test data, and starts one before server from the default branch, which every agent uses for its before screenshots and which is stopped at the end of the run. When they do not work, the run stops before any sub-issue starts. It also finds out if the spec is a refactor or a migration, where existing screens must look and behave as before (preserve mode).
2. Orders the open sub-issues by their dependency links. It skips the ones that need a person (a release, a sign-off, an open decision) and the ones in a dependency cycle. It also picks the delivery. `shared` puts every sub-issue PR into one shared branch, which it creates from the default branch: for a spec or project instructions that ask for one branch or one PR, or slices that must not ship alone. `separate` sends each PR to the default branch. When the shared branch cannot be created, the run stops before any sub-issue starts.
3. Starts each sub-issue when its predecessors are ready, in its own worktree. The branch and the PR base are the predecessor's branch, or else the shared branch or the default branch.
4. Per sub-issue: implement with tests first, browser checks and screenshots where the change is visible, a PR, then correctness, design and spec reviewers in parallel, then a finisher that fixes the findings, re-checks only what its fixes change, runs the type check once as its last check, and moves the issue to review, then an addresser that waits for CI and the CI review and addresses the PR with the address-pr skill. The sub-issues after it start when the finisher is done, while the addresser runs.
5. Stops a sub-issue that needs a change outside the repo, and blocks the sub-issues after it. A sub-issue whose only open checks need a person to set up returns needs_person and does not block the ones after it.
6. In preserve mode, the before screenshots come from the default branch, and each difference on an existing screen that the spec does not name is fixed. When all sub-issues have finished, one agent merges every ready PR branch locally (never pushed) and compares the touched screens with the default branch in a browser. It returns the differences, each with its PR.

Before a resume of a run, remove that run's worktrees and local branches that have no changes, since old worktree paths block the new ones.

For an unattended run, start the session in auto permission mode, then send it to the background.

When the workflow returns with a blocked preflight or a blocked shared branch, tell the user what to fix, such as logging in again or creating the branch, and to run the command again. Otherwise state the delivery and its reason, then give a table with one row per sub-issue: the issue, the PR link, the status, and the tracker stage. Add the reason for each skipped, blocked, needs_person or failed one. Then list what the user must do next: the blocked backend changes, the checks that need a person, the skipped sub-issues, and the PRs to review. With a shared branch, add the PR from it to the default branch, which the user opens when the slices have merged into it. When PRs stack (a PR's base is another sub-issue's branch), give the merge order as a numbered list, bottom of the stack first, then the PR from the shared branch to the default branch if there is one. When the default branch moved during the run and a stack exists, merge it through the stack bottom-up before you report the order, or list that as a next step. When the preserve check ran, give its differences and their PRs.
