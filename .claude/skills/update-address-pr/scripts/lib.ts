export interface Author {
  login: string;
  // eslint-disable-next-line no-underscore-dangle -- GraphQL's field name
  __typename: string;
}

export interface GqlComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  author: Author | null;
  isMinimized?: boolean;
  reactionGroups?: { content: string; viewerHasReacted: boolean }[];
}

export interface GqlPr {
  number: number;
  url: string;
  commits: { nodes: { commit: { oid: string; messageHeadline: string; committedDate: string } }[] };
  reviewThreads: {
    nodes: {
      isResolved: boolean;
      isOutdated: boolean;
      path: string;
      line: number | null;
      originalLine: number | null;
      comments: { totalCount: number; nodes: GqlComment[] };
    }[];
  };
  reviews: { nodes: GqlComment[] };
  comments: { nodes: GqlComment[] };
}

export interface Note {
  author: string;
  isMe: boolean;
  isBot: boolean;
  body: string;
  createdAt: string;
}

export interface Item {
  kind: 'thread' | 'review' | 'conversation';
  pr: number;
  url: string;
  path?: string;
  line?: number;
  reviewer: string;
  reviewerIsBot: boolean;
  feedback: string;
  answers: Note[];
  after: Note[];
  closed: boolean;
  outdated: boolean;
  vote?: string;
  shas: string[];
  laterCommits: string[];
  laterFeedback: string[];
}

export const OUTCOMES = ['fixed', 'declined', 'out-of-scope', 'asked', 'outdated', 'none'] as const;
export const RESPONSES = ['accepted', 'pushback', 'reraised', 'reverted', 'silent'] as const;
export const CAUSES = ['decide', 'fix', 'reply', 'process', 'reviewer', 'none'] as const;

export interface Judgment {
  url: string;
  outcome: (typeof OUTCOMES)[number];
  response: (typeof RESPONSES)[number];
  cause: (typeof CAUSES)[number];
  reason: string;
}

const SHA = /\/commit\/([0-9a-f]{7,40})/giu;
const RE_LINK = /^\s*[-*]\s*Re \[[^\]]*\]\((https:\/\/github\.com\/[^)\s]+)\)/gimu;

export function linkedShas(body: string): string[] {
  return [...new Set([...body.matchAll(SHA)].map((m) => m[1].slice(0, 7)))];
}

export function answeredUrls(body: string): { url: string; line: string }[] {
  return body
    .split('\n')
    .flatMap((line) => [...`${line}\n`.matchAll(RE_LINK)].map((m) => ({ line: line.trim(), url: m[1] })));
}

function isBot(c: GqlComment): boolean {
  // eslint-disable-next-line no-underscore-dangle -- GraphQL's field name
  return c.author?.__typename === 'Bot';
}

function note(c: GqlComment, me: string): Note {
  const author = c.author?.login ?? '';
  return { author, body: c.body, createdAt: c.createdAt, isBot: isBot(c), isMe: author === me && !isBot(c) };
}

function vote(c: GqlComment): string | undefined {
  return c.reactionGroups?.find((g) => g.viewerHasReacted && g.content.startsWith('THUMBS_'))?.content;
}

function laterCommits(pr: GqlPr, since: string): string[] {
  return pr.commits.nodes
    .filter((n) => n.commit.committedDate > since)
    .map((n) => `${n.commit.oid.slice(0, 7)} ${n.commit.messageHeadline}`);
}

function firstLine(body: string): string {
  return body.trim().split('\n')[0]?.slice(0, 200) ?? '';
}

type Thread = GqlPr['reviewThreads']['nodes'][number];

function threadItem(pr: GqlPr, t: Thread, me: string): Item[] {
  const [first, ...rest] = t.comments.nodes;
  if (!first || first.author?.login === me) return [];
  const notes = rest.map((c) => note(c, me));
  const firstAnswer = notes.findIndex((n) => n.isMe);
  if (firstAnswer === -1) return [];
  const since = notes[firstAnswer].createdAt;
  const answers = notes.filter((n) => n.isMe);
  return [
    {
      after: notes.slice(firstAnswer).filter((n) => !n.isMe),
      answers,
      closed: t.isResolved,
      feedback: first.body,
      kind: 'thread',
      laterCommits: laterCommits(pr, since),
      laterFeedback: pr.reviewThreads.nodes
        .filter((o) => o !== t && o.path === t.path)
        .map((o) => o.comments.nodes[0])
        .filter((c): c is GqlComment => Boolean(c) && c.createdAt > since && c.author?.login !== me)
        .map((c) => `${c.url} ${firstLine(c.body)}`),
      line: t.line ?? t.originalLine ?? undefined,
      outdated: t.isOutdated,
      path: t.path,
      pr: pr.number,
      reviewer: first.author?.login ?? '',
      reviewerIsBot: isBot(first),
      shas: linkedShas(answers.map((a) => a.body).join('\n')),
      url: first.url,
      vote: vote(first),
    },
  ];
}

function groupedItems(pr: GqlPr, me: string): Item[] {
  const sources = [
    ...pr.reviews.nodes.map((c) => ({ c, kind: 'review' as const })),
    ...pr.comments.nodes.map((c) => ({ c, kind: 'conversation' as const })),
  ];
  const byUrl = new Map(sources.map((s) => [s.c.url, s]));
  const seen = new Set<string>();
  const mine = pr.comments.nodes.filter((c) => c.author?.login === me && !isBot(c));

  return mine.flatMap((reply) =>
    answeredUrls(reply.body).flatMap(({ url, line }) => {
      const source = byUrl.get(url);
      if (!source || seen.has(url)) return [];
      seen.add(url);
      const { c, kind } = source;
      const reviewer = c.author?.login ?? '';
      const later = sources
        .map((s) => s.c)
        .filter((o) => o.createdAt > reply.createdAt && o.author?.login !== me && o.body.trim() !== '');
      return [
        {
          after: later.filter((o) => o.author?.login === reviewer).map((o) => note(o, me)),
          answers: [{ ...note(reply, me), body: line }],
          closed: c.isMinimized ?? false,
          feedback: c.body,
          kind,
          laterCommits: laterCommits(pr, reply.createdAt),
          laterFeedback: later
            .filter((o) => o.author?.login !== reviewer)
            .map((o) => `${o.url} ${firstLine(o.body)}`),
          outdated: false,
          pr: pr.number,
          reviewer,
          reviewerIsBot: isBot(c),
          shas: linkedShas(line),
          url,
          vote: vote(c),
        },
      ];
    }),
  );
}

