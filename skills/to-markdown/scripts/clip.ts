#!/usr/bin/env node
// Copy prose to the clipboard as chat-friendly markdown.
// Flattens markdown headings to bold. With --quote, also prefixes every line with "> ".
// Usage: clip.ts [--quote] < message.md

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [arg] = process.argv.slice(2);
if (arg !== undefined && arg !== '--quote') {
  console.error(`clip.ts: unknown option: ${arg}`);
  process.exit(2);
}

let text = readFileSync(0, 'utf8').replaceAll(/^#{1,6}\s+(?<heading>.*)$/gmu, '**$<heading>**');
if (arg === '--quote') {
  const lines = text.split('\n');
  const trailing = lines.at(-1) === '' ? lines.pop() : undefined;
  text = lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
  if (trailing !== undefined) text += '\n';
}

try {
  execFileSync('pbcopy', { input: text });
} catch {
  console.error('clip.ts: pbcopy is required (macOS only)');
  process.exit(2);
}
