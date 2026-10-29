import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface SubIssue {
  criteria: string[];
  id: string;
  title: string;
  predecessors: string[];
  skip: boolean;
  reason?: string;
  visible?: boolean;
}

interface Call {
  label: string;
  prompt: string;
}

interface Summary {
  id: string;
  status: string;
  reason?: string;
}

interface Run {
  calls: Call[];
  result: { pr?: Summary & { prUrl?: string; stage?: string }; results: Summary[] };
}

type Reply = Record<string, unknown> | null;

const source = readFileSync(new URL('../skills/ultra-implement/workflow.js', import.meta.url), 'utf8').replace(
  /^export const meta/mu,
  'const meta',
);
const { constructor: AsyncFunction } = Object.getPrototypeOf(async () => {}) as {
  constructor: new (...params: string[]) => (...args: unknown[]) => Promise<unknown>;
};
const script = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source);

function issue(id: string, predecessors: string[] = [], skip = false): SubIssue {
  return {
    criteria: [`CRITERION ${id}`],
    id,
    predecessors,
    skip,
    title: `title ${id}`,
    ...(skip ? { reason: 'needs a release' } : {}),
  };
}

function defaultReply(label: string): Reply {
  const parts = label.split(':');
  const [step] = parts;
  const id = parts.at(-1);
  if (step === 'implement' && id?.startsWith('S'))
    return { branch: `branch-${id}`, stage: 'Complete', status: 'landed', verified: `VERIFIED ${id}` };
  if (step === 'implement') return { branch: `branch-${id}`, status: 'pushed', verified: `VERIFIED ${id}` };
  if (step === 'review') return { findings: [] };
  if (step === 'address') return { stage: 'In review', status: 'addressed' };
  if (step === 'finish') return { prUrl: `pr-${id}`, status: 'ready' };
  return { status: 'ready' };
}

async function parallel(fns: (() => Promise<unknown>)[]) {
  return Promise.all(fns.map(async (fn) => fn()));
}

async function runWorkflow(
  subIssues: SubIssue[],
  options: { ci?: Reply; delivery?: Reply; preflight?: Reply; reply?: (label: string) => Reply | undefined } = {},
): Promise<Run> {
  const calls: Call[] = [];
  async function agent(prompt: string, opts: { label: string }) {
    calls.push({ label: opts.label, prompt });
    await Promise.resolve();
    if (opts.label === 'plan')
      return {
        defaultBranch: 'main',
        delivery: options.delivery ?? { mode: 'separate', reason: 'test' },
        preserve: false,
        rules: ['RULE'],
        subIssues,
      };
    if (opts.label === 'ci')
      return options.ci === undefined
        ? { checks: 'CI CHECKS', humanReview: 'one approval', reviewBot: 'on_open', typeCheck: 'TYPECHECK CMD' }
        : options.ci;
    if (opts.label === 'preflight') return options.preflight ?? { browser: 'ready', notes: 'PREFLIGHT NOTES' };
    const reply = options.reply?.(opts.label);
    return reply === undefined ? defaultReply(opts.label) : reply;
  }
  const result = (await script(
    { parent: 'PARENT' },
    agent,
    parallel,
    () => {},
    () => {},
  )) as Run['result'];
  return { calls, result };
}

function statuses(run: Run) {
  return Object.fromEntries(run.result.results.map((r) => [r.id, r.status]));
}

function labels(run: Run) {
  return run.calls.map((c) => c.label).filter((l) => !l.startsWith('review:'));
}

function promptFor(run: Run, label: string) {
  const call = run.calls.find((c) => c.label === label);
  assert.ok(call, `no call labelled ${label}`);
  return call.prompt;
}

