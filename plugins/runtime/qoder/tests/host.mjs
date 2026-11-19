import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const directory = resolve(root, 'plugins/runtime/qoder');
const temp = await mkdtemp(join(tmpdir(), 'dsh-qoder-host-'));
function run(cmd, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-30000); });
    const kill = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('error', e => { clearTimeout(kill); reject(e); });
    child.on('close', code => { clearTimeout(kill); code === 0 ? accept(output) : reject(new Error(`${cmd} exited ${code}\n${output}`)); });
  });
}
try {
  const { version, devDependencies } = require('../package.json');
  const artifactDir = process.env.DSH_TEST_ARTIFACT_DIR;
  if (!artifactDir) await run('pnpm', ['pack', '--pack-destination', temp], { cwd: directory });
  const tarball = resolve(artifactDir ?? temp, `dsh-qoder-${version}.tgz`);
  const listing = await run('tar', ['-tzf', tarball]);
  for (const file of ['lib/index.js', 'lib/index.d.ts', 'lib/client.js', 'lib/client/index.d.ts', 'lib/accounts.js', 'lib/account-store.js', 'lib/remote.js', 'lib/runtime.js', 'lib/request.js', 'lib/stream.js', 'cordis.patch.yml', 'package.json', 'README.md', 'locale/zh.json']) {
    assert.ok(listing.includes(`package/${file}`), `tarball missing ${file}`);
  }
  assert.doesNotMatch(listing, /(?:node_modules|tests\/)/);
  const home = join(temp, 'home'); await mkdir(home);
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home, QODER_CONFIG_DIR: join(home, '.qoder'),
    TMPDIR: process.env.TMPDIR ?? tmpdir(), SYSTEMROOT: process.env.SYSTEMROOT, CI: 'true', NO_COLOR: '1' };
  let cli = process.env.DSH_TEST_CLI;
  if (!cli) {
    // Install the exact development runtime outside the workspace.
    const runtime = join(temp, 'runtime'); await mkdir(runtime);
    await writeFile(join(runtime, 'package.json'), '{"private":true,"type":"module"}');
    await run('pnpm', ['add', '--ignore-scripts', '--save-exact', `@deepseek-ai/dsh@${devDependencies['@deepseek-ai/dsh']}`], { cwd: runtime, env });
    cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  }
  cli = resolve(cli);
  const runtimeVersion = (await run(process.execPath, [cli, '--version'], { cwd: temp, env })).trim();
  await run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', tarball, '--ignore-scripts'], { cwd: temp, env });
  const config = await run(process.execPath, [cli, '--profile', 'web', '--dump-config'], { cwd: temp, env });
  assert.ok(config.includes('dsh-qoder:main'));
  const child = spawn(process.execPath, [cli, 'web', '--port', '0', '--no-open'], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-50000); });
  const closed = new Promise(accept => child.on('close', () => { exited = true; accept(); }));
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Web host exited before readiness:\n${log}`);
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);
      if (match) {
        const response = await fetch(match[0], { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        await response.body?.cancel();
        if (response.status < 500) { ready = true; break; }
      }
      await new Promise(accept => setTimeout(accept, 150));
    }
    assert.ok(ready, `Web host not ready:\n${log}`);
    assert.doesNotMatch(log, /failed to (?:load|apply)|cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|DUPLICATE_ADAPTER/i);
    console.log(`PASS dsh-qoder on DSH ${runtimeVersion}: tarball contents, isolated CLI installation, configuration and Web startup (no inference).`);
  } finally {
    child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed; clearTimeout(kill);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
