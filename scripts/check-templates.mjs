import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createPlugin } from './create-plugin.mjs';
import { ROOT, shapes, readJson, validatedPlugins } from './plugin-lib.mjs';
import { checkDshVersion } from './check-dsh-version.mjs';

const require = createRequire(import.meta.url);
export function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = data => { output = (output + data).slice(-30000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout ?? 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) accept(output);
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${output}`));
    });
  });
}
async function checkClient(directory, pkg) {
  let record;
  vm.runInNewContext(await readFile(join(directory, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { record = value; } } },
  });
  assert.equal(record.id, pkg.name);
  const plugin = record.factory(require);
  const entries = new Map(), cleanups = [];
  const ctx = { slots: {
    inject(_name, callback) { callback(); },
    register(options, Component) {
      const key = `${options.name}:${options.key ?? options.id}`;
      entries.set(key, Component);
      const cleanup = () => entries.delete(key); cleanups.push(cleanup); return cleanup;
    },
  } };
  plugin.apply(ctx);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const Panel = entries.get(`main:${pkg.name}`);
  assert.ok(Panel, 'main panel is registered');
  assert.match(renderToStaticMarkup(createElement(Panel)), /插件页面已加载/);
  assert.ok(entries.has(`sidebar.panellist:${pkg.name}`), 'navigation is registered');
  cleanups.reverse().forEach(cleanup => cleanup());
  assert.equal(entries.size, 0);
}
async function hostCheck(temp, artifacts, names) {
  const home = join(temp, 'dsh-home'); await mkdir(home);
  // Do not forward API keys, account tokens, proxy credentials or user .env paths.
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(), SYSTEMROOT: process.env.SYSTEMROOT,
    CI: 'true', NO_COLOR: '1' };
  const cli = resolve(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  const command = args => run(process.execPath, [cli, ...args], { cwd: temp, env });
  await command(['plugin', '--profile', 'web', 'add', ...artifacts]);
  const config = await command(['--profile', 'web', '--dump-config']);
  for (const name of names) assert.ok(config.includes(name), `${name} absent from actual DSH composition`);
  console.log('PASS DSH CLI tarball installation and configuration composition.');
  const child = spawn(process.execPath, [cli, 'web', '--port', '0', '--no-open'], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = false;
  child.stdout.on('data', data => { log = (log + data).slice(-50000); });
  child.stderr.on('data', data => { log = (log + data).slice(-50000); });
  const closed = new Promise(accept => { child.on('close', () => { exited = true; accept(); }); });
  const started = Date.now();
  try {
    let origin, ready = false;
    while (Date.now() - started < 60000) {
      if (exited) throw new Error(`DSH exited before readiness:\n${log}`);
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);
      if (match) {
        const url = new URL(match[0]); origin = url.origin;
        const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
        if (response.status < 500) { ready = true; break; }
      }
      await new Promise(accept => setTimeout(accept, 150));
    }
    assert.ok(origin && ready, `DSH did not publish readiness:\n${log}`);
    assert.doesNotMatch(log, /failed to (?:load|apply)|cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/i);
    let cookies = '';
    const urls = [...log.matchAll(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/g)].map(match => new URL(match[0]));
    let next = urls.find(url => url.search) ?? new URL('/', origin), page;
    for (let hop = 0; hop < 5; hop++) {
      page = await fetch(next, { headers: cookies ? { cookie: cookies } : {}, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const values = page.headers.getSetCookie();
      if (values.length) cookies = values.map(value => value.split(';')[0]).join('; ');
      const location = page.headers.get('location');
      if (!location || page.status < 300 || page.status >= 400) break;
      next = new URL(location, next);
    }
    const html = await page.text();
    assert.equal(page.status, 200, `Application page returned ${page.status}`);
    assert.ok(html.includes('__DSH_BOOT__'), 'Application page lacks Client boot graph');
    for (const name of names.filter(value => /client-ui|full-stack/.test(value))) {
      assert.ok(html.includes(name), `${name} absent from actual Client graph`);
    }
    const bundleUrls = new Set([...html.matchAll(/(?:src|href)="([^"]*plugins(?:\/|\?)[^\"]+)"/g)]
      .map(match => new URL(match[1].replaceAll('&amp;', '&'), origin).href));
    const served = new Set();
    for (const url of bundleUrls) {
      const response = await fetch(url, { headers: cookies ? { cookie: cookies } : {}, signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, 'Advertised Client bundle could not be fetched');
      const source = await response.text();
      for (const name of names.filter(value => /client-ui|full-stack/.test(value))) {
        if (source.includes(name)) served.add(name);
      }
    }
    assert.equal(served.size, 2, 'Both fixture Client artifacts must be served by DSH');
    console.log('PASS actual Web graph and HTTP delivery of both fixture Client artifacts.');
    console.log('PASS real isolated DSH Web startup (no model request).');
  } finally {
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed; clearTimeout(kill);
  }
  await command(['plugin', '--profile', 'web', 'remove', ...names]);
  const removed = await command(['--profile', 'web', '--dump-config']);
  for (const name of names) assert.ok(!removed.includes(`${name}:main`), `${name} remains after removal`);
  console.log('PASS DSH CLI removal and configuration cleanup.');
}

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--host')) throw new Error('Usage: check-templates.mjs [--host]');
await checkDshVersion();
const temp = await mkdtemp(join(tmpdir(), 'dshp-templates-'));
try {
  const output = join(temp, 'artifacts'); await mkdir(output);
  const names = [];
  for (const shape of shapes) {
    const directory = await createPlugin(shape, shape === 'skill-bundle' ? 'knowledge' : 'development', `fixture-${shape}`, temp);
    await symlink(resolve(ROOT, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const pkg = await readJson(join(directory, 'package.json')); names.push(pkg.name);
    // Invoke local tools directly: this offline stage does not install packages.
    await run(process.execPath, ['build.mjs'], { cwd: directory });
    await run(process.execPath, ['--test', 'tests/smoke.test.mjs'], { cwd: directory });
    await import(pathToFileURL(join(directory, 'lib/index.js')).href);
    if (pkg.dsh.client) await checkClient(directory, pkg);
    await run('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', output], { cwd: directory });
    const archive = join(output, `${pkg.name}-${pkg.version}.tgz`);
    const contents = await run('tar', ['-tzf', archive]);
    for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'README.md', 'locale/en.json']) assert.ok(contents.includes(`package/${file}`), `${file} missing from tarball`);
    if (pkg.dsh.client) assert.ok(contents.includes('package/lib/client.js'));
    if (shape === 'skill-bundle') assert.ok(contents.includes('skills/fixture-skill-bundle/SKILL.md'));
    assert.ok(!contents.includes('node_modules/'), 'development dependencies leaked into package');
    console.log(`PASS ${shape}: build, behavior, client factory where applicable, and tarball.`);
  }
  await validatedPlugins(temp);
  if (process.argv[2] === '--host') {
    const artifacts = (await readdir(output)).filter(file => file.endsWith('.tgz')).map(file => join(output, file));
    await hostCheck(temp, artifacts, names);
  }
} finally { await rm(temp, { recursive: true, force: true }); }
