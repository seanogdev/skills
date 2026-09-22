---
name: create-pr
description: Open or update a GitHub pull request in Sean's format — branch, fast checks, changeset, title, description and labels. Use when opening a PR, running `gh pr create`, or when the user asks to create, open, draft, write or update a PR or a PR description. Not for replying to or resolving comments left on an existing review.
license: MIT
---

# Create a pull request

Each path in this skill is relative to the directory that holds this file. Expand it to a full path
before you run a command.

Before you touch any step below, work out who reads the PR you are about to open. Not you, not the
diff. A reviewer who has not seen the branch, who is about to open the diff, and who needs the body
to make sense of what they are about to read. Write the whole PR for that person. Every rule below
serves that one aim: a reviewer-friendly PR. Where a rule and reviewer-friendliness pull apart,
reviewer-friendliness wins.

## 1. Check the branch

If the current branch is `main` or `master`, create a branch first. Never push to `main`.

Follow the repo's own branch naming rules. Some repos limit the length. Some repos take no `fix/`,
`feature/` or `chore/` prefix.

## 2. Run the fast checks

Run the repo's format, lint and unit test commands. Fix what they report before you continue.

Do not silence a check to make it pass. An `eslint-disable`, a `.skip` or a loosened assertion needs
a comment that says why the rule is wrong here. Put that comment in the PR body. If you cannot fix
what a check reports, stop. Tell the user.

Do not run the reviewer agents here. Do not run browser testing here. State plainly that neither
ran.

Where the repo has a skill that names those commands, follow it.

## 3. Check for a changeset

If the repo uses changesets and the diff ships code, confirm that a `.changeset/` file covers it.
Write one if it is absent. Follow the `changeset` skill for the wording.

## 4. Write the title

Write one line in sentence case. Add a `docs:`, `fix:`, `refactor:` or `i18n:` prefix only when it
helps.

## 5. Write the body

Look for a repository template first: `.github/pull_request_template.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, or a file in `.github/PULL_REQUEST_TEMPLATE/`. If a template
exists, fill it in. Fit the sections below into it; do not replace it. Slot each one under the
template heading it matches in meaning, even where the wording differs. Where no heading matches,
add the section as a nested heading under the template heading it fits closest.

**Changes.** No yapping. Judge a bullet by whether the reviewer gets its point on the first read, not
by its word count. A short bullet that buries its point behind a caveat is unclear. A longer bullet
that states one plain fact is fine. The failure to watch for: a bullet that sets two separate facts
side by side, so the reviewer has to hold both before either one lands. Shortening the sentence does
not fix that. Deciding which fact the bullet is for, stating that one plainly, and cutting the other
does. Cut the second fact to the file table, a code comment, or nowhere, rather than gluing it on
with a semicolon or an `and`. Splitting into a second bullet is not the default fix either. Add one
only when the second fact is itself something the reviewer would miss without it.

Write for a reviewer about to read the diff. Give each bullet the one thing the diff does not say,
stated as its own plain claim, not wrapped in the reasoning that led there. Do not restate the diff.
Do not repeat the title. Do not explain code the reviewer can read.

Read the finished list back as a list, not bullet by bullet. More than six or seven bullets on an
ordinary PR, or a bullet you found yourself explaining rather than stating, is a sign you are
narrating file by file instead of summarising. Merge what belongs together. Cut what the file table
already says.

Call a workaround a workaround. State the real fix as its own plain claim, not as the last link in a
chain of reasoning.

**File table.** Write a collapsible table that covers every changed file. Add a very short note on
how each file changed. Write a few words per cell, not a sentence.

A GitHub table never wraps. It scrolls sideways, so a long path in the File column pushes the Change
column out of view. Remove the prefix that every row shares. Name that prefix once in the summary
line:

```markdown
<details>
<summary>Files changed in <code>src/api/</code></summary>

| File             | Change                      |
| ---------------- | --------------------------- |
| `client.ts`      | Added the retry wrapper     |
| `client.test.ts` | Covers the new backoff path |

</details>
```

If the rows share no prefix, remove what each row shares with its neighbours. Group the table by
directory. If the paths are still wide enough to scroll, drop the table. Use a bullet list, which
wraps at the page width:

```markdown
- `src/api/client.ts`: added the retry wrapper
```

**Focus areas.** Add this section only when part of the diff needs more care from the reviewer than
the rest: a workaround, a judgment call, a change with no test behind it, a change to behaviour
another part of the system relies on. Name the file and the reason, one line each. Skip the section
when nothing in the diff stands out this way.

Where two or more reasons share one file or one theme, write the file or theme as the top bullet and
nest the reasons under it. A flat list that repeats the same file on separate lines makes the
reviewer match them up itself.

```markdown
## Focus areas

- `src/api/client.ts`
  - Retry count is a guess. No data backs the current value.
  - Backoff runs on the caller's thread. A slow retry blocks the request that triggered it.