test('runs a chain in order and stacks each branch on its predecessor', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A']), issue('C', ['B'])]);
  assert.deepEqual(statuses(run), { A: 'ready', B: 'ready', C: 'ready' });
  const order = labels(run);
  for (const [first, then] of [
    ['implement:A', 'finish:A'],
    ['finish:A', 'implement:B'],
    ['finish:A', 'address:A'],
    ['implement:B', 'finish:B'],
    ['finish:B', 'implement:C'],
    ['finish:C', 'address:C'],
  ])
    assert.ok(order.indexOf(first) < order.indexOf(then), `${first} before ${then}`);
  assert.equal(order.length, 12);
  assert.match(promptFor(run, 'implement:A'), /origin\/main/u);
  assert.match(promptFor(run, 'implement:B'), /origin\/branch-A/u);
  assert.match(promptFor(run, 'finish:B'), /--base branch-A/u);
  assert.match(promptFor(run, 'finish:C'), /--base branch-B/u);
});

test('starts siblings together once their shared predecessor is ready', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A']), issue('C', ['A'])]);
  const order = labels(run);
  assert.ok(order.indexOf('implement:C') < order.indexOf('finish:B'));
});

test('merges every extra predecessor into a sub-issue with several', async () => {
  const run = await runWorkflow([issue('A'), issue('B'), issue('C', ['A', 'B'])]);
  assert.match(promptFor(run, 'implement:C'), /origin\/branch-A/u);
  assert.match(promptFor(run, 'implement:C'), /Merge origin\/branch-B/u);
});

test('runs three reviewers per PR', async () => {
  const run = await runWorkflow([issue('A')]);
  const reviews = run.calls.map((c) => c.label).filter((l) => l.startsWith('review:'));
  assert.deepEqual(reviews.toSorted(), ['review:correctness:A', 'review:design:A', 'review:spec:A']);
});

test('passes review findings to the finisher', async () => {
  const run = await runWorkflow([issue('A')], {
    reply: (label) =>
      label === 'review:design:A' ? { findings: [{ file: 'x.ts', problem: 'DUPLICATED STATE' }] } : undefined,
  });
  assert.match(promptFor(run, 'finish:A'), /DUPLICATED STATE/u);
});

test('skips a dependency cycle and the sub-issues after it', async () => {
  const run = await runWorkflow([issue('A', ['B']), issue('B', ['A']), issue('C', ['A'])]);
  assert.deepEqual(statuses(run), { A: 'skipped', B: 'skipped', C: 'skipped' });
  assert.deepEqual(labels(run), ['plan', 'preflight', 'ci']);
});

test('blocks the sub-issues after a skipped one', async () => {
  const run = await runWorkflow([issue('A', [], true), issue('B', ['A'])]);
  assert.deepEqual(statuses(run), { A: 'skipped', B: 'blocked' });
});

test('blocks the sub-issues after one that needs a change outside the repo', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A'])], {
    reply: (label) => (label === 'implement:A' ? { reason: 'no endpoint', status: 'blocked' } : undefined),
  });
  assert.deepEqual(statuses(run), { A: 'blocked', B: 'blocked' });
  assert.ok(!labels(run).includes('implement:B'));
});

test('blocks the sub-issues after a failed finish', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A'])], {
    reply: (label) => (label === 'finish:A' ? { reason: 'tests fail', status: 'failed' } : undefined),
  });
  assert.deepEqual(statuses(run), { A: 'failed', B: 'blocked' });
});

test('lets the sub-issues after one that needs a person run', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A'])], {
    reply: (label) =>
      label === 'finish:A' ? { prUrl: 'pr-A', reason: 'no archived project', status: 'needs_person' } : undefined,
  });
  assert.deepEqual(statuses(run), { A: 'needs_person', B: 'ready' });
});

test('fails a sub-issue whose agent stops', async () => {
  const run = await runWorkflow([issue('A'), issue('B')], {
    reply: (label) => (label === 'implement:A' ? null : undefined),
  });
  assert.deepEqual(statuses(run), { A: 'failed', B: 'ready' });
});

test('stops before any sub-issue when the browser preflight is blocked', async () => {
  const run = await runWorkflow([issue('A')], {
    preflight: { browser: 'blocked', notes: '', reason: 'login expired' },
  });
  assert.deepEqual(run.result.results, []);
  assert.deepEqual(labels(run), ['plan', 'preflight', 'ci']);
});

