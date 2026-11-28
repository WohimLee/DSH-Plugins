import { build } from 'esbuild';
import { embedNetworkRecovery } from '@dsh-plugins/model-network-recovery/embed';
import { copyFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
await rm(new URL('./lib', import.meta.url), { recursive: true, force: true });
embedNetworkRecovery(new URL('./lib/', import.meta.url));
execFileSync(process.execPath, [resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' });
// Embed the helper in each tarball so installed plugins resolve only local code.
for (const file of ['proxy.js', 'proxy.d.ts']) {
  await copyFile(require.resolve('@dsh-plugins/macos-proxy/' + file), new URL('./lib/' + file, import.meta.url));
}
if (pkg.dsh.client) {
  await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
    format: 'cjs', platform: 'browser', target: 'es2022', external: ['react', 'react-dom', 'react/jsx-runtime'],
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' } });
}