- `src/api/session.ts`: token refresh now races the request that triggered it.
```

**Describe the state the branch is in.** This rule owns every section of the body, the repo
template's sections included. It does not own the `Changes` bullets alone. How the session reached
the current state is not the reviewer's concern. The reviewer reads the branch as it stands now. So
the body holds:

- No approach you abandoned.
- No order you worked in.
- No problem you hit and then solved.
- No round of review you answered.

Where the branch stands on another branch, that is current state and it stays: which PR this one
follows, which issue it closes, what is still open elsewhere. The behaviour of the code before this
PR also stays, where the reviewer needs it to read the change.

No sentence in the body may refer to an earlier revision of the PR itself. Cut all of these:

- "An earlier revision moved the lead to the observer's margin"
- "the first answer was yes"
- "two things the previous revisions asserted turned out to be false"
- "no performance number on this revision"

Where a superseded claim taught you something the reviewer still needs, state that thing as a fact
about the current code. Where it did not, cut it.

A `Revision history` section is the same mistake inside a `<details>` block. Do not write one.

**Collapse the bulk.** Put anything the reviewer needs on hand but not on screen in a `<details>`
block. Give the block a summary line that says what is inside. That covers review findings, a log
excerpt, a benchmark run and a long list. The file table above is the pattern. Keep the open part of
the body short enough to read without a scroll.

Add no heading the repo's template does not ask for. `Changes`, the file table, `Focus areas` and
`Screenshots` are the whole of it. Add no `Testing`, `Motivation`, `Risks` or `Notes` section unless
the template has one.

Leave a `## Screenshots` heading. Leave it empty unless step 7 fills it. Never write placeholder
text into it.

Punctuate properly. A bullet or a table cell can be a fragment. Do not use em dashes.

Obey any PR description rule the repo's own config sets. A repo may ask for plain language that both
a non-native English speaker and a non-technical reader can follow.

## 6. Push, then create or update

Push the branch. Then check for an open PR on it with `gh pr view`.

- If no PR exists, create it with `gh pr create`.
- If a PR exists, write the body again from scratch under step 5. Then write it back with
  `scripts/pr-body.ts` below.

**Rebuild the body, never append to it.** Read the current body first, for the content the next
section says to keep. Read it also for what it tells you about the branch. Then write the body the
diff asks for today. Do not edit the body line by line. Do not add a paragraph that answers the last
round of review. A body that is patched each round grows, contradicts itself, and keeps claims the
code has moved past.

Open the PR ready for review. Pass `--draft` only when the user asks for a draft, or when the work
is unfinished.

### Carry the author's content across

`gh pr edit` replaces the entire body, and an image attached by hand cannot be restored from the CLI
once it is gone.

```bash
./scripts/pr-body.ts save 23080 > /tmp/pr23080-body-before.md
./scripts/pr-body.ts edit /tmp/pr23080-body-new.md 23080
```

Put the PR number in each temporary file name, and give it to each command. Runs share `/tmp`. Under
a fixed name such as `/tmp/pr-body-new.md`, a second run that works on a different PR overwrites the
file, and the first run then posts that other PR's body, with that other PR's screenshots. The
attachment guard permits this, because it compares the new body against the PR you name, not against
the body you wrote.

Before `edit`, confirm that the file holds the body of the PR that you name. Compare
`gh pr view <PR> --json title` against the body, and read the body back after `edit`.

`edit` refuses to write a body that drops an attachment the author added. It also strips the
trailing newline `gh` adds, which otherwise grows the body by a blank line on every run. `check`
runs the same guard and edits nothing.

`save` also writes a baseline file named after the PR, and `check` and `edit` compare against that
baseline, not against the live body. A body that another run has written over would otherwise make
the guard defend that other PR's attachments and refuse the rightful body. `--baseline FILE` names a
different baseline, and `--baseline none` compares against nothing.

`check` and `edit` also stop when the live body holds an attachment the baseline does not. Somebody
wrote to the PR after your `save`: either a person who added a screenshot, or a run that posted the
wrong body there. Read the live body, then re-run `save` if it is right, or keep your baseline if it
is not.

Keep everything the skill does not own:

- Image and video markup wherever it sits: `![alt](url)`, `<img ...>`, `<video ...>`, and bare
  `https://github.com/user-attachments/...` links.
- The whole `## Screenshots` section, verbatim.
- Any heading the author added that is not `Changes`, the file table, or part of the repo template.
- Every reference the diff cannot regenerate: the task or issue link a template section holds, a
  linked issue number, a `Follow-up to #NNNNN` line. A rebuilt body loses these unless you carry
  them across by hand. Read them out of the saved body before you write the new one.

Every image keeps its heading, its caption and its position. The guard compares attachment urls and
nothing else, so a caption or a heading you drop around one still gets through.

## 7. Attach screenshots the session already produced

Do this only when the session already has screenshots on disk. You do not capture screenshots in
this step. Read `./references/screenshots.md`.

## 8. Apply labels

Follow the repo's label rules when its config provides them. Those rules sometimes sit outside the
repo, in the instructions for the directory that holds it. Apply no labels when no rules exist.

Reconcile the labels on an existing PR too. Remove a label that no longer fits.
