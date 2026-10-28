import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface SubIssue {
  description: string;
  id: string;
  title: string;
  predecessors: string[];
  skip: boolean;
  reason?: string;
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
  result: { results: Summary[] };
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
    description: `DESCRIPTION ${id}`,
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
  if (step === 'implement')
    return { branch: `branch-${id}`, prUrl: `pr-${id}`, status: 'pr_opened', verified: `VERIFIED ${id}` };
  if (step === 'review') return { findings: [] };
  return { stage: 'In review', status: 'ready' };
}

async function parallel(fns: (() => Promise<unknown>)[]) {
  return Promise.all(fns.map(async (fn) => fn()));
}

async function runWorkflow(
  subIssues: SubIssue[],
  options: { preflight?: Reply; reply?: (label: string) => Reply | undefined } = {},
): Promise<Run> {
  const calls: Call[] = [];
  async function agent(prompt: string, opts: { label: string }) {
    calls.push({ label: opts.label, prompt });
    await Promise.resolve();
    if (opts.label === 'plan')
      return {
        defaultBranch: 'main',
        delivery: { mode: 'separate', reason: 'test' },
        preserve: false,
        spec: 'PARENT SPEC',
        subIssues,
      };
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
  assert.equal(order.length, 11);
  assert.match(promptFor(run, 'implement:A'), /origin\/main/u);
  assert.match(promptFor(run, 'implement:B'), /--base branch-A/u);
  assert.match(promptFor(run, 'implement:C'), /--base branch-B/u);
});

test('starts siblings together once their shared predecessor is ready', async () => {
  const run = await runWorkflow([issue('A'), issue('B', ['A']), issue('C', ['A'])]);
  const order = labels(run);
  assert.ok(order.indexOf('implement:C') < order.indexOf('finish:B'));
});

test('merges every extra predecessor into a sub-issue with several', async () => {
  const run = await runWorkflow([issue('A'), issue('B'), issue('C', ['A', 'B'])]);
  assert.match(promptFor(run, 'implement:C'), /--base branch-A/u);
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
  assert.deepEqual(labels(run), ['plan', 'preflight']);
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
    reply: (label) => (label === 'finish:A' ? { reason: 'no archived project', status: 'needs_person' } : undefined),
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
  assert.deepEqual(labels(run), ['plan', 'preflight']);
});

test('gives the preflight notes to the implementer and the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'implement:A'), /PREFLIGHT NOTES/u);
  assert.match(promptFor(run, 'finish:A'), /PREFLIGHT NOTES/u);
});

test('leaves the preflight notes out when no browser check is needed', async () => {
  const run = await runWorkflow([issue('A')], { preflight: { browser: 'not_needed', notes: 'PREFLIGHT NOTES' } });
  assert.doesNotMatch(promptFor(run, 'implement:A'), /PREFLIGHT NOTES/u);
});

test('gives the spec and the sub-issue description to every agent after the plan', async () => {
  const run = await runWorkflow([issue('A')]);
  for (const call of run.calls.filter((c) => !['plan', 'preflight'].includes(c.label))) {
    assert.match(call.prompt, /PARENT SPEC/u, call.label);
    assert.match(call.prompt, /DESCRIPTION A/u, call.label);
  }
});

test('gives the verification of the implementer to the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.match(promptFor(run, 'finish:A'), /VERIFIED A/u);
});

test('leaves the type check to the finisher', async () => {
  const run = await runWorkflow([issue('A')]);
  assert.doesNotMatch(promptFor(run, 'implement:A'), /Run the type check/u);
  assert.match(promptFor(run, 'finish:A'), /Run the type check once, as the last check/u);
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