test('gives the preflight notes to the implementer and the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'implement:A'), /PREFLIGHT NOTES/u);
  assert.match(promptFor(run, 'finish:A'), /PREFLIGHT NOTES/u);
});

test('leaves the browser notes and screenshots out for a sub-issue that changes nothing visible', async () => {
  const run = await runWorkflow([{ ...issue('A'), visible: false }, issue('B')]);
  for (const label of ['implement:A', 'finish:A'])
    assert.doesNotMatch(promptFor(run, label), /PREFLIGHT NOTES|Take the screenshots/u, label);
  assert.match(promptFor(run, 'implement:B'), /PREFLIGHT NOTES/u);
  assert.match(promptFor(run, 'finish:B'), /PREFLIGHT NOTES[\s\S]*Take the screenshots/u);
});

test('leaves the preflight notes out when no browser check is needed', async () => {
  const run = await runWorkflow([issue('A')], { preflight: { browser: 'not_needed', notes: 'PREFLIGHT NOTES' } });
  assert.doesNotMatch(promptFor(run, 'implement:A'), /PREFLIGHT NOTES/u);
});

test('gives every agent after the plan the criteria and rules, and points it at the full spec', async () => {
  const run = await runWorkflow([issue('A')]);
  for (const call of run.calls.filter((c) => !['plan', 'preflight', 'ci'].includes(c.label))) {
    assert.match(call.prompt, /CRITERION A/u, call.label);
    assert.match(call.prompt, /- RULE/u, call.label);
    assert.match(call.prompt, /Read them only when the criteria and rules above leave a question open/u, call.label);
  }
});

test('has only the implementer and the spec reviewer read the sub-issue or the spec up front', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'implement:A'), /Read the sub-issue's description from the tracker/u);
  assert.match(promptFor(run, 'review:spec:A'), /Read the parent spec and the descriptions/u);
  for (const label of ['review:correctness:A', 'review:design:A', 'finish:A', 'address:A'])
    assert.doesNotMatch(promptFor(run, label), /Read the parent spec and the descriptions/u, label);
  assert.match(promptFor(run, 'preflight'), /not the parent's description/u);
});

test('points a sub-issue with no criteria at its description and the spec', async () => {
  const run = await runWorkflow([{ ...issue('A'), criteria: [] }]);
  assert.match(promptFor(run, 'finish:A'), /It has none, so read its description and the parent spec/u);
});

test('gives the verification of the implementer to the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'finish:A'), /VERIFIED A/u);
});

test('leaves the type check to the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.doesNotMatch(promptFor(run, 'implement:A'), /Run the type check/u);
  assert.match(promptFor(run, 'finish:A'), /Run the type check \(TYPECHECK CMD\) once, as the last check/u);
});

test('shares one before server across the run and stops it at the end', async () => {
  const run = await runWorkflow([issue('A')], {
    preflight: { beforePid: '42', beforeUrl: 'BEFORE URL', beforeWorktree: 'BEFORE PATH', browser: 'ready', notes: '' },
  });
  assert.match(promptFor(run, 'implement:A'), /BEFORE URL/u);
  assert.match(promptFor(run, 'finish:A'), /BEFORE URL/u);
  assert.equal(labels(run).at(-1), 'stop-before');
  assert.match(promptFor(run, 'stop-before'), /42[\s\S]*BEFORE PATH/u);
});

test('starts a successor before its predecessor is addressed', async () => {
  let addressedA = false;
  let finishedBWhileAddressingA = false;
  const run = await runWorkflow([issue('A'), issue('B', ['A'])], {
    reply: (label) => {
      if (label === 'finish:B') finishedBWhileAddressingA = !addressedA;
      if (label !== 'address:A') return;
      return new Promise((resolve) => {
        setTimeout(() => {
          addressedA = true;
          resolve({ status: 'addressed' });
        }, 10);
      }) as unknown as Reply;
    },
  });
  assert.ok(finishedBWhileAddressingA);
  assert.deepEqual(statuses(run), { A: 'ready', B: 'ready' });
});

