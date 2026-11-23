---
name: update-address-pr
description: Improve skills/address-pr from what happened after its answers on real PRs, such as reviewer pushback, findings re-raised on the next review, and reverted fixes. Run it against any repo where address-pr has answered review feedback.
license: MIT
argument-hint: '[--repo OWNER/NAME] [--days N]'
disable-model-invocation: true
---

# Update Address PR

## Privacy

This repo is public, and the repo you collect from is often private. Keep everything from the run out of this repo, its commits and its PR text: no repo, org, person, PR number, URL, path, code or quote. Write each change as a rule that holds on any repo. Give the evidence to the user in the session only.

## 1. Collect

Run the scripts beside this file from a checkout of the target repo, or pass `--repo`:

```bash
node scripts/collect.ts [--repo OWNER/NAME] [--days 30]
```

It reads the PRs that the gh user opened, and, for each piece of feedback that the author answered (a thread reply, or a `Re [label](url)` line in a grouped comment), what came after: the reviewer's replies, later commits, and later feedback on the same file or PR. An item with none of these is silent and is not judged.

## 2. Judge

Send one subagent per `judge-N.md`, in parallel, to a cheap model:

> Read every item in `<dir>/judge-N.md`. Each is one piece of review feedback, the PR author's answer, and what happened after. Write `<dir>/judge-N.jsonl` in one call, one line per item, every key on every line: `{"url","outcome","response","cause","reason"}`. Copy `url` from the item's `## ` heading.
> `outcome`: fixed | declined | out-of-scope | asked | outdated | none.
> `response`: accepted (agreed, or nothing contradicts the answer) | pushback (the reviewer disputed the answer, called the fix incomplete or wrong, or asked again) | reraised (later feedback makes the same point, in any words; a new point on the same file is not a re-raise) | reverted (a later commit undid or redid the linked fix) | silent.
> `cause`, only for pushback, reraised or reverted, else none: decide (the wrong call) | fix (the right call, but a wrong or partial fix) | reply (the call and fix were right, but the answer gave no reason the reviewer could check) | process (posted, resolved, hid or voted wrongly) | reviewer (the author was right and the reviewer was wrong).
> `reason`: one short phrase that names the pattern in general terms. Escape each quote. Return only the count per response and per cause.

Then:

```bash
node scripts/tally.ts <dir>
```

Fix each problem it prints before you read a count.

## 3. Read the signal

- Open each thread behind a count before you trust it. A bot re-run posts new findings on the same file, and only the same defect is a re-raise.
- A `reviewer` cause is still a defect in the answer when the answer could have stopped it. A bot that re-raises a declined point did not read the reason, so the reason was not where a re-run reads it: count it as `reply`.
- A revert counts only when it touches the linked fix.
- Silence is not agreement, and it is not evidence either.

## 4. Route

Edit `skills/address-pr/SKILL.md`, or its scripts for a `process` cause, in the section that owns the rule:

- `decide`: **Decide**.
- `fix`: **Apply**, or the fix checks in **Decide**.
- `reply`: **Reply**, or the PR description step in **Finish**.
- `process`: **Fetch** and **Reply**, or `scripts/fetch.ts`.

Make the smallest edit that explains the pattern. When a rule already states the principle, widen it instead of listing the case. When an edit makes the file longer, find what it replaces.

## 5. Evidence

- Act only on a pattern that recurs across two PRs and two reviewers. Each bot counts as one reviewer.
- Never weaken a correctness check to get less pushback.
- Skip a pattern that only one repo's conventions explain. address-pr stays generic.

## 6. Deliver

Commit on a branch. In the commit and PR text, state each pattern and its counts in general terms, per **Privacy**. Give the user the thread links behind each pattern in the session.
