---
name: approve-prs
description: List open PRs awaiting your review, or one user's open PRs in a repo, each with a short summary and a 1-5 risk rating, then approve or comment on the ones you pick.
license: MIT
argument-hint: '[username] [owner/repo]'
disable-model-invocation: true
allowed-tools: Bash(gh search prs*), Bash(gh pr list*), Bash(gh pr view*), Bash(gh pr diff*), Bash(gh repo view*), Bash(gh pr review*)
---

# Approve PRs

Arguments from the user: `$ARGUMENTS`

## 1. Find the PRs

- **No arguments**: every open PR where your review is requested, across all repos:

  ```bash
  gh search prs --review-requested=@me --state=open --limit 50 --json number,title,repository,author,isDraft,url
  ```

- **A username**: that user's open PRs in one repo. The repo is the second argument, or the current
  checkout's repo when there is none:

  ```bash
  gh pr list --author <username> --state open --limit 50 -R <owner/repo> --json number,title,author,isDraft,url
  ```

  Without a second argument, resolve the repo with `gh repo view --json nameWithOwner`.

If the list is empty, say so and stop.

## 2. Assess each PR

For every PR, run `gh pr view <number> -R <owner/repo> --json body,additions,deletions,changedFiles,files`
and read `gh pr diff <number> -R <owner/repo>`. For a diff over about 1,500 lines, read the file list
and the riskiest files instead of the whole diff. Run independent PRs in parallel.

Give each PR:

- **Summary**: what the PR does, in 20 characters or fewer, counted including spaces, e.g.
  `Fix login redirect`. Judge it from the diff, not just the title.
- **Risk**: an integer from 1 to 5, with a reason of a few words.

| Risk | Meaning                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 1    | Docs, comments, copy, tests only, or config with no runtime effect.                                                      |
| 2    | Small, local code change behind clear boundaries, covered by tests.                                                      |
| 3    | Moderate logic change, or a change to shared code with several callers.                                                  |
| 4    | Touches auth, payments, permissions, data migrations, public APIs, or dependencies; or a large change with thin tests.   |
| 5    | Irreversible data change, security-sensitive change, infrastructure or deploy change, or a large cross-cutting refactor. |

Raise the rating one step when the PR has no tests for changed behaviour. Flag drafts.

Move on once every PR has a summary within the limit and a rating with its reason.

## 3. Show the list

Print a table, ordered by risk ascending:

| PR  | Repo | Title | Summary | Risk | Size |
| --- | ---- | ----- | ------- | ---- | ---- |

`PR` links the number to its URL. `Size` is `+additions/-deletions`. Mark drafts in the title.

## 4. Ask which PRs to act on

Use `AskUserQuestion` with `multiSelect: true`. One question holds up to 4 PRs, and one call holds up
to 4 questions, so a call covers 16 PRs. For more, ask again with the rest.

- **Question**: `Which PRs do you want to act on? (<first>-<last> of <total>)`.
- **Option label**: `#<number> <summary>`.
- **Option description**: `<owner/repo> · risk <n>/5 · <title>`.

Then, in one more `AskUserQuestion` call, ask one single-select question per chosen PR (4 per call):

- **Question**: `What do you want to do with #<number> <summary>?`
- **Options**: `Approve`, `Approve with comment`, `Comment only`.

For `Approve with comment` or `Comment only`, the comment text is the user's notes on that answer, or
the text they typed under "Other". When neither carries text, ask for the comment in chat before
posting.

## 5. Post the reviews

Your selections are the confirmation. Post each one:

```bash
gh pr review <number> -R <owner/repo> --approve
gh pr review <number> -R <owner/repo> --approve --body '<comment>'
gh pr review <number> -R <owner/repo> --comment --body '<comment>'
```

Post the comment word for word, as the user wrote it. Use a heredoc for a body with quotes or
newlines.

GitHub refuses an approval on your own PR. Report that refusal and carry on with the rest.

## 6. Report

List each PR acted on, the action taken, and whether `gh` succeeded. Done when every chosen PR has a
result.
