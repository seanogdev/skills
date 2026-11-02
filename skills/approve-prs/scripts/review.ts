#!/usr/bin/env node
// Usage: review.ts <prs.json> < decisions.json

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { reviewArgs, validateDecisions } from './lib.ts';
import type { Decision, Pr } from './types.ts';

const [prsPath] = process.argv.slice(2);
if (prsPath === undefined) {
  console.error('usage: review.ts <prs.json> < decisions.json');
  process.exit(2);
}

const prs = JSON.parse(readFileSync(prsPath, 'utf8')) as Pr[];
const decisions = JSON.parse(readFileSync(0, 'utf8')) as Decision[];

const errors = validateDecisions(prs, decisions);
if (errors.length > 0) {
  console.error(`review.ts: nothing posted. Fix these, then rerun:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}

let failed = 0;
for (const d of decisions) {
  const pr = prs.find((p) => p.id === d.id)!;
  const result = spawnSync('gh', reviewArgs(pr, d), { encoding: 'utf8', input: d.body ?? '' });
  if (result.status === 0) {
    console.log(`ok      ${d.id}  ${d.action}`);
  } else {
    failed += 1;
    console.log(
      `failed  ${d.id}  ${d.action}: ${(result.stderr || result.error?.message || '').trim().split('\n')[0]}`,
    );
  }
}
process.exit(failed > 0 ? 1 : 0);
