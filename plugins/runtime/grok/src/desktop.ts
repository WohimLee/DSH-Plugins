import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const bundleId = 'com.anysphere.sand';

export async function detectGrokDesktop(
  signal: AbortSignal,
  directories = ['/Applications', join(homedir(), 'Applications')],
  find = async () => {
    const result = await run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`],
      { timeout: 2500, signal });
    return result.stdout.trim().split('\n').filter(Boolean);
  },
): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null;

  async function isGrok(app: string) {
    const plist = join(app, 'Contents', 'Info.plist');
    try {
      const { stdout: id } = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist],
        { signal, timeout: 1500 });
      if (id.trim() !== bundleId) return false;
      const { stdout: output } = await run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist],
        { signal, timeout: 1500 });
      const executable = output.trim();
      if (!executable || executable !== basename(executable)) return false;
      await access(join(app, 'Contents', 'MacOS', executable));
      return true;
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }

  for (const directory of directories) {
    if (await isGrok(join(directory, 'Grok Bot.app'))) return true;
  }
  let installed: string[];
  try {
    installed = await find();
  } catch {
    signal.throwIfAborted();
    return null;
  }
  for (const app of installed) {
    if (await isGrok(app)) return true;
  }
  return false;
}