test('fails a sub-issue whose address fails', async () => {
  const run = await runWorkflow([issue('A')], {
    reply: (label) => (label === 'address:A' ? { reason: 'CI red', status: 'failed' } : undefined),
  });
  assert.deepEqual(statuses(run), { A: 'failed' });
});

test('moves the sub-issue in the address step, not the finish step', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'finish:A'), /Leave each issue in its stage/u);
  assert.match(promptFor(run, 'address:A'), /move the sub-issue to the in-review stage/u);
  assert.equal((run.result.results[0] as Summary & { stage?: string }).stage, 'In review');
});

test('leaves a sub-issue that needs a person in progress after the address step', async () => {
  const run = await runWorkflow([issue('A')], {
    reply: (label) =>
      label === 'finish:A' ? { prUrl: 'pr-A', reason: 'no archived project', status: 'needs_person' } : undefined,
  });
  assert.match(promptFor(run, 'address:A'), /leave each issue in its stage/u);
});

const SHARED = { branch: 'checkout', mode: 'shared', reason: 'one thing' };

test('lands every slice on the shared branch and opens one PR for them', async () => {
  const run = await runWorkflow([issue('S1'), issue('S2', ['S1']), issue('S3')], { delivery: SHARED });
  assert.deepEqual(statuses(run), { S1: 'landed', S2: 'landed', S3: 'landed' });
  const order = labels(run);
  assert.deepEqual(
    order.filter((l) => l.startsWith('finish:') || l.startsWith('address:')),
    ['finish:shared', 'address:shared'],
  );
  assert.ok(order.indexOf('implement:S1') < order.indexOf('implement:S2'));
  assert.ok(order.indexOf('implement:S2') < order.indexOf('finish:shared'));
  assert.match(promptFor(run, 'implement:S2'), /origin\/checkout/u);
  assert.match(promptFor(run, 'implement:S2'), /open no PR/u);
  assert.deepEqual(run.result.pr, {
    branch: 'checkout',
    findings: 0,
    prUrl: 'pr-shared',
    stage: 'In review',
    status: 'ready',
  });
});

test('reviews the combined PR once with every slice in the brief', async () => {
  const run = await runWorkflow([issue('S1'), issue('S2')], { delivery: SHARED });
  const reviews = run.calls.map((c) => c.label).filter((l) => l.startsWith('review:'));
  assert.deepEqual(reviews.toSorted(), ['review:correctness:shared', 'review:design:shared', 'review:spec:shared']);
  for (const step of ['review:spec:shared', 'finish:shared', 'address:shared']) {
    assert.match(promptFor(run, step), /CRITERION S1[\s\S]*CRITERION S2/u, step);
    assert.match(promptFor(run, step), /origin\/checkout/u, step);
  }
  assert.match(promptFor(run, 'finish:shared'), /VERIFIED S1[\s\S]*VERIFIED S2/u);
  assert.match(promptFor(run, 'address:shared'), /move the parent issue PARENT to the in-review stage/u);
});

test('names the shared branch and each slice branch for what they hold', async () => {
  const run = await runWorkflow([issue('S1')], { delivery: SHARED });
  assert.match(promptFor(run, 'plan'), /not for its first sub-issue/u);
  assert.match(promptFor(run, 'implement:S1'), /Name the branch for this sub-issue/u);
});

test('leaves out a blocked slice and the slices after it from the combined PR', async () => {
  const run = await runWorkflow([issue('S1'), issue('S2', ['S1']), issue('S3')], {
    delivery: SHARED,
    reply: (label) => (label === 'implement:S1' ? { reason: 'no endpoint', status: 'blocked' } : undefined),
  });
  assert.deepEqual(statuses(run), { S1: 'blocked', S2: 'blocked', S3: 'landed' });
  assert.doesNotMatch(promptFor(run, 'finish:shared'), /CRITERION S1/u);
  assert.match(promptFor(run, 'finish:shared'), /CRITERION S3/u);
});

