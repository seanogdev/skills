#!/usr/bin/env node
// Usage: render.ts <prs.json> <assessments.json> [--actions <id-or-label>...]

import { readFileSync } from 'node:fs';

import { actionCalls, renderTable, selectionCalls, sortPrs, validateAssessments } from './lib.ts';
import type { Assessment, Pr } from './types.ts';

const [prsPath, assessmentsPath, flag, ...chosen] = process.argv.slice(2);
if (prsPath === undefined || assessmentsPath === undefined || (flag !== undefined && flag !== '--actions')) {
  console.error('usage: render.ts <prs.json> <assessments.json> [--actions <id-or-label>...]');
  process.exit(2);
}

const prs = JSON.parse(readFileSync(prsPath, 'utf8')) as Pr[];
const assessments = JSON.parse(readFileSync(assessmentsPath, 'utf8')) as Record<string, Assessment>;

const errors = validateAssessments(prs, assessments);
if (errors.length > 0) {
  console.error(`render.ts: fix these in ${assessmentsPath}, then rerun:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}

const sorted = sortPrs(prs, assessments);
try {
  if (flag === '--actions') {
    let picked = chosen;
    if (picked.length === 0 && sorted.length === 1) picked = [sorted[0].id];
    console.log(JSON.stringify(actionCalls(sorted, assessments, picked), undefined, 2));
  } else {
    console.log(renderTable(sorted, assessments));
    console.log('\nAskUserQuestion calls:');
    console.log(JSON.stringify(selectionCalls(sorted, assessments), undefined, 2));
  }
} catch (error) {
  console.error(`render.ts: ${(error as Error).message}`);
  process.exit(1);
}