export function buildItems(pr: GqlPr, me: string): Item[] {
  return [...pr.reviewThreads.nodes.flatMap((t) => threadItem(pr, t, me)), ...groupedItems(pr, me)];
}

function clip(body: string, max: number): string {
  const text = body.trim();
  return text.length > max ? `${text.slice(0, max)}\n[…clipped]` : text;
}

function renderNotes(ns: Note[]): string {
  return ns
    .map((n) => `- **${n.isMe ? 'author' : n.author}${n.isBot ? ' (bot)' : ''}**: ${clip(n.body, 800)}`)
    .join('\n');
}

function section(title: string, lines: string[]): string {
  return lines.length > 0 ? `\n### ${title}\n${lines.join('\n')}` : '';
}

function header(item: Item): string {
  const where = item.path ? `${item.path}${item.line ? `:${item.line}` : ''}` : item.kind;
  const flags = [
    `reviewer ${item.reviewer}${item.reviewerIsBot ? ' (bot)' : ''}`,
    item.closed ? 'closed' : 'open',
    item.outdated && 'outdated',
    item.vote && `author voted ${item.vote}`,
  ].filter(Boolean);
  return `PR ${item.pr} · ${where} · ${flags.join(' · ')}`;
}

export function renderItem(item: Item): string {
  return [
    `## ${item.url}`,
    header(item),
    '',
    '### Feedback',
    clip(item.feedback, 1500),
    '',
    '### Author answer',
    renderNotes(item.answers),
    item.after.length > 0 ? `\n### Reviewer after the answer\n${renderNotes(item.after)}` : '',
    section('Commits after the answer', item.laterCommits.map((c) => `- ${c}`)),
    section(`Later feedback on the same ${item.path ? 'file' : 'PR'}`, item.laterFeedback.map((f) => `- ${f}`)),
    item.shas.length > 0 ? `\nLinked commits: ${item.shas.join(', ')}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}

export function hasSignal(item: Item): boolean {
  return item.after.length > 0 || item.laterFeedback.length > 0 || item.laterCommits.some((c) => /\brevert/iu.test(c));
}

export function silentFixes(items: Item[], limit: number): Item[] {
  const fixes = items.filter((i) => !hasSignal(i) && i.shas.length > 0);
  if (fixes.length <= limit) return fixes;
  return Array.from({ length: limit }, (_, k) => fixes[Math.floor((k * fixes.length) / limit)]);
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function parseJudgment(line: string): Judgment | string {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return `not JSON: ${line.slice(0, 80)}`;
  }
  const j = raw as Partial<Judgment>;
  if (typeof j.url !== 'string') return `no url: ${line.slice(0, 80)}`;
  if (!OUTCOMES.includes(j.outcome as Judgment['outcome'])) return `${j.url}: bad outcome ${String(j.outcome)}`;
  if (!RESPONSES.includes(j.response as Judgment['response'])) return `${j.url}: bad response ${String(j.response)}`;
  if (!CAUSES.includes(j.cause as Judgment['cause'])) return `${j.url}: bad cause ${String(j.cause)}`;
  if (typeof j.reason !== 'string') return `${j.url}: no reason`;
  return j as Judgment;
}

export interface Tally {
  byOutcome: Record<string, Record<string, number>>;
  causes: { cause: string; count: number; prs: number; reviewers: number; reasons: string[] }[];
  missing: string[];
  extra: string[];
  silent: number;
}

export function tally(items: Item[], judgments: Judgment[]): Tally {
  const itemByUrl = new Map(items.map((i) => [i.url, i]));
  const judged = new Map(judgments.map((j) => [j.url, j]));
  const byOutcome: Tally['byOutcome'] = {};
  const causeMap = new Map<string, { items: Item[]; reasons: string[] }>();

  for (const j of judged.values()) {
    const item = itemByUrl.get(j.url);
    if (!item) continue;
    byOutcome[j.outcome] ??= {};
    byOutcome[j.outcome][j.response] = (byOutcome[j.outcome][j.response] ?? 0) + 1;
    if (j.response === 'accepted' || j.response === 'silent' || j.cause === 'none') continue;
    const entry = causeMap.get(j.cause) ?? { items: [], reasons: [] };
    entry.items.push(item);
    entry.reasons.push(`${j.response} · ${j.reason} · ${j.url}`);
    causeMap.set(j.cause, entry);
  }

  return {
    byOutcome,
    causes: [...causeMap.entries()]
      .map(([cause, e]) => ({
        cause,
        count: e.items.length,
        prs: new Set(e.items.map((i) => i.pr)).size,
        reasons: e.reasons,
        reviewers: new Set(e.items.map((i) => i.reviewer)).size,
      }))
      .toSorted((a, b) => b.count - a.count),
    extra: [...judged.keys()].filter((u) => !itemByUrl.has(u)),
    missing: items.filter((i) => hasSignal(i) && !judged.has(i.url)).map((i) => i.url),
    silent: items.filter((i) => !hasSignal(i)).length,
  };
}
