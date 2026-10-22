import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// eslint-disable-next-line typescript/strict-void-return -- promisify resolves execFile's callback overload correctly; the sync-return overload it's flagging against is unreachable here
const run = promisify(execFile);

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
  const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export function errText(e: unknown): string {
  const x = e as { stderr?: string; stdout?: string; message?: string };
  return (x.stderr || x.stdout || x.message || String(e)).trim().split('\n')[0];
}
