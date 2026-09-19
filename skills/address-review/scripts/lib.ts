// Shared `gh api` plumbing for apply.ts and unvote.ts.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const die = (prog: string, msg: string): never => {
  console.error(`${prog}: ${msg}`);
  process.exit(2);
};

// No shell, so a body or an id never gets a chance to be parsed as one.
export const gh = async (args: string[]): Promise<string> => {
  const { stdout } = await run('gh', args);
  return stdout.trim();
};

export const api = async (args: string[], jq?: string): Promise<string> => {
  const argv = ['api', ...args];
  if (jq) argv.push('--jq', jq);
  return gh(argv);
};

export const gql = async (query: string, args: string[], jq?: string): Promise<string> =>
  api(['graphql', '-f', `query=${query}`, ...args], jq);

export const retry = async <T>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
};

export const errText = (e: unknown): string => {
  const x = e as { stderr?: string; stdout?: string; message?: string };
  return (x.stderr || x.stdout || x.message || String(e)).trim().split('\n')[0];
};
