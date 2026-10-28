export const meta = {
  description: 'Implement every sub-issue of a parent issue in dependency order, as one combined PR or one PR each',
  name: 'ultra-implement',
  phases: [
    { detail: 'read the parent spec and order the sub-issues', title: 'Plan' },
    { detail: 'one agent per sub-issue, in its own worktree', title: 'Implement' },
    { detail: 'correctness, design and spec reviewers per PR', title: 'Review' },
    { detail: 'fix findings, test, screenshots', title: 'Finish' },
    { detail: 'wait for CI and the CI review, address the PR, then move the issue', title: 'Address' },
  ],
  whenToUse: 'Run through the ultra-implement skill with the parent issue as args',
};

const parent = typeof args === 'string' ? args : args && args.parent;
if (!parent) throw new Error('Pass the parent issue link or reference as args');

const PLAN_SCHEMA = {
  properties: {
    defaultBranch: { type: 'string' },
    delivery: {
      properties: {
        branch: { type: 'string' },
        mode: { enum: ['separate', 'shared'] },
        reason: { type: 'string' },
      },
      required: ['mode', 'reason'],
      type: 'object',
    },
    preserve: { type: 'boolean' },
    spec: { type: 'string' },
    subIssues: {
      items: {
        properties: {
          description: { type: 'string' },
          id: { type: 'string' },
          predecessors: { items: { type: 'string' }, type: 'array' },
          reason: { type: 'string' },
          skip: { type: 'boolean' },
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['id', 'title', 'description', 'predecessors', 'skip'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['defaultBranch', 'delivery', 'preserve', 'spec', 'subIssues'],
  type: 'object',
};

const BRANCH_SCHEMA = {
  properties: {
    reason: { type: 'string' },
    status: { enum: ['ready', 'blocked'] },
  },
  required: ['status'],
  type: 'object',
};

const PREFLIGHT_SCHEMA = {
  properties: {
    beforePid: { type: 'string' },
    beforeUrl: { type: 'string' },
    beforeWorktree: { type: 'string' },
    browser: { enum: ['ready', 'not_needed', 'blocked'] },
    notes: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['browser', 'notes'],
  type: 'object',
};

const IMPLEMENT_SCHEMA = {
  properties: {
    branch: { type: 'string' },
    reason: { type: 'string' },
    stage: { type: 'string' },
    status: { enum: ['pushed', 'landed', 'blocked', 'failed'] },
    verified: { type: 'string' },
  },
  required: ['status'],
  type: 'object',
};

const CI_SCHEMA = {
  properties: {
    checks: { type: 'string' },
    humanReview: { type: 'string' },
    reviewBot: { enum: ['none', 'on_open', 'on_push', 'on_request'] },
    reviewBotNotes: { type: 'string' },
    typeCheck: { type: 'string' },
  },
  required: ['checks', 'humanReview', 'reviewBot'],
  type: 'object',
};

const FINDINGS_SCHEMA = {
  properties: {
    findings: {
      items: {
        properties: {
          file: { type: 'string' },
          fix: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string' },
        },
        required: ['file', 'problem'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['findings'],
  type: 'object',
};

const FINISH_SCHEMA = {
  properties: {
    prUrl: { type: 'string' },
    reason: { type: 'string' },
    status: { enum: ['ready', 'needs_person', 'failed'] },
  },
  required: ['status'],
  type: 'object',
};

const ADDRESS_SCHEMA = {
  properties: {
    reason: { type: 'string' },
    stage: { type: 'string' },
    status: { enum: ['addressed', 'failed'] },
  },
  required: ['status'],
  type: 'object',
};

const PRESERVE_SCHEMA = {
  properties: {
    differences: {
      items: {
        properties: {
          difference: { type: 'string' },
          prUrl: { type: 'string' },
          screen: { type: 'string' },
        },
        required: ['difference', 'screen'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['differences'],
  type: 'object',
};

const LENSES = [
  {
    focus:
      'Logic bugs, regressions, security holes, type gaps, missing or weak tests, tests that only restate the code, and breaks of the conventions in the project instructions, including the instructions in the folders of the changed files.',
    key: 'correctness',
  },
  {
    focus:
      'New options that could be derived, values that must be kept in sync, a parallel construct beside an existing one, related code or consumers left inconsistent, and code in the wrong layer.',
    key: 'design',
  },
  {
    focus:
      'Each acceptance criterion of the sub-issues in the PR and each rule of the parent spec that applies to it: met, missed, or done differently without a reason.',
    key: 'spec',
  },
];

const TRACKER = `Use the issue tracker tools that this session has (an MCP server or a CLI), and follow the tracker conventions in the project instructions, if any.`;
const READ = `The parent issue is ${parent}. Read it, and its sub-issues. ${TRACKER}`;

const WORKTREE = `You work in a fresh worktree: install the dependencies before the first build or test. A guard refuses each shell command that it cannot prove stays inside this worktree, so:
- Write files with the file tools.
- Run one plain command per shell call, with literal arguments. The guard refuses heredocs, loops, command substitution, shell variables, chains such as "; echo", bash -c, xargs, find -exec, and eval in any command, agent-browser eval included.
- Run git here only: no git -C, and no cd into another checkout.
- Read the page with agent-browser snapshot, get and is.
- Format, lint and test with the repo's own scripts (package scripts, a Makefile, or whatever the repo uses), not a tool that the repo does not use.
- Bound each wait with the shell tool's timeout setting. There may be no timeout command, as on macOS. When a wait runs out, find out why.
Before you return, stop each dev server and browser session that you started.`;

phase('Plan');
const [plan, preflight, ci] = await Promise.all([
  agent(
    `${READ}
The parent's description is the spec for every sub-issue. Do not change anything.

Return:
- spec: the parent's description in full, as written.
- defaultBranch: the remote default branch (git symbolic-ref refs/remotes/origin/HEAD).
- subIssues: each sub-issue that is not done, with its id, title, url, and its description in full, as written. predecessors lists the ids of the open sub-issues in this list that must be done first, from the tracker's dependency links. Drop links to done or outside issues.
- preserve: true when the spec is a refactor or a migration, that is, it says that existing screens or callers must look and behave as before. Otherwise false.
- skip: true, with a reason, for a sub-issue that needs a person: a release, a product sign-off, or a decision that the spec leaves open.
- delivery: how the sub-issues reach the default branch, with the reason.
  - shared: each sub-issue lands on one shared branch with no PR of its own, and one PR takes that branch to the default branch. Pick it when the sub-issues build one thing, such as one feature, one component or one migration, when the spec or the project instructions ask for one branch or one PR, or when a sub-issue alone leaves the default branch in a state that must not ship, such as a half-built feature with no flag, or a consumer that breaks until a later sub-issue lands. Give branch a short name for the whole change, not for its first sub-issue, in the repo's branch naming convention: follow the project instructions and the recent branches on the remote. A branch of that name that is already on the remote is the shared branch.
  - separate: each sub-issue gets its own PR to the default branch, or to the branch of its predecessor. Pick it only when the sub-issues are separate pieces of work that each ship alone.`,
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA },
  ),
  agent(
    `${READ}
Find out how this repo's app is checked in a real browser, from the project instructions and the docs they point to. Change no code and no tracker item.
If no sub-issue changes something visible in the app, return not_needed.
Otherwise start the dev server from this checkout, open the app in a browser session of your own, and confirm that the saved login reaches the app. Find test data on this account that the sub-issues can use: ids that exist and hold the data they need. Then stop the dev server and close the session.
Then start the before server, which every agent of this run uses for its before screenshots. Add a worktree of the remote default branch (git symbolic-ref refs/remotes/origin/HEAD) outside this checkout with git worktree add --detach, install its dependencies, and start its dev server detached, so that it keeps running after you return, with its output in a log file. Confirm that it serves the app with the saved login, then leave it running.
Return ready, with notes on how to start the dev server and find its port, how to log in, how to override feature flags, and the test data ids, and with the before server's URL as beforeUrl, its worktree path as beforeWorktree and its process id as beforePid. Return blocked, with the reason, when the dev server or the login does not work.`,
    { label: 'preflight', phase: 'Plan', schema: PREFLIGHT_SCHEMA },
  ),
  agent(
    `Find out what CI does with a PR in this repo, before any work starts. Change nothing. You run in the user's own checkout, so leave its branch and working tree as they are.
Read the CI config (such as .github/workflows), CODEOWNERS, the project instructions, and the branch protection of the remote default branch (gh api repos/{owner}/{repo}/branches/<branch>/protection, which may be refused). Then look at the last five merged PRs with gh pr list --state merged, gh pr checks and gh pr view --comments, to see which checks and reviewers actually turn up.
Return:
- checks: each check that runs on a PR, its trigger, roughly how long it takes, and the local command that reproduces it. Say which checks run only for some paths, some labels, or a PR to the default branch, so that a PR to another branch skips them.
- reviewBot: on_open when a bot reviews a PR by itself only when it opens or leaves draft, on_push when it reviews again after each push, on_request when it reviews only when asked (a label or a comment), none when no bot reviews. reviewBotNotes: its name, how it posts (a review, inline comments or a summary comment), whether it skips drafts, and how to ask it for another review.
- typeCheck: the command for the type check, or for the build that stands in for one. Leave it empty when the repo has neither.
- humanReview: the approvals that a merge needs, and who owns which paths.`,
    { label: 'ci', phase: 'Plan', schema: CI_SCHEMA },
  ),
]);
if (!plan) throw new Error('The plan agent stopped');
if (preflight && preflight.browser === 'blocked') {
  log(`Browser preflight blocked: ${preflight.reason}`);
  return { ci, parent, preflight, results: [] };
}

async function stopBefore() {
  if (!preflight || !preflight.beforePid) return;
  await agent(
    `Stop the dev server with process id ${preflight.beforePid} and its child processes. Then run git worktree remove --force ${preflight.beforeWorktree}. Change nothing else.`,
    { label: 'stop-before', phase: 'Address' },
  );
}

const shared = plan.delivery.mode === 'shared' && plan.delivery.branch;
if (shared) {
  const branch = await agent(
    `Make sure the branch ${shared} is on the remote. git fetch. If origin/${shared} exists, use it as it is. Otherwise run git push origin origin/${plan.defaultBranch}:refs/heads/${shared}. Change nothing else. You run in the user's own checkout, so leave its branch and working tree as they are. Return ready when origin/${shared} exists, or blocked with the reason.`,
    { label: 'shared-branch', phase: 'Plan', schema: BRANCH_SCHEMA },
  );
  if (!branch || branch.status !== 'ready') {
    const reason = (branch && branch.reason) || 'The shared-branch agent stopped';
    log(`Shared branch blocked: ${reason}`);
    await stopBefore();
    return { ci, delivery: plan.delivery, parent, results: [], sharedBranch: { reason, status: 'blocked' } };
  }
}
const root = shared || plan.defaultBranch;
log(`Delivery: ${plan.delivery.mode}${shared ? ` into ${shared}` : ''}. ${plan.delivery.reason}`);

const before = preflight && preflight.browser === 'ready' && preflight.beforeUrl;
const BROWSER_SETUP =
  preflight && preflight.browser === 'ready'
    ? `\nBrowser setup, checked at the start of this run:\n${preflight.notes}${before ? `\nThe before server at ${before} runs origin/${plan.defaultBranch} for the whole run. Take every before screenshot from it, and start no dev server or worktree for the before state. Its state is the default branch, so in a sub-issue that builds on another, name the predecessor's part of each difference.` : ''}`
    : '';
const PRESERVE = plan.preserve
  ? ` The spec is a refactor or a migration, so take the before screenshots from origin/${plan.defaultBranch}. Compare before and after for each existing screen that renders a changed part. Fix each difference that the spec does not name.`
  : '';
const CHECKS = `Test every change. Write automated tests where they fit, at the seams the parent spec names. When the change is visible in the app, also drive it in a real browser and check each acceptance criterion there.`;
const SCREENSHOTS = `When the UI changed, take before and after screenshots and attach them to the PR body, the way the project instructions say to attach images.`;
const BRANCH_NAME = `Name the branch for this sub-issue, in the repo's branch naming convention: follow the project instructions and the recent branches on the remote.`;
const OUTSIDE = `If the work needs a change outside this repo (a backend endpoint, an API spec, another service), do not make it. Return blocked, with what is missing.`;
const CI_LOCAL = ci
  ? ` Before you push, run locally each CI check that your change can break, apart from the type check. The CI checks, found at the start of this run:\n${ci.checks}`
  : '';
const BOT = {
  none: 'No review bot runs on this repo, so address the review comments that are there.',
  on_open: 'The review bot reviews a PR once, when it opens, so later pushes get no new bot review.',
  on_push:
    'The review bot reviews again after each push. After each push, wait for its new review and address it too, for at most 3 rounds in all. Return failed, with the open comments, when a fourth round would be needed.',
  on_request:
    'The review bot reviews only when asked. Do not wait for it, and do not ask it: the user decides when to spend a review.',
};
const CI_ADDRESS = ci
  ? `CI on this repo, found at the start of this run:\n${ci.checks}\nReview bot: ${BOT[ci.reviewBot] || BOT.on_open}${ci.reviewBotNotes ? ` ${ci.reviewBotNotes}` : ''}\nDo not wait for a human review: the user handles it.`
  : 'Wait for a review bot that posts comments too, if one runs. Do not wait for a human review: the user handles it.';
const TYPE_CHECK =
  ci && !ci.typeCheck
    ? 'The repo has no type check.'
    : `Run the type check${ci ? ` (${ci.typeCheck})` : ', if the repo has one,'} once, as the last check, after your last code change.`;
const OK = new Set(['ready', 'needs_person', 'landed']);

const { subIssues } = plan;
const byId = new Map(subIssues.map((s) => [s.id, s]));

const indegree = new Map(subIssues.map((s) => [s.id, 0]));
for (const s of subIssues) {
  s.predecessors = s.predecessors.filter((id) => byId.has(id) && id !== s.id);
  indegree.set(s.id, s.predecessors.length);
}
const queue = subIssues.filter((s) => indegree.get(s.id) === 0).map((s) => s.id);
const ordered = new Set();
while (queue.length > 0) {
  const id = queue.shift();
  ordered.add(id);
  for (const s of subIssues) {
    if (!s.predecessors.includes(id)) continue;
    indegree.set(s.id, indegree.get(s.id) - 1);
    if (indegree.get(s.id) === 0) queue.push(s.id);
  }
}
for (const s of subIssues) {
  if (ordered.has(s.id)) continue;
  s.skip = true;
  s.reason = 'It is in a dependency cycle, or waits on one';
  s.predecessors = [];
}
log(`${subIssues.length} open sub-issues, ${subIssues.filter((s) => s.skip).length} skipped`);

function label(s) {
  return `${s.id} ${s.title}`;
}

const SPEC = `The spec, from the description of the parent issue ${parent}:\n${plan.spec}`;

function describe(s) {
  return `The description of sub-issue ${label(s)}${s.url ? ` (${s.url})` : ''}:\n${s.description}`;
}

function brief(s) {
  return `${describe(s)}\n\n${SPEC}\n\nThe spec and the sub-issue are above, so read neither from the tracker.`;
}

function sharedBrief(slices) {
  return `${slices.map((s) => describe(s)).join('\n\n')}\n\n${SPEC}\n\nThe spec and the sub-issues are above, so read none of them from the tracker.`;
}

function startPrompt(s) {
  return `Implement sub-issue ${label(s)}. State its title before you start. ${TRACKER}
${WORKTREE}

${brief(s)}

1. Move the sub-issue to the in-progress stage, then read its stage back from the tracker. If it is not in progress, stop and return failed.`;
}

function build(where) {
  return `Build only what the sub-issue asks for. Before you write code, find how the repo already does the same kind of change, and follow that prior art. This includes the project instructions in each folder that you change, such as AGENTS.md or CLAUDE.md files nested in those folders. Where the spec's shape differs from it, follow the prior art and say so in ${where}. Write tests first at the seams the spec names. Run the single test files as you go, and the full suite once at the end. Leave the type check to the finish step.`;
}

function implementPrompt(s, bases) {
  const base = bases[0] || root;
  const merges = bases.slice(1);
  return `${startPrompt(s)}
2. git fetch, then create a branch from origin/${base}. ${BRANCH_NAME}${merges.length > 0 ? ` Merge ${merges.map((b) => `origin/${b}`).join(', ')} into it, because this sub-issue also builds on them.` : ''}
3. ${build('verified')}
4. ${CHECKS}${CI_LOCAL}${PRESERVE}${BROWSER_SETUP}
5. Commit in small logical steps and push the branch. Open no PR: the finish step opens it after the review, so that CI and any review bot see the finished code.
6. Leave the sub-issue in progress. The address step moves it once the PR is addressed.
7. Return pushed, with verified: each acceptance criterion with how you checked it (the test file, or the browser steps), and the screens that changed, for the PR's screenshots.

${OUTSIDE}`;
}

function slicePrompt(s) {
  return `${startPrompt(s)}
2. git fetch, then create a branch from origin/${shared}. ${BRANCH_NAME}
3. ${build('verified')}
4. ${CHECKS}${CI_LOCAL}${PRESERVE}${BROWSER_SETUP}
5. Commit in small logical steps. Do not push this branch, and open no PR: one PR takes the shared branch ${shared} to ${plan.defaultBranch} once every sub-issue has landed on it.
6. Land the sub-issue on the shared branch: git fetch, git merge origin/${shared}, and when the merge brought in changes, run the test files that cover the files that it touched. Then git push origin HEAD:${shared}. Other sub-issues land on it at the same time, so when the push is rejected, repeat this step.
7. Move the sub-issue to the stage that the project instructions give a sub-issue that lands on a shared branch, then read its stage back from the tracker and return it as stage. Without such an instruction, leave it in progress.
8. Return landed, with verified: each acceptance criterion with how you checked it (the test file, or the browser steps), and the screens that changed, for the PR's screenshots.

${OUTSIDE}`;
}

function reviewPrompt(t, lens) {
  return `Review branch ${t.branch} for ${t.name}. It has no PR yet.
${t.brief}

git fetch, then read the change with git diff origin/${t.base}...origin/${t.branch}, and any file at the branch with git show origin/${t.branch}:<path>. You run in the user's own checkout, so leave its branch and working tree as they are.
Report only the ${lens.key} problems: ${lens.focus}
Read only. Behaviour that the parent spec or ${t.issues} asks for is the target. A change to existing callers or screens that they do not name is a finding. Report a finding only when you can name the input or state that breaks, or the rule it breaks. Return an empty list when there is none.`;
}

function finishPrompt(t, findings) {
  return `Finish branch ${t.branch} for ${t.name}, then open its PR. ${TRACKER}
${WORKTREE}

${t.brief}

git fetch, then git switch --detach origin/${t.branch}. Another worktree may hold the branch, so push each commit with git push origin HEAD:${t.branch}.
${findings.length > 0 ? `Reviewers found these problems. Treat findings that name the same problem as one. Judge each against the parent spec and ${t.issues} first: a finding that would undo behaviour they ask for is rejected. A finding about a change that they do not name is not rejected on the grounds of the spec. Fix each remaining one that is real. Note in the PR body each one that you reject, with the reason:\n${JSON.stringify(findings, null, 2)}` : 'Reviewers found no problems.'}
The implementers verified the change like this:
${t.verified}
Re-verify only what your fixes change: run the test files that cover the files you changed. When a fix changes something visible, or the report leaves an acceptance criterion unchecked, check it under this rule: ${CHECKS}${BROWSER_SETUP}
Take the screenshots from the final code, for the screens that the implementers named and the ones your fixes change. ${SCREENSHOTS}${PRESERVE}
${TYPE_CHECK}${ci ? ` As your last checks, also run each other CI check that your fixes can break:\n${ci.checks}\n` : ' '}Fix what it finds, then push.
Then open the PR, as a draft or ready for review as the project instructions say, and ready for review when they say neither. A draft can hold back CI and a review bot until it is marked ready. ${t.open} Its body follows the repo's PR template, matches the final diff, and holds the test notes and screenshots.
Leave each issue in its stage. The address step moves it once the PR is addressed.
Return ready, with prUrl, when all of this passes. Return needs_person, with prUrl, when everything passes except checks that a person must set up first (test data the account lacks, an account setting, an action the permissions refuse), and name each open check and what it needs in reason. Return failed, with the reason, for anything else that does not pass, and open no PR.`;
}

function addressPrompt(t, prUrl, move) {
  return `Address PR ${prUrl} for ${t.name} on branch ${t.branch}. ${TRACKER}
${WORKTREE}

${t.brief}

git fetch, then git switch --detach origin/${t.branch}. Another worktree may hold the branch, so push each commit with git push origin HEAD:${t.branch}.
${CI_ADDRESS}
1. Wait until every CI check on the PR has finished, and the review bot's review if one runs. Use gh pr checks ${prUrl} --watch with the shell tool's timeout set to at most 10 minutes per call, and stop after 60 minutes in all. A check that is still pending then is a failure: return failed with its name.
2. Use the address-pr skill on the PR: fix each real review comment and failing check, and reply to each comment. Make every fix of the round before you push, then push once, since each push can restart CI, cancel runs still going, and start another bot review. Judge each comment against the parent spec and ${t.issues} first: a comment that would undo behaviour they ask for is rejected, with the reason in the reply. A comment about a change that they do not name is not rejected on the grounds of the spec. Do not wait for the checks after the push: the CI run it starts is the user's to follow.
3. When every comment has a fix or a reply and every failing check has a fix pushed, ${move ? `${t.move}, then read its stage back from the tracker and return it as stage` : 'leave each issue in its stage, since checks that need a person are still open'}, and return addressed. Return failed, with the reason, for a comment or a check that you could not fix.`;
}

async function review(t, key) {
  const reviews = await parallel(
    LENSES.map(
      (lens) => () =>
        agent(reviewPrompt(t, lens), {
          label: `review:${lens.key}:${key}`,
          phase: 'Review',
          schema: FINDINGS_SCHEMA,
        }),
    ),
  );
  const findings = reviews.filter(Boolean).flatMap((r) => r.findings);
  const done = { branch: t.branch, findings: findings.length };
  const finish = await agent(finishPrompt(t, findings), {
    isolation: 'worktree',
    label: `finish:${key}`,
    phase: 'Finish',
    schema: FINISH_SCHEMA,
  });
  if (!finish) return { ...done, reason: 'The finish agent stopped', status: 'failed' };
  return { ...done, ...finish };
}

async function address(t, key, done) {
  if (done.status !== 'ready' && done.status !== 'needs_person') return done;
  if (!done.prUrl) return { ...done, reason: 'The finish agent opened no PR', status: 'failed' };
  const addressed = await agent(addressPrompt(t, done.prUrl, done.status === 'ready'), {
    isolation: 'worktree',
    label: `address:${key}`,
    phase: 'Address',
    schema: ADDRESS_SCHEMA,
  });
  if (!addressed) return { ...done, reason: 'The address agent stopped', status: 'failed' };
  if (addressed.status === 'failed') return { ...done, reason: addressed.reason, status: 'failed' };
  return { ...done, stage: addressed.stage };
}

const runs = new Map();
const targets = new Map();

function run(s) {
  if (runs.has(s.id)) return runs.get(s.id);
  const result = (async () => {
    const summary = { id: s.id, title: s.title, url: s.url };
    if (s.skip) return { ...summary, reason: s.reason, status: 'skipped' };

    const done = await Promise.all(s.predecessors.map((id) => run(byId.get(id))));
    const waiting = done.filter((r) => !OK.has(r.status));
    if (waiting.length > 0) {
      return { ...summary, reason: `Waits on ${waiting.map((r) => r.id).join(', ')}`, status: 'blocked' };
    }

    if (shared) {
      const slice = await agent(slicePrompt(s), {
        isolation: 'worktree',
        label: `implement:${s.id}`,
        phase: 'Implement',
        schema: IMPLEMENT_SCHEMA,
      });
      if (!slice) return { ...summary, reason: 'The implement agent stopped', status: 'failed' };
      return { ...summary, ...slice };
    }

    const bases = done.map((r) => r.branch);
    const impl = await agent(implementPrompt(s, bases), {
      isolation: 'worktree',
      label: `implement:${s.id}`,
      phase: 'Implement',
      schema: IMPLEMENT_SCHEMA,
    });
    if (!impl) return { ...summary, reason: 'The implement agent stopped', status: 'failed' };
    if (impl.status !== 'pushed') return { ...summary, ...impl };

    const base = bases[0] || root;
    const t = {
      base,
      branch: impl.branch,
      brief: brief(s),
      issues: 'the sub-issue',
      move: 'move the sub-issue to the in-review stage',
      name: `sub-issue ${label(s)}`,
      open: `Open it with --head ${impl.branch} --base ${base}, and link the sub-issue the way the project instructions allow.`,
      verified: impl.verified || 'It reported nothing.',
    };
    targets.set(s.id, t);
    return { ...summary, ...(await review(t, s.id)) };
  })();
  runs.set(s.id, result);
  return result;
}

async function finishShared(results) {
  const landed = results.filter((r) => r.status === 'landed');
  if (landed.length === 0) return;
  const t = {
    base: plan.defaultBranch,
    branch: shared,
    brief: sharedBrief(landed.map((r) => byId.get(r.id))),
    issues: 'the sub-issues',
    move: `move the parent issue ${parent} to the in-review stage, and each sub-issue of the PR that is still in progress too`,
    name: `the sub-issues ${landed.map((r) => r.id).join(', ')} on the shared branch`,
    open: `If a PR from ${shared} to ${plan.defaultBranch} is open, use it and update its body. Otherwise open one with --head ${shared} --base ${plan.defaultBranch}. Link each sub-issue the way the project instructions allow.`,
    verified: landed.map((r) => `${r.id}: ${r.verified || 'It reported nothing.'}`).join('\n'),
  };
  return address(t, 'shared', await review(t, 'shared'));
}

let results;
let pr;
if (shared) {
  const landed = await Promise.all(subIssues.map((s) => run(s)));
  pr = await finishShared(landed);
  results = landed.map(({ verified: _verified, ...r }) => r);
} else {
  results = await Promise.all(
    subIssues.map(async (s) => {
      const done = await run(s);
      return targets.has(s.id) ? address(targets.get(s.id), s.id, done) : done;
    }),
  );
}

let preserveCheck;
if (plan.preserve && preflight && preflight.browser === 'ready') {
  const branches = (shared ? (pr && pr.prUrl ? [pr] : []) : results.filter((r) => OK.has(r.status) && r.branch)).map(
    (r) => `${r.branch} (${r.prUrl})`,
  );
  if (branches.length > 0) {
    preserveCheck = await agent(
      `The spec of ${parent} is a refactor or a migration: existing screens must look and behave as before.
${WORKTREE}

${SPEC}

git fetch, then create a local branch from origin/${plan.defaultBranch} and merge each of these PR branches into it as origin/<branch>. Never push that merge. Resolve a conflict in the way that keeps both changes.
${branches.join('\n')}
Compare each screen that the run touched with origin/${plan.defaultBranch} in a browser: start the app from the merge, and ${before ? `use the before server at ${before} for origin/${plan.defaultBranch}` : `once from origin/${plan.defaultBranch}`}. Return each difference that the spec does not name, with the PR that it comes from, in differences. Return an empty list when there is none.${BROWSER_SETUP}`,
      { isolation: 'worktree', label: 'preserve-check', phase: 'Finish', schema: PRESERVE_SCHEMA },
    );
  }
}
await stopBefore();
return { ci, delivery: plan.delivery, parent, pr, preserveCheck, results, sharedBranch: shared || undefined };
