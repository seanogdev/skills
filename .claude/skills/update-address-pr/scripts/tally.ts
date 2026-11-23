#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJudgment, tally } from './lib.ts';
import type { Item, Judgment } from './lib.ts';

const [dir] = process.argv.slice(2);
if (!dir || dir === '-h' || dir === '--help') {
  console.log('Tally the judge-N.jsonl files in a collect.ts run directory.\nUsage: tally.ts DIR');
  process.exit(dir ? 0 : 2);
}

const items = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as Item[];
const judgments: Judgment[] = [];
const problems: string[] = [];
for (const file of readdirSync(dir).filter((f) => /^judge-\d+\.jsonl$/u.test(f))) {
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const j = parseJudgment(line);
    if (typeof j === 'string') problems.push(`${file}: ${j}`);
    else judgments.push(j);
  }
}

const t = tally(items, judgments);
problems.push(...t.missing.map((u) => `not judged: ${u}`), ...t.extra.map((u) => `judged but not collected: ${u}`));
if (problems.length > 0) console.log(`PROBLEMS (fix before reading the rates)\n${problems.map((p) => `- ${p}`).join('\n')}\n`);

console.log(`SILENT (no later response, not judged): ${t.silent}\n\nOUTCOME × RESPONSE (judged items)`);
for (const [outcome, responses] of Object.entries(t.byOutcome)) {
  console.log(`- ${outcome}: ${Object.entries(responses).map(([r, n]) => `${r} ${n}`).join(', ')}`);
}
console.log('\nCAUSES (pushback, reraised or reverted)');
for (const c of t.causes) {
  console.log(`\n${c.cause}: ${c.count} across ${c.prs} PRs, ${c.reviewers} reviewers`);
  for (const r of c.reasons) console.log(`  - ${r}`);
}
