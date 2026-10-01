#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const USAGE = `prune.ts — remove LOCAL branches and their worktrees that are
fully merged into their head (the PR base branch), plus branches merged into
the fallback base.

LOCAL ONLY: this never touches the remote. It removes local worktrees and
deletes local branches. It never pushes, never deletes a remote branch, and
never closes a pull request. GitHub is consulted READ-ONLY (gh pr view) to
learn each branch's base and merge status.

SAFE BY DEFAULT: dry-run. It prints a plan and changes nothing until you
pass --apply.

Usage:
  prune.ts                 # dry-run: show what would be removed
  prune.ts --apply         # actually remove merged worktrees/branches
  prune.ts --base <ref>    # override fallback base (default: origin/<default>)
  prune.ts --force-dirty   # also remove worktrees with uncommitted changes
  prune.ts --no-gh         # ignore GitHub; use the git-ancestor check only
  prune.ts --help

A branch counts as MERGED when EITHER:
  1. GitHub reports its pull request as MERGED (via gh). This is keyed on the
     PR's own base branch ("its head"), so a branch merged into another
     feature branch in a stack is detected, and squash/rebase merges count
     too (their commits are not ancestors, so git alone can't see them); OR
  2. its tip is an ancestor of the fallback base (origin/<default>) — every
     commit on the branch is already in the base. This matches merge-commit
     and fast-forward merges and works with no network access.

GitHub detection needs gh installed and authenticated; without it (or with
--no-gh) only the ancestor check runs, and squash-merged branches are kept
for manual review.

Worktrees with uncommitted tracked changes are skipped unless --force-dirty.
Ignored files (node_modules, build caches) never block removal.
Run from your main checkout (not from inside a linked worktree).`;

type Kind = 'MERGED' | 'REVIEW' | 'KEEP';

interface PullRequest {
  state: string;
  baseRefName: string;
  number: number;
  headRefOid: string;
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
}

function git(...args: string[]): { ok: boolean; out: string } {
  return run('git', args);
}

function gitLive(...args: string[]): boolean {
  return spawnSync('git', args, { stdio: 'inherit' }).status === 0;
}

function printList(heading: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(heading);
  for (const item of items) console.log(`  - ${item}`);
}

let apply = false;
let forceDirty = false;
let useGh = true;
let baseOverride = '';

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--apply') apply = true;
  else if (arg === '--force-dirty') forceDirty = true;
  else if (arg === '--no-gh') useGh = false;
  else if (arg === '--base') {
    i += 1;
    baseOverride = argv[i] ?? '';
  } else if (arg === '-h' || arg === '--help') {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!git('rev-parse', '--is-inside-work-tree').ok) {
  console.error('error: not inside a git repository');
  process.exit(1);
}
const root = git('rev-parse', '--show-toplevel').out;
process.chdir(root);

let base = baseOverride;
if (!base) {
  const def = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD').out.replace(/^origin\//u, '');
  base = `origin/${def || 'main'}`;
}
const baseName = base.slice(base.lastIndexOf('/') + 1);

const ghOk = useGh && run('gh', ['auth', 'status']).ok;

console.log(`Repository: ${root}`);
console.log(`Base:       ${base} (fallback)`);
if (ghOk) console.log('GitHub:     gh authenticated — using PR merge status (read-only)');
else if (useGh) console.log('GitHub:     gh unavailable — git-ancestor check only (squash-merges kept)');
else console.log('GitHub:     disabled (--no-gh) — git-ancestor check only');
console.log(
  apply ? 'Mode:       APPLY (local only — no remote changes)' : 'Mode:       dry-run (pass --apply to execute)',
);
console.log();

console.log('Fetching & pruning...');
if (!git('fetch', '--prune', 'origin').ok) console.log('  warn: fetch failed; using cached refs');
if (!git('rev-parse', '--verify', '--quiet', base).ok) {
  console.error(`error: base ref '${base}' not found`);
  process.exit(1);
}

const current = git('branch', '--show-current').out;

const worktrees = new Map<string, string>();
let worktreePath = '';
for (const line of git('worktree', 'list', '--porcelain').out.split('\n')) {
  if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length);
  else if (line.startsWith('branch refs/heads/')) worktrees.set(line.slice('branch refs/heads/'.length), worktreePath);
}

interface Verdict {
  detail: string;
  kind: Kind;
}

function pullRequest(branch: string): PullRequest | undefined {
  if (!ghOk) return undefined;
  const view = run('gh', ['pr', 'view', branch, '--json', 'state,baseRefName,number,headRefOid']);
  return view.ok && view.out ? (JSON.parse(view.out) as PullRequest) : undefined;
}

function mergedPullRequest(branch: string, pr: PullRequest): Verdict {
  // Only auto-delete when the local tip IS the commit GitHub merged; a
  // mismatch means unpushed local commits that -D would silently drop.
  const localSha = git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).out;
  const merged = `PR #${pr.number} merged into ${pr.baseRefName}`;
  if (pr.headRefOid && localSha === pr.headRefOid) return { detail: merged, kind: 'MERGED' };
  return {
    detail: `${merged}, but local tip differs from merged head (unpushed commits?) — delete by hand`,
    kind: 'REVIEW',
  };
}

