---
name: approve-prs
description: List open PRs awaiting your review, or one user's open PRs in a repo, each with a short summary and a 1-5 risk rating, then approve or comment on the ones you pick.
license: MIT
argument-hint: '[username] [owner/repo]'
disable-model-invocation: true
allowed-tools: Bash(node *approve-prs/scripts/*), Bash(gh pr diff*), Bash(mktemp -d*)
---

# Approve PRs

Each `scripts/` path is relative to the directory that holds this file. Expand it to a full path
before you run it. Keep every working file in one directory from `mktemp -d`, called `$DIR` below.

Arguments from the user: `$ARGUMENTS`

## 1. Fetch

```bash
node scripts/fetch.ts $ARGUMENTS > "$DIR/prs.json"
```

With no arguments it lists every open PR where your review is requested, across all repos. With a
username it lists that user's open PRs in the repo given as the second argument, or in the current
checkout's repo. Each entry carries an `id` (`owner/repo#number`), size, files, body, `isOwn`,
`isDraft`, a `baseRisk` from 1 to 5, and the `signals` behind it.

If the list is empty, say so and stop.

## 2. Assess

Read each PR's diff with `gh pr diff <number> -R <owner/repo>`, in parallel. For a diff over about
1,500 lines, read the riskiest files rather than all of it.

Write `$DIR/assessments.json`, keyed by `id`:

```json
{ "owner/repo#123": { "summary": "Fix login redirect", "risk": 3, "reason": "touches auth redirect" } }
```

- **summary**: what the PR does, judged from the diff, in 20 characters or fewer.
- **risk**: `baseRisk`, or one step either side of it when the diff shows what the file paths can't:
  a trivial edit in a file that only sounds sensitive moves down, a behaviour change to widely shared
  code moves up.
- **reason**: a few words on why.

## 3. Show the list

```bash
node scripts/render.ts "$DIR/prs.json" "$DIR/assessments.json"
```

When it fails on an assessment, fix `assessments.json` and rerun. On success, show the user the
table it prints, as is.

## 4. Ask

The output ends with a JSON array of `AskUserQuestion` calls. Make each call with its questions
exactly as given. An empty array means there is only one PR: go straight to the action question.

Then get the action questions for the PRs the user chose, passing each chosen option label or `id`:

```bash
node scripts/render.ts "$DIR/prs.json" "$DIR/assessments.json" --actions '<label or id>' ...
```

Make those calls too. For `Approve with comment` or `Comment only`, the comment is the user's notes
on that answer, or the text they typed under "Other". When neither has text, ask for the comment in
chat. Drop PRs answered `Skip`.

## 5. Post

The user's answers are the confirmation. Write `$DIR/decisions.json`, with each comment word for
word as the user wrote it:

```json
[
  { "id": "owner/repo#123", "action": "approve" },
  { "id": "owner/repo#124", "action": "approve-comment", "body": "Nice cleanup." },
  { "id": "owner/repo#125", "action": "comment", "body": "Can we add a test for the empty case?" }
]
```

```bash
node scripts/review.ts "$DIR/prs.json" < "$DIR/decisions.json"
```

It checks every decision before posting any. When it refuses, fix the file and rerun.

## 6. Report

Relay the line `review.ts` prints for each PR. Done when every chosen PR shows `ok` or `failed`, and
each failure has its reason.
