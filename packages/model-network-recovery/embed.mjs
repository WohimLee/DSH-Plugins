import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsc = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc');

/** Compile shared Host code into one consumer's independent tarball. */
export function embedNetworkRecovery(outDir) {
  const config = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
  execFileSync(process.execPath, [tsc, '-p', config, '--outDir', fileURLToPath(outDir)], { stdio: 'inherit' });
}
