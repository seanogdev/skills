/* eslint-disable import/no-relative-parent-imports -- tests live outside the skill folder */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actionCalls,
  chunk,
  parseArgs,
  renderTable,
  reviewArgs,
  scoreRisk,
  selectionCalls,
  sortPrs,
  validateAssessments,
  validateDecisions,
} from '../skills/approve-prs/scripts/lib.ts';
import type { Assessment, Pr } from '../skills/approve-prs/scripts/types.ts';

function pr(number: number, over: Partial<Pr> = {}): Pr {
  const repo = over.repo ?? 'acme/web';
  return {
    additions: 10,
    author: 'someone',
    baseRisk: 3,
    body: '',
    deletions: 2,
    files: ['src/a.ts'],
    id: `${repo}#${number}`,
    isDraft: false,
    isOwn: false,
    number,
    repo,
    signals: [],
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    ...over,
  };
}

function ok(summary = 'Fix thing', risk = 3): Assessment {
  return { reason: 'because', risk, summary };
}

test('scoreRisk rates docs and tests only as 1', () => {
  assert.equal(scoreRisk(['README.md', 'docs/x.md'], 400, 0).risk, 1);
  assert.equal(scoreRisk(['README.md', 'src/a.test.ts'], 400, 0).risk, 1);
});

test('scoreRisk scales with size and adds one for missing tests', () => {
  assert.equal(scoreRisk(['src/a.ts', 'src/a.test.ts'], 30, 10).risk, 2);
  assert.equal(scoreRisk(['src/a.ts'], 30, 10).risk, 3);
  assert.equal(scoreRisk(['src/a.ts', 'tests/a.ts'], 300, 0).risk, 3);
  assert.equal(scoreRisk(['src/a.ts', 'tests/a.ts'], 900, 0).risk, 4);
});

test('scoreRisk raises sensitive, dependency and infra paths', () => {
  assert.equal(scoreRisk(['src/auth/login.ts', 'src/auth/login.test.ts'], 5, 0).risk, 4);
  assert.equal(scoreRisk(['db/migrations/001.sql', 'tests/m.ts'], 5, 0).risk, 4);
  assert.equal(scoreRisk(['pnpm-lock.yaml', 'package.json'], 5, 5).risk, 4);
  assert.equal(scoreRisk(['.github/workflows/ci.yml'], 2, 1).risk, 5);
  assert.ok(scoreRisk(['Dockerfile'], 1, 1).signals.some((s) => s.startsWith('infra')));
});

test('parseArgs reads an optional user and repo', () => {
  assert.deepEqual(parseArgs([]), { repo: undefined, user: undefined });
  assert.deepEqual(parseArgs(['@octocat']), { repo: undefined, user: 'octocat' });
  assert.deepEqual(parseArgs(['octocat', 'acme/web']), { repo: 'acme/web', user: 'octocat' });
  assert.throws(() => parseArgs(['octocat', 'nope']));
  assert.throws(() => parseArgs(['a', 'b/c', 'd']));
});

test('validateAssessments enforces summary length, risk range and base distance', () => {
  const prs = [pr(1, { baseRisk: 2 })];
  assert.deepEqual(validateAssessments(prs, { 'acme/web#1': ok('Exactly twenty chars', 3) }), []);
  const errors = validateAssessments(prs, {
    'acme/web#1': { reason: ' ', risk: 5, summary: 'This is twenty-one ch' },
    'acme/web#9': ok(),
  });
  assert.equal(errors.length, 4);
  assert.match(validateAssessments(prs, {})[0], /no assessment/u);
  assert.match(validateAssessments(prs, { 'acme/web#1': ok('x', 2.5) })[0], /integer/u);
});

test('chunk never leaves a single item when it can rebalance', () => {
  assert.deepEqual(
    chunk([1, 2, 3, 4, 5], 4).map((g) => g.length),
    [3, 2],
  );
  assert.deepEqual(
    chunk([1, 2, 3, 4, 5, 6, 7, 8], 4).map((g) => g.length),
    [4, 4],
  );
  assert.deepEqual(chunk([1], 4), [[1]]);
});

test('selectionCalls groups PRs into valid AskUserQuestion calls', () => {
  const prs = Array.from({ length: 17 }, (_, i) => pr(i + 1));
  const a = Object.fromEntries(prs.map((p) => [p.id, ok(`S${p.number}`)]));
  const calls = selectionCalls(prs, a);
  const questions = calls.flat();
  assert.ok(calls.every((c) => c.length <= 4));
  assert.ok(questions.every((q) => q.options.length >= 2 && q.options.length <= 4 && q.multiSelect));
  assert.equal(questions.flatMap((q) => q.options).length, 17);
  assert.equal(questions.at(-1)!.header, 'PRs 16-17');
  assert.equal(questions[0].options[0].label, '#1 S1');
  assert.deepEqual(selectionCalls([prs[0]], a), []);
});

test('labels disambiguate the same number across repos', () => {
  const prs = [pr(5), pr(5, { repo: 'acme/api' })];
  const a = { 'acme/api#5': ok('Two'), 'acme/web#5': ok('One') };
  const labels = selectionCalls(prs, a)[0][0].options.map((o) => o.label);
  assert.deepEqual(labels, ['web#5 One', 'api#5 Two']);
});

test('actionCalls offers approval only on other people’s PRs', () => {
  const prs = [pr(1), pr(2, { isOwn: true })];
  const a = { 'acme/web#1': ok('One'), 'acme/web#2': ok('Two') };
  const [call] = actionCalls(prs, a, ['#1 One', 'acme/web#2']);
  assert.deepEqual(
    call[0].options.map((o) => o.label),
    ['Approve', 'Approve with comment', 'Comment only'],
  );
  assert.deepEqual(
    call[1].options.map((o) => o.label),
    ['Comment only', 'Skip'],
  );
  assert.throws(() => actionCalls(prs, a, ['#3 Nope']));
});

test('a lone PR gets a Skip option instead of a selection question', () => {
  const [call] = actionCalls([pr(1)], { 'acme/web#1': ok('One') }, ['acme/web#1']);
  assert.equal(call[0].options.at(-1)!.label, 'Skip');
});

test('renderTable sorts by risk and escapes pipes', () => {
  const prs = [pr(1, { isDraft: true, title: 'a | b' }), pr(2)];
  const a = { 'acme/web#1': ok('One', 4), 'acme/web#2': ok('Two', 2) };
  const table = renderTable(sortPrs(prs, a), a).split('\n');
  assert.match(table[2], /#2/u);
  assert.match(table[3], /\[draft\] a \\\| b/u);
});

test('validateDecisions blocks bad decisions before anything posts', () => {
  const prs = [pr(1), pr(2, { isOwn: true })];
  assert.deepEqual(validateDecisions(prs, [{ action: 'approve', id: 'acme/web#1' }]), []);
  assert.equal(
    validateDecisions(prs, [
      { action: 'comment', id: 'acme/web#1' },
      { action: 'approve', id: 'acme/web#2' },
      { action: 'approve', id: 'acme/web#3' },
    ]).length,
    3,
  );
});

test('reviewArgs reads the body from stdin only when there is one', () => {
  assert.deepEqual(reviewArgs(pr(1), { action: 'approve', id: 'acme/web#1' }), [
    'pr',
    'review',
    '1',
    '-R',
    'acme/web',
    '--approve',
  ]);
  assert.deepEqual(reviewArgs(pr(1), { action: 'comment', body: 'hi', id: 'acme/web#1' }).slice(-3), [
    '--comment',
    '--body-file',
    '-',
  ]);
});
