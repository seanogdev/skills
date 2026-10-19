export const meta = {
  description: 'Implement every sub-issue of a parent issue as stacked PRs, in dependency order',
  name: 'ultra-implement',
  phases: [
    { detail: 'read the parent spec and order the sub-issues', title: 'Plan' },
    { detail: 'one agent per sub-issue, in its own worktree', title: 'Implement' },
    { detail: 'correctness, design and spec reviewers per PR', title: 'Review' },
    { detail: 'fix findings, test, screenshots, move the issue', title: 'Finish' },
  ],
  whenToUse: 'Run through the ultra-implement skill with the parent issue as args',
};

const parent = typeof args === 'string' ? args : args && args.parent;
if (!parent) throw new Error('Pass the parent issue link or reference as args');

const PLAN_SCHEMA = {
  properties: {
    defaultBranch: { type: 'string' },
    subIssues: {
      items: {
        properties: {
          id: { type: 'string' },
          predecessors: { items: { type: 'string' }, type: 'array' },
          reason: { type: 'string' },
          skip: { type: 'boolean' },
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['id', 'title', 'predecessors', 'skip'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['defaultBranch', 'subIssues'],
  type: 'object',
};

const PREFLIGHT_SCHEMA = {
  properties: {
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

const LENSES = [
  {
    focus:
      'Logic bugs, regressions, security holes, type gaps, missing or weak tests, and breaks of the conventions in the project instructions.',
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

const TRACKER = `The parent issue is ${parent}. Read it, and its sub-issues, with the issue tracker tools that this session has (an MCP server or a CLI). Follow the tracker conventions in the project instructions, if any.`;

const WORKTREE = `You work in a fresh worktree: install the dependencies before the first build or test. Write files with the file tools, and run one plain command per shell call, since the worktree guard refuses heredocs, loops and shell variables. Give every wait a timeout, and when it runs out, find out why. Before you return, stop each dev server and browser session that you started.`;

phase('Plan');
const [plan, preflight] = await Promise.all([
  agent(
    `${TRACKER}
The parent's description is the spec for every sub-issue. Do not change anything.

Return:
- defaultBranch: the remote default branch (git symbolic-ref refs/remotes/origin/HEAD).
- subIssues: each sub-issue that is not done, with its id, title and url. predecessors lists the ids of the open sub-issues in this list that must be done first, from the tracker's dependency links. Drop links to done or outside issues.
- skip: true, with a reason, for a sub-issue that needs a person: a release, a product sign-off, or a decision that the spec leaves open.`,
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA },
  ),
  agent(
    `${TRACKER}
Find out how this repo's app is checked in a real browser, from the project instructions and the docs they point to. Change no code and no tracker item.
If no sub-issue changes something visible in the app, return not_needed.
Otherwise start the dev server from this checkout, open the app in a browser session of your own, and confirm that the saved login reaches the app. Find test data on this account that the sub-issues can use: ids that exist and hold the data they need. Then stop the dev server and close the session.
Return ready, with notes on how to start the dev server and find its port, how to log in, how to override feature flags, and the test data ids. Return blocked, with the reason, when the dev server or the login does not work.`,
    { label: 'preflight', phase: 'Plan', schema: PREFLIGHT_SCHEMA },
  ),
]);
if (!plan) throw new Error('The plan agent stopped');
if (preflight && preflight.browser === 'blocked') {
  log(`Browser preflight blocked: ${preflight.reason}`);
  return { parent, preflight, results: [] };
}

const BROWSER_SETUP =
  preflight && preflight.browser === 'ready'
    ? `\nBrowser setup, checked at the start of this run:\n${preflight.notes}`
    : '';
const TESTING = `Test every change. Write automated tests where they fit, at the seams the parent spec names. When the change is visible in the app, also drive it in a real browser and check each acceptance criterion there. When the UI changed, take before and after screenshots and attach them to the PR body, the way the project instructions say to attach images.${BROWSER_SETUP}`;

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

function implementPrompt(s, bases) {
  const base = bases[0] || plan.defaultBranch;
  const merges = bases.slice(1);
  return `${TRACKER}
Implement sub-issue ${label(s)}${s.url ? ` (${s.url})` : ''}. The parent's description is the spec. State the sub-issue title before you start.
${WORKTREE}

1. Move the sub-issue to the in-progress stage, then read its stage back from the tracker. If it is not in progress, stop and return failed.
2. git fetch, then create branch from origin/${base}.${merges.length > 0 ? ` Merge ${merges.map((b) => `origin/${b}`).join(', ')} into it, because this sub-issue also builds on them.` : ''}
3. Build only what the sub-issue asks for. Before you write code, find how the repo already does the same kind of change, and follow that prior art. Where the spec's shape differs from it, follow the prior art and say so in the PR. Write tests first at the seams the spec names. Run the type check and the single test files as you go, and the full suite once at the end.
4. ${TESTING}
5. Commit in small logical steps and push.
6. Open a PR with --base ${base} that follows the repo's PR template and links the sub-issue the way the project instructions allow.
7. Leave the sub-issue in progress, even where the project instructions move it when a PR opens. The finish step moves it after the review.

If the work needs a change outside this repo (a backend endpoint, an API spec, another service), do not make it. Return blocked, with what is missing.`;
}

function reviewPrompt(s, impl, base, lens) {
  return `Review PR ${impl.prUrl} for sub-issue ${label(s)}. ${TRACKER}
git fetch, then read the change with git diff origin/${base}...origin/${impl.branch}, and any file at the branch with git show origin/${impl.branch}:<path>. You run in the user's own checkout, so leave its branch and working tree as they are.
Report only the ${lens.key} problems: ${lens.focus}
Read only. Behaviour that the parent spec or the sub-issue asks for is the target, even when it changes what existing callers see. Report a finding only when you can name the input or state that breaks, or the rule it breaks. Return an empty list when there is none.`;
}

function finishPrompt(s, impl, findings) {
  return `Finish PR ${impl.prUrl} for sub-issue ${label(s)} on branch ${impl.branch}. ${TRACKER}
${WORKTREE}
git fetch, then git switch --detach origin/${impl.branch}. The branch itself stays checked out in the implementer's worktree, so push each commit with git push origin HEAD:${impl.branch}.
${findings.length > 0 ? `Reviewers found these problems. Treat findings that name the same problem as one. Judge each against the parent spec and the sub-issue first: a finding that would undo behaviour they ask for is rejected. Fix each remaining one that is real. Note in the PR each one that you reject, with the reason:\n${JSON.stringify(findings, null, 2)}` : 'Reviewers found no problems.'}
Then make sure the PR meets this rule: ${TESTING}
Run the type check and the full test suite. Push. Update the PR body so it matches the final diff and holds the test notes and screenshots.
Move the sub-issue to the in-review stage only when all of this passes, then read its stage back from the tracker and return that as stage.
Return needs_person when everything passes except checks that a person must set up first (test data the account lacks, an account setting, an action the permissions refuse). Leave the sub-issue in progress, and name each open check and what it needs in reason. Return failed, with the reason, for anything else that does not pass.`;
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
    const base = bases[0] || plan.defaultBranch;
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
    return { ...summary, branch: impl.branch, findings: findings.length, prUrl: impl.prUrl, ...finish };
  })();
  runs.set(s.id, result);
  return result;
}

const results = await Promise.all(subIssues.map(run));
return { parent, results };
