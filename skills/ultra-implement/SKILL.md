---
name: ultra-implement
description: Implement every sub-issue of a parent issue unattended, as one combined PR when they build one thing, or one PR each when they are separate work. Sub-issues run in dependency order, and the ones whose predecessors are ready run in parallel. Each PR gets tests, browser checks and screenshots where they fit, and a three-lens review. Run it by typing /ultra-implement with the parent issue.
license: MIT
argument-hint: '<parent issue link or reference>'
disable-model-invocation: true
---

`$ARGUMENTS` holds the parent issue. If it is empty, ask for it and stop.

Read `workflow.js` in this skill's directory. Call the Workflow tool with its full contents as `script` and `args` set to `{ "parent": "<the parent issue>" }`. The tool refuses a `scriptPath` outside the working directory. Typing this skill's command is the user's opt-in to the workflow.

The workflow needs a GitHub remote and the gh CLI. To explain how it works, or to debug a run, read `references/how-it-works.md`.

Before a resume of a run, remove that run's worktrees and local branches that have no changes, since old worktree paths block the new ones.

For an unattended run, start the session in auto permission mode, then send it to the background.

When the workflow returns, read `references/report.md` and report as it says.