function aheadOf(branch: string, pr: PullRequest | undefined): Verdict {
  const prBase = pr?.baseRefName;
  const state = pr?.state;
  const ref = prBase && git('rev-parse', '--verify', '--quiet', `origin/${prBase}`).ok ? `origin/${prBase}` : base;
  const count = git('rev-list', '--count', `${ref}..${branch}`);
  const ahead = count.ok ? count.out : '?';
  if (ref === base) return { detail: `${ahead} ahead of ${baseName}${state ? ` (PR ${state})` : ''}`, kind: 'KEEP' };
  return { detail: `${ahead} ahead of ${prBase} (PR base${state ? `, ${state}` : ''})`, kind: 'KEEP' };
}

function classify(branch: string): Verdict {
  const pr = pullRequest(branch);
  if (pr?.state === 'MERGED') return mergedPullRequest(branch, pr);
  if (git('merge-base', '--is-ancestor', branch, base).ok) return { detail: `ancestor of ${base}`, kind: 'MERGED' };
  return aheadOf(branch, pr);
}

const removeWorktrees: string[] = [];
const deleteBranches: { branch: string; reason: string }[] = [];
const keep: string[] = [];
const review: string[] = [];
const skip: string[] = [];
let switchCurrent = false;

if (ghOk) console.log('Querying GitHub for PR merge status (read-only)...');

function plan(branch: string): void {
  const { kind, detail } = classify(branch);
  if (kind === 'REVIEW') {
    review.push(`${branch} (${detail})`);
    return;
  }
  if (kind === 'KEEP') {
    keep.push(`${branch} (${detail})`);
    return;
  }
  const path = worktrees.get(branch);
  if (path && path !== root) {
    if (git('-C', path, 'status', '--porcelain').out && !forceDirty) {
      skip.push(`${branch} — worktree has uncommitted changes (${path})`);
      return;
    }
    removeWorktrees.push(path);
  }
  if (branch === current) switchCurrent = true;
  deleteBranches.push({ branch, reason: detail });
}

for (const branch of git('for-each-ref', '--format=%(refname:short)', 'refs/heads/').out.split('\n')) {
  if (branch && branch !== baseName) plan(branch);
}

console.log();
console.log('=== Plan ===');
if (removeWorktrees.length > 0) printList('Worktrees to remove:', removeWorktrees);
else console.log('Worktrees to remove: none');
if (deleteBranches.length > 0) {
  printList(
    'Branches to delete (merged, local only):',
    deleteBranches.map(({ branch, reason }) => `${branch}  [${reason}]`),
  );
} else {
  console.log('Branches to delete: none');
}
if (switchCurrent) console.log(`Note: current branch is merged; main checkout will switch to '${baseName}' first.`);
printList('Merged on GitHub but local tip differs (review before deleting):', review);
printList('Keeping (unmerged):', keep);
printList('Skipped (use --force-dirty to include):', skip);

if (deleteBranches.length === 0 && removeWorktrees.length === 0) {
  console.log();
  console.log(
    review.length > 0 ? 'Nothing to auto-clean. See the review list above to delete by hand.' : 'Nothing to clean.',
  );
  process.exit(0);
}

if (!apply) {
  console.log();
  console.log('Dry-run only. Re-run with --apply to execute (local only — no remote changes).');
  process.exit(0);
}

console.log();
console.log('=== Applying (local only) ===');
for (const path of removeWorktrees) {
  console.log(
    gitLive('worktree', 'remove', '--force', path) ? `removed worktree: ${path}` : `FAILED worktree: ${path}`,
  );
}
git('worktree', 'prune');

if (switchCurrent) {
  if (git('rev-parse', '--verify', '--quiet', `refs/heads/${baseName}`).ok) gitLive('switch', baseName);
  else gitLive('switch', '-c', baseName, '--track', base);
  if (!git('merge', '--ff-only', base).ok) console.log(`  note: could not fast-forward ${baseName}`);
}

for (const { branch } of deleteBranches) {
  console.log(gitLive('branch', '-D', branch) ? `deleted branch: ${branch}` : `FAILED branch: ${branch}`);
}

console.log();
console.log('=== Done ===');
gitLive('worktree', 'list');
