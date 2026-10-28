export const meta = {
  description: 'Implement every sub-issue of a parent issue as stacked PRs, in dependency order',
  name: 'ultra-implement',
  phases: [
    { detail: 'read the parent spec and order the sub-issues', title: 'Plan' },
    { detail: 'one agent per sub-issue, in its own worktree', title: 'Implement' },
    { detail: 'correctness, design and spec reviewers per PR', title: 'Review' },
    { detail: 'fix findings, test, screenshots, move the issue', title: 'Finish' },
    { detail: 'wait for CI and the CI review, then address the PR', title: 'Address' },
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
    prUrl: { type: 'string' },
    reason: { type: 'string' },
    status: { enum: ['pr_opened', 'blocked', 'failed'] },
    verified: { type: 'string' },
  },
  required: ['status'],
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
    reason: { type: 'string' },
    stage: { type: 'string' },
    status: { enum: ['ready', 'needs_person', 'failed'] },
  },
  required: ['status'],
  type: 'object',
};

const ADDRESS_SCHEMA = {
  properties: {
    reason: { type: 'string' },
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
      'Each acceptance criterion of the sub-issue and each rule of the parent spec that applies to it: met, missed, or done differently without a reason.',
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
- Format, lint and test with the repo's own package scripts, not npx or a formatter that the repo does not use.
- Bound each wait with the shell tool's timeout setting. There may be no timeout command, as on macOS. When a wait runs out, find out why.
Before you return, stop each dev server and browser session that you started.`;

phase('Plan');
const [plan, preflight] = await Promise.all([
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
  - shared: each sub-issue PR goes into one shared branch, and one PR takes that branch to the default branch. Pick it when the spec or the project instructions ask for one branch or one PR, or when a sub-issue alone leaves the default branch in a state that must not ship, such as a half-built feature with no flag, or a consumer that breaks until a later sub-issue lands. Give branch a short name for the whole change. A branch of that name that is already on the remote is the shared branch.
  - separate: each sub-issue PR goes to the default branch, or to the branch of its predecessor. Pick it when each sub-issue can ship alone.`,
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
]);
if (!plan) throw new Error('The plan agent stopped');
if (preflight && preflight.browser === 'blocked') {
  log(`Browser preflight blocked: ${preflight.reason}`);
  return { parent, preflight, results: [] };
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
    return { delivery: plan.delivery, parent, results: [], sharedBranch: { reason, status: 'blocked' } };
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
const TESTING = `Test every change. Write automated tests where they fit, at the seams the parent spec names. When the change is visible in the app, also drive it in a real browser and check each acceptance criterion there. When the UI changed, take before and after screenshots and attach them to the PR body, the way the project instructions say to attach images.${PRESERVE}${BROWSER_SETUP}`;

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

function brief(s) {
  return `The description of sub-issue ${label(s)}${s.url ? ` (${s.url})` : ''}:\n${s.description}\n\n${SPEC}\n\nThe spec and the sub-issue are above, so read neither from the tracker.`;
}

function implementPrompt(s, bases) {
  const base = bases[0] || root;
  const merges = bases.slice(1);
  return `Implement sub-issue ${label(s)}. State its title before you start. ${TRACKER}
${WORKTREE}

${brief(s)}

1. Move the sub-issue to the in-progress stage, then read its stage back from the tracker. If it is not in progress, stop and return failed.
2. git fetch, then create branch from origin/${base}.${merges.length > 0 ? ` Merge ${merges.map((b) => `origin/${b}`).join(', ')} into it, because this sub-issue also builds on them.` : ''}
3. Build only what the sub-issue asks for. Before you write code, find how the repo already does the same kind of change, and follow that prior art. This includes the project instructions in each folder that you change, such as AGENTS.md or CLAUDE.md files nested in those folders. Where the spec's shape differs from it, follow the prior art and say so in the PR. Write tests first at the seams the spec names. Run the single test files as you go, and the full suite once at the end. Leave the type check to the finish step.
4. ${TESTING}
5. Commit in small logical steps and push.
6. Open a PR with --base ${base} that follows the repo's PR template and links the sub-issue the way the project instructions allow.${shared ? ` The PR is one slice of the change on the shared branch ${shared}: say so in the PR body.` : ''}
7. Leave the sub-issue in progress, even where the project instructions move it when a PR opens. The finish step moves it after the review.
8. Return verified: each acceptance criterion with how you checked it (the test file, or the browser steps), and the screenshots in the PR body.

If the work needs a change outside this repo (a backend endpoint, an API spec, another service), do not make it. Return blocked, with what is missing.`;
}

function reviewPrompt(s, impl, base, lens) {
  return `Review PR ${impl.prUrl} for sub-issue ${label(s)}.
${brief(s)}

git fetch, then read the change with git diff origin/${base}...origin/${impl.branch}, and any file at the branch with git show origin/${impl.branch}:<path>. You run in the user's own checkout, so leave its branch and working tree as they are.
Report only the ${lens.key} problems: ${lens.focus}
Read only. Behaviour that the parent spec or the sub-issue asks for is the target. A change to existing callers or screens that they do not name is a finding. Report a finding only when you can name the input or state that breaks, or the rule it breaks. Return an empty list when there is none.`;
}

function finishPrompt(s, impl, findings) {
  return `Finish PR ${impl.prUrl} for sub-issue ${label(s)} on branch ${impl.branch}. ${TRACKER}
${WORKTREE}

${brief(s)}

git fetch, then git switch --detach origin/${impl.branch}. The branch itself stays checked out in the implementer's worktree, so push each commit with git push origin HEAD:${impl.branch}.
${findings.length > 0 ? `Reviewers found these problems. Treat findings that name the same problem as one. Judge each against the parent spec and the sub-issue first: a finding that would undo behaviour they ask for is rejected. A finding about a change that they do not name is not rejected on the grounds of the spec. Fix each remaining one that is real. Note in the PR each one that you reject, with the reason:\n${JSON.stringify(findings, null, 2)}` : 'Reviewers found no problems.'}
The implementer verified the PR like this:
${impl.verified || 'It reported nothing.'}
Re-verify only what your fixes change: run the test files that cover the files you changed. When a fix changes something visible, or the report leaves an acceptance criterion unchecked, check it under this rule, and replace only the screenshots it affects: ${TESTING}
Update the PR body so it matches the final diff and holds the test notes and screenshots.
Run the type check once, as the last check, after your last code change. Fix what it finds, then push.
Move the sub-issue to the in-review stage only when all of this passes, then read its stage back from the tracker and return that as stage.
Return needs_person when everything passes except checks that a person must set up first (test data the account lacks, an account setting, an action the permissions refuse). Leave the sub-issue in progress, and name each open check and what it needs in reason. Return failed, with the reason, for anything else that does not pass.`;
}

function addressPrompt(s, impl) {
  return `Address PR ${impl.prUrl} for sub-issue ${label(s)} on branch ${impl.branch}.
${WORKTREE}

${brief(s)}

git fetch, then git switch --detach origin/${impl.branch}. The branch itself stays checked out in the implementer's worktree, so push each commit with git push origin HEAD:${impl.branch}.
1. Wait until every CI check on the PR has finished, including a review bot that posts comments. Use gh pr checks ${impl.prUrl} --watch with the shell tool's timeout set to at most 10 minutes per call, and stop after 60 minutes in all. A check that is still pending then is a failure: return failed with its name.
2. Use the address-pr skill on the PR: fix each real review comment and failing check, reply to each comment, and push. Judge each comment against the parent spec and the sub-issue first: a comment that would undo behaviour they ask for is rejected, with the reason in the reply. A comment about a change that they do not name is not rejected on the grounds of the spec.
3. After the last push, wait for the checks again the same way. Return addressed when they pass and no comment is open. Leave the sub-issue in its current stage. Return failed, with the reason, for anything that stays open.`;
}

const runs = new Map();

function run(s) {
  if (runs.has(s.id)) return runs.get(s.id);
  const result = (async () => {
    const summary = { id: s.id, title: s.title, url: s.url };
    if (s.skip) return { ...summary, reason: s.reason, status: 'skipped' };

    const before = await Promise.all(s.predecessors.map((id) => run(byId.get(id))));
    const waiting = before.filter((r) => r.status !== 'ready' && r.status !== 'needs_person');
    if (waiting.length > 0) {
      return { ...summary, reason: `Waits on ${waiting.map((r) => r.id).join(', ')}`, status: 'blocked' };
    }

    const bases = before.map((r) => r.branch);
    const base = bases[0] || root;
    const impl = await agent(implementPrompt(s, bases), {
      isolation: 'worktree',
      label: `implement:${s.id}`,
      phase: 'Implement',
      schema: IMPLEMENT_SCHEMA,
    });
    if (!impl) return { ...summary, reason: 'The implement agent stopped', status: 'failed' };
    if (impl.status !== 'pr_opened') return { ...summary, ...impl };

    const reviews = await parallel(
      LENSES.map(
        (lens) => () =>
          agent(reviewPrompt(s, impl, base, lens), {
            label: `review:${lens.key}:${s.id}`,
            phase: 'Review',
            schema: FINDINGS_SCHEMA,
          }),
      ),
    );
    const findings = reviews.filter(Boolean).flatMap((r) => r.findings);

    const finish = await agent(finishPrompt(s, impl, findings), {
      isolation: 'worktree',
      label: `finish:${s.id}`,
      phase: 'Finish',
      schema: FINISH_SCHEMA,
    });
    if (!finish)
      return {
        ...summary,
        branch: impl.branch,
        prUrl: impl.prUrl,
        reason: 'The finish agent stopped',
        status: 'failed',
      };
    const done = { ...summary, branch: impl.branch, findings: findings.length, prUrl: impl.prUrl, ...finish };
    if (finish.status === 'failed') return done;

    const address = await agent(addressPrompt(s, impl), {
      isolation: 'worktree',
      label: `address:${s.id}`,
      phase: 'Address',
      schema: ADDRESS_SCHEMA,
    });
    if (!address) return { ...done, reason: 'The address agent stopped', status: 'failed' };
    if (address.status === 'failed') return { ...done, reason: address.reason, status: 'failed' };
    return done;
  })();
  runs.set(s.id, result);
  return result;
}

const results = await Promise.all(subIssues.map(run));

let preserveCheck;
if (plan.preserve && preflight && preflight.browser === 'ready') {
  const branches = results
    .filter((r) => (r.status === 'ready' || r.status === 'needs_person') && r.branch)
    .map((r) => `${r.branch} (${r.prUrl})`);
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
return { delivery: plan.delivery, parent, preserveCheck, results, sharedBranch: shared || undefined };
