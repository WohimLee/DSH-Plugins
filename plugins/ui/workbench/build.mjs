import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
await rm(new URL('./lib', import.meta.url), { recursive: true, force: true });
const compiler = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
for (const config of ['tsconfig.host.json', 'tsconfig.json']) {
  execFileSync(process.execPath, [compiler, '-p', config], { stdio: 'inherit' });
}
if (pkg.dsh.client) {
  await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
    format: 'cjs', platform: 'browser', target: 'es2022', external: ['react', 'react-dom', 'react/jsx-runtime'],
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' } });
}