test('opens no PR when no slice lands', async () => {
  const run = await runWorkflow([issue('S1')], {
    delivery: SHARED,
    reply: (label) => (label === 'implement:S1' ? { reason: 'tests fail', status: 'failed' } : undefined),
  });
  assert.equal(run.result.pr, undefined);
  assert.ok(!labels(run).includes('finish:shared'));
});

test('opens the PR in the finish step, after the review', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'implement:A'), /Open no PR/u);
  assert.match(promptFor(run, 'review:spec:A'), /It has no PR yet/u);
  assert.match(promptFor(run, 'finish:A'), /Then open the PR, as a draft or ready/u);
  assert.match(promptFor(run, 'address:A'), /Address PR pr-A/u);
});

test('fails a sub-issue whose finisher opens no PR', async () => {
  const run = await runWorkflow([issue('A')], {
    reply: (label) => (label === 'finish:A' ? { status: 'ready' } : undefined),
  });
  assert.deepEqual(statuses(run), { A: 'failed' });
  assert.ok(!labels(run).includes('address:A'));
});

test('gives only the local check commands to the implementer, the finisher and the addresser', async () => {
  const run = await runWorkflow([issue('A')], {
    ci: {
      checks: 'CI CHECKS',
      humanReview: 'one approval',
      localChecks: 'LOCAL CMDS',
      reviewBot: 'on_push',
      reviewBotNotes: 'BOT NOTES',
      typeCheck: 'TYPECHECK CMD',
    },
  });
  assert.match(promptFor(run, 'implement:A'), /Before you push, run locally[\s\S]*LOCAL CMDS/u);
  assert.match(
    promptFor(run, 'finish:A'),
    /Run the type check \(TYPECHECK CMD\) once, as the last check[\s\S]*LOCAL CMDS/u,
  );
  for (const label of ['implement:A', 'finish:A', 'address:A'])
    assert.doesNotMatch(promptFor(run, label), /CI CHECKS/u, label);
  assert.match(promptFor(run, 'address:A'), /reproduce a failing one locally:\nLOCAL CMDS/u);
  assert.match(promptFor(run, 'address:A'), /reviews again after each push[\s\S]*BOT NOTES/u);
  assert.match(promptFor(run, 'address:A'), /Do not wait for a human review/u);
});

test('tells the addresser when no review bot runs', async () => {
  const run = await runWorkflow([issue('A')], { ci: { checks: 'CI CHECKS', humanReview: '', reviewBot: 'none' } });
  assert.match(promptFor(run, 'address:A'), /No review bot runs/u);
});

test('falls back to a generic CI brief when the CI agent stops', async () => {
  const run = await runWorkflow([issue('A')], { ci: null });
  assert.doesNotMatch(promptFor(run, 'implement:A'), /Before you push, run locally/u);
  assert.match(promptFor(run, 'address:A'), /Wait for a review bot that posts comments too/u);
});

test('pushes the address fixes once per round', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'address:A'), /Make every fix of the round before you push, then push once/u);
});

test('tells the finisher when the repo has no type check', async () => {
  const run = await runWorkflow([issue('A')], {
    ci: { checks: 'CI CHECKS', humanReview: '', reviewBot: 'none', typeCheck: '' },
  });
  assert.match(promptFor(run, 'finish:A'), /The repo has no type check/u);
});

test('tells the addresser not to wait for or ask a bot that reviews only on request', async () => {
  const run = await runWorkflow([issue('A')], {
    ci: { checks: 'CI CHECKS', humanReview: '', reviewBot: 'on_request' },
  });
  assert.match(promptFor(run, 'address:A'), /Do not wait for it, and do not ask it/u);
});

test('opens the PR as a draft or ready as the project instructions say', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'finish:A'), /as a draft or ready for review as the project instructions say/u);
});
