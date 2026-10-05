// Shared `gh api` plumbing for apply.ts and unvote.ts.

import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

// eslint-disable-next-line typescript/strict-void-return -- promisify resolves execFile's callback overload correctly; the sync-return overload it's flagging against is unreachable here
const run = promisify(execFile);

// Thrown by die() and caught at each script's top level, which is where
// process.exit() belongs — not buried inside a shared library function.
export class DieError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DieError';
  }
}

export function die(prog: string, msg: string): never {
  throw new DieError(`${prog}: ${msg}`);
}

// No shell, so a body or an id never gets a chance to be parsed as one.
export async function gh(args: string[]): Promise<string> {
  const { stdout } = await run('gh', args);
  return stdout.trim();
}

export async function api(args: string[], jq?: string): Promise<string> {
  const argv = ['api', ...args];
  if (jq) argv.push('--jq', jq);
  return gh(argv);
}

export async function gql(query: string, args: string[], jq?: string): Promise<string> {
  return api(['graphql', '-f', `query=${query}`, ...args], jq);
}

export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each attempt must see the previous one's failure before retrying
      return await fn();
    } catch (error) {
      if (i >= attempts) throw error;
      // eslint-disable-next-line no-await-in-loop -- backoff must elapse before the next attempt
      await sleep(i * 2000);
    }
  }
}

export function errText(e: unknown): string {
  const x = e as { stderr?: string; stdout?: string; message?: string };
  return (x.stderr || x.stdout || x.message || String(e)).trim().split('\n')[0];
}
