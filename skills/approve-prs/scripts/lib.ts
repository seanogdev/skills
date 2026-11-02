import type { Pr, Assessment, Decision, Option, Question } from './types.ts';

const MAX_SUMMARY = 20;
const PER_QUESTION = 4;
const PER_CALL = 4;

const DOC = [/\.(?:md|mdx|txt|rst|adoc)$/iu, /(?:^|\/)docs?\//iu, /(?:^|\/)(?:LICENSE|CHANGELOG)[^/]*$/iu];
const TEST = [/(?:^|\/)(?:tests?|__tests__|specs?|e2e|fixtures)\//iu, /[._-](?:test|spec)\.[^/]+$/iu, /_test\.go$/iu];
const INFRA = [
  /(?:^|\/)\.github\/workflows\//iu,
  /(?:^|\/)\.gitlab-ci\.ya?ml$/iu,
  /(?:^|\/)Jenkinsfile$/iu,
  /(?:^|\/)(?:Dockerfile|docker-compose[^/]*)$/iu,
  /\.tf$/iu,
  /(?:^|\/)(?:terraform|helm|k8s|kubernetes|deploy|infra)\//iu,
];
const DEPS = [
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/iu,
  /(?:^|\/)(?:go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile(?:\.lock)?|composer\.(?:json|lock))$/iu,
  /(?:^|\/)(?:requirements[^/]*\.txt|poetry\.lock|pyproject\.toml|uv\.lock)$/iu,
];
const SENSITIVE = [
  /(?:auth|login|session|permission|acl|oauth|token|password|secret|crypto|payment|billing)/iu,
  /(?:^|\/)migrations?\//iu,
  /\.sql$/iu,
];

function matches(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

function sizeRisk(lines: number): number {
  if (lines <= 100) return 2;
  if (lines <= 500) return 3;
  return 4;
}

function cell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ');
}

function summaryLength(summary: string): number {
  return [...new Intl.Segmenter().segment(summary.trim())].length;
}

function checkRisk(pr: Pr, risk: number): string | undefined {
  if (!Number.isInteger(risk) || risk < 1 || risk > 5) return `${pr.id}: risk must be an integer 1-5`;
  if (Math.abs(risk - pr.baseRisk) > 1) return `${pr.id}: risk ${risk} is more than 1 from base risk ${pr.baseRisk}`;
  return undefined;
}

function checkAssessment(pr: Pr, a: Assessment | undefined): string[] {
  if (a === undefined) return [`${pr.id}: no assessment`];
  const errors: string[] = [];
  const length = summaryLength(a.summary ?? '');
  if (length === 0 || length > MAX_SUMMARY)
    errors.push(`${pr.id}: summary must be 1-${MAX_SUMMARY} characters, got ${length}`);
  const risk = checkRisk(pr, a.risk);
  if (risk !== undefined) errors.push(risk);
  if (!a.reason?.trim()) errors.push(`${pr.id}: reason is empty`);
  return errors;
}

export function scoreRisk(files: string[], additions: number, deletions: number): { risk: number; signals: string[] } {
  const lines = additions + deletions;
  const tests = files.filter((f) => matches(f, TEST));
  const code = files.filter((f) => !matches(f, DOC) && !matches(f, TEST));
  if (code.length === 0) return { risk: 1, signals: [tests.length > 0 ? 'docs and tests only' : 'docs only'] };

  const signals = [`${lines} lines changed`];
  let risk = sizeRisk(lines);
  const infra = code.filter((f) => matches(f, INFRA));
  const deps = code.filter((f) => matches(f, DEPS));
  const sensitive = code.filter((f) => matches(f, SENSITIVE));
  if (sensitive.length > 0) {
    risk = Math.max(risk, 4);
    signals.push(`sensitive: ${sensitive.slice(0, 3).join(', ')}`);
  }
  if (deps.length > 0) {
    risk = Math.max(risk, 4);
    signals.push(`dependencies: ${deps.slice(0, 3).join(', ')}`);
  }
  if (infra.length > 0) {
    risk = 5;
    signals.push(`infra: ${infra.slice(0, 3).join(', ')}`);
  }
  if (tests.length === 0 && code.length > deps.length) {
    risk = Math.min(5, risk + 1);
    signals.push('no test changes');
  }
  return { risk, signals };
}

export function parseArgs(argv: string[]): { user?: string; repo?: string } {
  const args = argv.filter((a) => a.trim() !== '');
  if (args.length > 2) throw new Error('usage: fetch.ts [username] [owner/repo]');
  const [user, repo] = args;
  if (repo !== undefined && !/^[\w.-]+\/[\w.-]+$/u.test(repo)) throw new Error(`not an owner/repo: ${repo}`);
  return { repo, user: user?.replace(/^@/u, '') };
}

export function validateAssessments(prs: Pr[], assessments: Record<string, Assessment>): string[] {
  const errors = prs.flatMap((pr) => checkAssessment(pr, assessments[pr.id]));
  for (const id of Object.keys(assessments)) {
    if (!prs.some((pr) => pr.id === id)) errors.push(`${id}: not in the PR list`);
  }
  return errors;
}

export function sortPrs(prs: Pr[], assessments: Record<string, Assessment>): Pr[] {
  return prs.toSorted(
    (a, b) => assessments[a.id].risk - assessments[b.id].risk || a.repo.localeCompare(b.repo) || a.number - b.number,
  );
}

export function renderTable(prs: Pr[], assessments: Record<string, Assessment>): string {
  const rows = prs.map((pr) => {
    const a = assessments[pr.id];
    const flags = [pr.isDraft ? '[draft] ' : '', pr.isOwn ? '[yours] ' : ''].join('');
    return `| [#${pr.number}](${pr.url}) | ${pr.repo} | ${cell(flags + pr.title)} | ${cell(a.summary.trim())} | ${a.risk} — ${cell(a.reason.trim())} | +${pr.additions}/-${pr.deletions} |`;
  });
  return [
    '| PR | Repo | Title | Summary | Risk | Size |',
    '| -- | ---- | ----- | ------- | ---- | ---- |',
    ...rows,
  ].join('\n');
}

export function labels(prs: Pr[], assessments: Record<string, Assessment>): Map<string, string> {
  const counts = new Map<number, number>();
  for (const pr of prs) counts.set(pr.number, (counts.get(pr.number) ?? 0) + 1);
  return new Map(
    prs.map((pr) => {
      const prefix = counts.get(pr.number)! > 1 ? `${pr.repo.split('/')[1]}#` : '#';
      return [pr.id, `${prefix}${pr.number} ${assessments[pr.id].summary.trim()}`];
    }),
  );
}

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  const last = groups.at(-1);
  const prev = groups.at(-2);
  if (last?.length === 1 && prev !== undefined && prev.length > 2) last.unshift(prev.pop()!);
  return groups;
}

export function selectionCalls(prs: Pr[], assessments: Record<string, Assessment>): Question[][] {
  if (prs.length < 2) return [];
  const names = labels(prs, assessments);
  const groups = chunk(prs, PER_QUESTION);
  let seen = 0;
  const questions = groups.map((group): Question => {
    const first = seen + 1;
    seen += group.length;
    return {
      header: `PRs ${first}-${first + group.length - 1}`,
      multiSelect: true,
      options: group.map((pr) => ({
        description: `${pr.repo} · risk ${assessments[pr.id].risk}/5${pr.isOwn ? ' · yours' : ''} · ${pr.title}`,
        label: names.get(pr.id)!,
      })),
      question: `Which PRs do you want to act on? (${first}-${first + group.length - 1} of ${prs.length})`,
    };
  });
  return chunk(questions, PER_CALL);
}

export function actionQuestion(pr: Pr, label: string, single: boolean): Question {
  const options: Option[] = [{ description: 'Post your note as a review comment.', label: 'Comment only' }];
  if (!pr.isOwn) {
    options.unshift(
      { description: 'Approve with no comment.', label: 'Approve' },
      { description: 'Approve, with your note as the review body.', label: 'Approve with comment' },
    );
  }
  if (single || pr.isOwn) options.push({ description: 'Leave this PR alone.', label: 'Skip' });
  return {
    header: `#${pr.number}`.slice(0, 12),
    multiSelect: false,
    options,
    question: `What do you want to do with ${label}?`,
  };
}

export function actionCalls(prs: Pr[], assessments: Record<string, Assessment>, chosen: string[]): Question[][] {
  const names = labels(prs, assessments);
  const picked = chosen.map((c) => {
    const pr = prs.find((p) => p.id === c || names.get(p.id) === c);
    if (pr === undefined) throw new Error(`unknown PR: ${c}`);
    return pr;
  });
  const single = prs.length === 1;
  return chunk(
    picked.map((pr) => actionQuestion(pr, names.get(pr.id)!, single)),
    PER_CALL,
  );
}

export function validateDecisions(prs: Pr[], decisions: Decision[]): string[] {
  const errors: string[] = [];
  for (const d of decisions) {
    const pr = prs.find((p) => p.id === d.id);
    if (pr === undefined) errors.push(`${d.id}: not in the PR list`);
    else if (pr.isOwn && d.action !== 'comment') errors.push(`${d.id}: you can't approve your own PR`);
    if (!['approve', 'approve-comment', 'comment'].includes(d.action))
      errors.push(`${d.id}: unknown action ${d.action}`);
    if (d.action !== 'approve' && !d.body?.trim()) errors.push(`${d.id}: ${d.action} needs a body`);
  }
  return errors;
}

export function reviewArgs(pr: Pr, d: Decision): string[] {
  const args = ['pr', 'review', String(pr.number), '-R', pr.repo, d.action === 'comment' ? '--comment' : '--approve'];
  if (d.action !== 'approve') args.push('--body-file', '-');
  return args;
}
