/* eslint-disable import/no-relative-parent-imports -- tests live outside the skill folder */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answeredUrls,
  buildItems,
  hasSignal,
  linkedShas,
  parseJudgment,
  tally,
} from '../.claude/skills/update-address-pr/scripts/lib.ts';
import type { GqlComment, GqlPr } from '../.claude/skills/update-address-pr/scripts/lib.ts';

const ME = 'author';

function c(over: Partial<GqlComment> & { login: string; at: string }): GqlComment {
  const { login, at, ...rest } = over;
  return {
    // eslint-disable-next-line no-underscore-dangle -- GraphQL's field name
    author: { __typename: login.endsWith('[bot]') ? 'Bot' : 'User', login },
    body: '',
    createdAt: at,
    id: `${login}-${at}`,
    url: `https://github.com/o/r/pull/1#${login}-${at}`,
    ...rest,
  };
}

function pr(over: Partial<GqlPr> = {}): GqlPr {
  return {
    comments: { nodes: [] },
    commits: { nodes: [] },
    number: 1,
    reviewThreads: { nodes: [] },
    reviews: { nodes: [] },
    url: 'https://github.com/o/r/pull/1',
    ...over,
  };
}

function thread(comments: GqlComment[], path = 'a.ts') {
  return {
    comments: { nodes: comments, totalCount: comments.length },
    isOutdated: false,
    isResolved: true,
    line: 3,
    originalLine: 3,
    path,
  };
}

test('linkedShas reads commit links and dedupes to short shas', () => {
  const body =
    'Fixed in [abc1234](https://github.com/o/r/commit/abc1234def) and [x](https://github.com/o/r/commit/abc1234def)';
  assert.deepEqual(linkedShas(body), ['abc1234']);
});

test('answeredUrls reads each Re line of a grouped comment', () => {
  const body =
    '- Re [one](https://github.com/o/r/pull/1#issuecomment-1): fixed\n- Re [two](https://github.com/o/r/pull/1#pullrequestreview-2): declined\nnot a list line';
  assert.deepEqual(
    answeredUrls(body).map((a) => a.url),
    ['https://github.com/o/r/pull/1#issuecomment-1', 'https://github.com/o/r/pull/1#pullrequestreview-2'],
  );
});

test('a thread becomes an item only once the author answers it', () => {
  const bot = c({ at: '2026-01-01', body: 'finding', login: 'reviewer[bot]' });
  const answered = thread([
    bot,
    c({ at: '2026-01-02', body: 'Fixed in https://github.com/o/r/commit/1234567aa', login: ME }),
  ]);
  const unanswered = thread([c({ at: '2026-01-01', login: 'someone' })], 'b.ts');
  const items = buildItems(pr({ reviewThreads: { nodes: [answered, unanswered] } }), ME);
  assert.equal(items.length, 1);
  assert.equal(items[0].reviewerIsBot, true);
  assert.deepEqual(items[0].shas, ['1234567']);
});

test('later feedback on the same file after the answer is kept, earlier and other files are not', () => {
  const first = thread([c({ at: '2026-01-01', login: 'r' }), c({ at: '2026-01-02', login: ME })]);
  const before = thread([c({ at: '2026-01-01T12', body: 'before', login: 'r' })]);
  const after = thread([c({ at: '2026-01-03', body: 'same again', login: 'r' })]);
  const other = thread([c({ at: '2026-01-03', body: 'other', login: 'r' })], 'z.ts');
  const [item] = buildItems(pr({ reviewThreads: { nodes: [first, before, after, other] } }), ME);
  assert.equal(item.laterFeedback.length, 1);
  assert.match(item.laterFeedback[0], /same again/u);
  assert.equal(hasSignal(item), true);
});

test('a grouped comment answers review bodies and conversation comments', () => {
  const review = c({ at: '2026-01-01', body: 'review body', login: 'r' });
  const reply = c({ at: '2026-01-02', body: `- Re [x](${review.url}): fixed`, login: ME });
  const items = buildItems(pr({ comments: { nodes: [reply] }, reviews: { nodes: [review] } }), ME);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'review');
  assert.equal(hasSignal(items[0]), false);
});

test('parseJudgment rejects unknown values', () => {
  assert.equal(
    typeof parseJudgment('{"url":"u","outcome":"fixed","response":"nope","cause":"none","reason":""}'),
    'string',
  );
  assert.equal(typeof parseJudgment('not json'), 'string');
  const ok = parseJudgment('{"url":"u","outcome":"fixed","response":"reraised","cause":"reply","reason":"r"}');
  assert.equal(typeof ok, 'object');
});

test('tally groups causes by PR and reviewer and reports unjudged items', () => {
  const t1 = thread([
    c({ at: '2026-01-01', login: 'r1' }),
    c({ at: '2026-01-02', login: ME }),
    c({ at: '2026-01-03', login: 'r1' }),
  ]);
  const t2 = thread(
    [c({ at: '2026-01-01', login: 'r2' }), c({ at: '2026-01-02', login: ME }), c({ at: '2026-01-03', login: 'r2' })],
    'b.ts',
  );
  const items = [
    ...buildItems(pr({ reviewThreads: { nodes: [t1] } }), ME),
    ...buildItems(pr({ number: 2, reviewThreads: { nodes: [t2] } }), ME),
  ];
  const result = tally(items, [
    { cause: 'reply', outcome: 'declined', reason: 'x', response: 'pushback', url: items[0].url },
  ]);
  assert.deepEqual(result.missing, [items[1].url]);
  assert.equal(result.causes[0].cause, 'reply');
  assert.equal(result.causes[0].prs, 1);
  assert.equal(result.byOutcome.declined.pushback, 1);
});
