import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync,
  renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, matchesGlob, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { parse } from 'yaml';
import { ROOT, scanPlugins } from './plugin-lib.mjs';

const artifactRoot = join(homedir(), '.dsh-plugin-artifacts');
const desktopLock = join(artifactRoot, 'desktop-delivery.active');
const desktopHome = join(homedir(), '.dsh');
const profileDir = join(desktopHome, 'profiles', 'desktop');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');

function run(program, args, { cwd = ROOT, env = process.env, binary = false, log } = {}) {
  const fd = log ? openSync(log, 'a', 0o600) : undefined;
  let result;
  try {
    if (fd !== undefined) writeFileSync(fd, `\n$ ${[program, ...args].join(' ')}\n`);
    result = spawnSync(program, args, {
      cwd, env,
      stdio: log ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'],
      encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`${[program, ...args].join(' ')} failed (${result.signal ?? result.status})${detail ? `\n${detail}` : ''}${log ? `\nLog: ${log}` : ''}`);
  }
  return binary ? result.stdout : result.stdout?.trim();
}

const git = (...args) => run('git', args);
function changedPaths(base, head) {
  return git('diff', '--name-only', '--no-renames', '-z', base, head)
    .split('\0').filter(Boolean);
}

function upstream() {
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  return git('rev-parse', 'refs/remotes/origin/main');
}

function runtimeFile(path) {
  return !/^(?:tests?\/|(?:AGENTS|README|CHANGELOG)\.md$|plugin\.meta\.json$)/.test(path);
}

export function desktopPackages(paths, plugins, shared) {
  const sharedNames = new Set(shared.filter(pkg => paths.some(path =>
    path.startsWith(pkg.prefix) && runtimeFile(path.slice(pkg.prefix.length))
  )).map(pkg => pkg.manifest.name));
  const sharedConfig = paths.some(path => [
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
  ].includes(path));

  function usesChangedDependency(manifest, visited = new Set()) {
    const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    return Object.keys(deps).some(name => {
      if (sharedNames.has(name)) return true;
      const pkg = shared.find(candidate => candidate.manifest.name === name);
      if (!pkg || visited.has(name)) return false;
      visited.add(name);
      return usesChangedDependency(pkg.manifest, visited);
    });
  }

  return plugins.filter(({ category, slug, meta, manifest }) => {
    const prefix = `plugins/${category}/${slug}/`;
    return meta.surfaces.desktop.status !== 'unsupported' && (
      sharedConfig || paths.some(path => path.startsWith(prefix) && runtimeFile(path.slice(prefix.length))) ||
      usesChangedDependency(manifest)
    );
  });
}

async function packagesFor(paths, tree) {
  const plugins = await scanPlugins(tree);
  const sharedDir = join(tree, 'packages');
  const shared = existsSync(sharedDir) ? readdirSync(sharedDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(sharedDir, entry.name, 'package.json')))
    .map(({ name }) => ({
      prefix: `packages/${name}/`,
      manifest: readJson(join(sharedDir, name, 'package.json')),
    })) : [];
  return desktopPackages(paths, plugins, shared);
}

function requiredWorkflows(tree, paths) {
  const dir = join(tree, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(file => /\.ya?ml$/.test(file)).flatMap(file => {
    const workflow = parse(readFileSync(join(dir, file), 'utf8'));
    const push = workflow.on?.push;
    if (push === undefined) return [];
    if (push?.branches && !push.branches.includes('main')) return [];
    if (push?.paths && !paths.some(path => push.paths.some(pattern => matchesGlob(path, pattern)))) return [];
    return [workflow.name];
  });
}

function archiveEntries(tarball, manifest) {
  const entries = run('tar', ['-tzf', tarball]).split('\n').filter(path => !path.endsWith('/'));
  const paths = entries.map(path => {
    if (!path.startsWith('package/') || path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error(`Unexpected archive entry: ${path}`);
    }
    return path.slice('package/'.length);
  });
  const required = ['package.json', manifest.main, ...[manifest.dsh.bundle.patch].flat()];
  for (const value of Object.values(manifest.exports ?? {})) {
    required.push(...(typeof value === 'string' ? [value] : Object.values(value)));
  }
  for (const file of required.filter(Boolean)) {
    const path = file.replace(/^\.\//, '');
    const star = path.indexOf('*');
    const found = star === -1 ? paths.includes(path) : paths.some(entry =>
      entry.startsWith(path.slice(0, star)) && entry.endsWith(path.slice(star + 1)));
    if (!found) throw new Error(`${manifest.name}: ${path} missing from tarball`);
  }
  for (const path of manifest.files ?? []) {
    if (!paths.some(entry => entry === path || entry.startsWith(`${path}/`))) {
      throw new Error(`${manifest.name}: declared files missing from tarball: ${path}`);
    }
  }
  return paths;
}

function save(receipt, updates) {
  Object.assign(receipt, updates, { updatedAt: new Date().toISOString() });
  const temporary = `${receipt.file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, receipt.file);
}

function stage(receipt, name, reason = null) {
  save(receipt, { stage: name, reason });
  console.log(`交付阶段 ${name}${reason ? ` — ${reason}` : ''}\n凭证 ${receipt.file}`);
}

async function prepare(receipt, baseRef) {
  if (!baseRef || baseRef.startsWith('-')) throw new Error('Provide the confirmed task base commit.');
  if (git('status', '--porcelain')) throw new Error('Commit the reviewed task scope in a clean task Worktree first.');
  const base = git('rev-parse', '--verify', `${baseRef}^{commit}`);
  const head = git('rev-parse', 'HEAD');
  if (base === head) throw new Error('The task base and HEAD are identical.');
  git('merge-base', '--is-ancestor', base, head);
  const previous = upstream();
  git('merge-base', '--is-ancestor', base, previous);
  const remote = git('remote', 'get-url', 'origin');
  if (git('remote', 'get-url', '--push', 'origin') !== remote) {
    throw new Error('The fetch and push destinations of origin must match.');
  }
  save(receipt, { remote, base, task: head, previous });
  console.log(git('log', '--oneline', `${previous}..${head}`));

  stage(receipt, '合并');
  const tree = join(dirname(receipt.file), 'source');
  git('worktree', 'add', '--detach', tree, previous);
  try {
    run('git', ['merge', '--no-edit', head], { cwd: tree });
    const integrated = run('git', ['rev-parse', 'HEAD'], { cwd: tree });
    const pushedPaths = changedPaths(integrated === previous ? `${integrated}^1` : previous, integrated);
    save(receipt, { integrated, workflows: requiredWorkflows(tree, pushedPaths) });
    const scope = [...new Set([...changedPaths(base, head), ...changedPaths(previous, integrated)])];
    const removed = git('diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', previous, integrated)
      .split('\0').filter(path => /^plugins\/[^/]+\/[^/]+\/package\.json$/.test(path));
    if (removed.length) throw new Error(`Desktop removal needs its own authorized delivery: ${removed.join(', ')}`);
    const plugins = await packagesFor(scope, tree);
    save(receipt, { packages: plugins.map(({ manifest, category, slug }) => ({
      name: manifest.name, version: manifest.version, prefix: `plugins/${category}/${slug}/`,
    })) });

    stage(receipt, '检查');
    const log = join(dirname(receipt.file), 'build.log');
    save(receipt, { log });
    const pnpm = (...args) => run('pnpm', args, { cwd: tree, log });
    pnpm('install', '--frozen-lockfile');
    pnpm('check:dsh-version');
    pnpm('check');
    if (scope.some(path => /^(templates\/|scripts\/|packages\/|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig\.base\.json$)/.test(path))) {
      pnpm('test:host');
    }

    for (const [index, plugin] of plugins.entries()) {
      const { manifest } = plugin;
      const output = join(dirname(receipt.file), manifest.name);
      mkdirSync(output);
      stage(receipt, '构建打包', manifest.name);
      pnpm('--filter', manifest.name, 'build');
      pnpm('--filter', manifest.name, '--config.ignore-scripts=true', 'pack', '--pack-destination', output);
      const archives = readdirSync(output).filter(name => name.endsWith('.tgz'));
      if (archives.length !== 1) throw new Error(`Expected one tarball in ${output}`);
      const tarball = join(output, archives[0]);
      const entries = archiveEntries(tarball, manifest);
      Object.assign(receipt.packages[index], {
        tarball, sha256: digest(readFileSync(tarball)), entries, engines: manifest.engines.dsh,
      });
      save(receipt, {});
      if (manifest.scripts['test:host']) {
        stage(receipt, '隔离宿主验证', manifest.name);
        const env = { ...process.env, DSH_TEST_ARTIFACT_DIR: output };
        delete env.DSH_HOME;
        delete env.DSH_TEST_CLI;
        delete env.DSH_TEST_MODEL_PICKER_ARTIFACT_DIR;
        run('pnpm', ['--filter', manifest.name, 'test:host'], { cwd: tree, env, log });
      }
    }

    stage(receipt, '推送');
    if (upstream() !== previous) throw new Error('origin/main advanced during preparation. Start again from the same task base to validate against the latest main.');
    git('push', 'origin', `${integrated}:refs/heads/main`);
    const published = upstream();
    git('merge-base', '--is-ancestor', integrated, published);
    save(receipt, { publishedAt: new Date().toISOString() });
  } finally {
    // This checkout was created for this receipt. Keep it if Git detects changes.
    try {
      git('worktree', 'remove', tree);
    } catch (error) {
      save(receipt, { retainedWorktree: tree });
      console.error(error.message);
    }
  }
  stage(receipt, pluginsPending(receipt) ? '待安装' : '待核对 CI', pluginsPending(receipt)
    ? '运行 desktop 子命令后继续安装和验收。'
    : '本次交付没有待安装的桌面插件产物。');
}

const pluginsPending = receipt => receipt.packages?.length > 0;

function lockOwner() {
  try {
    return readlinkSync(desktopLock);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function reserve(receipt) {
  try {
    symlinkSync(receipt.file, desktopLock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = lockOwner();
    if (owner !== receipt.file) throw new Error(`Desktop is reserved by ${owner ?? 'another delivery'}. Coordinate with its owner before retrying.`);
  }
}

function release(receipt) {
  if (lockOwner() === receipt.file) unlinkSync(desktopLock);
}

async function verifyFresh(receipt) {
  if (!receipt.publishedAt || receipt.remote !== git('remote', 'get-url', 'origin')) {
    throw new Error('The receipt has no verified push to this origin. Run start again.');
  }
  const tip = upstream();
  git('merge-base', '--is-ancestor', receipt.integrated, tip);
  if (pluginsPending(receipt)) {
    const newer = changedPaths(receipt.integrated, tip);
    const packages = await packagesFor(newer, ROOT);
    const changed = new Set(packages.map(plugin => plugin.manifest.name));
    if (receipt.packages.some(({ name, prefix }) => changed.has(name) || newer.some(path =>
      path.startsWith(prefix) && runtimeFile(path.slice(prefix.length)))) ||
        newer.some(path => /^plugins\/[^/]+\/[^/]+\/package\.json$/.test(path) && !existsSync(join(ROOT, path)))) {
      throw new Error('origin/main now includes newer runtime changes for the delivery. Rebuild against the latest main with start.');
    }
  }
}

function desktopApp() {
  if (process.platform !== 'darwin') throw new Error('Daily Desktop delivery currently requires macOS.');
  const app = process.env.DSH_DESKTOP_APP ?? [
    '/Applications/DeepSeek Harness.app', join(homedir(), 'Applications', 'DeepSeek Harness.app'),
  ].find(path => existsSync(join(path, 'Contents', 'Info.plist')));
  if (!app) throw new Error('DeepSeek Harness.app was not found. Set DSH_DESKTOP_APP to the daily app.');
  const plist = join(app, 'Contents', 'Info.plist');
  const field = name => run('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, plist]);
  const fieldName = field('CFBundleExecutable');
  const running = run('/bin/ps', ['-axo', 'comm=']).split('\n')
    .some(command => command.trim() === join(app, 'Contents', 'MacOS', fieldName));
  return { app, running, version: field('CFBundleShortVersionString') };
}

function assertArchive(pkg) {
  if (digest(readFileSync(pkg.tarball)) !== pkg.sha256) {
    throw new Error(`${pkg.name}: tarball no longer matches the build digest.`);
  }
}

function installedSource(pkg) {
  return readJson(join(profileDir, 'package.json')).dependencies?.[pkg.name];
}

function assertInstalled(pkg) {
  assertArchive(pkg);
  if (installedSource(pkg) !== `file:${pkg.tarball}`) {
    throw new Error(`${pkg.name}: daily profile does not reference ${pkg.tarball}`);
  }
  const moduleDir = join(profileDir, 'node_modules', pkg.name);
  for (const file of pkg.entries) {
    const expected = run('tar', ['-xOzf', pkg.tarball, `package/${file}`], { binary: true });
    if (!expected.equals(readFileSync(join(moduleDir, file)))) {
      throw new Error(`${pkg.name}: installed ${file} differs from the delivery tarball.`);
    }
  }
}

async function install(receipt) {
  if (!pluginsPending(receipt)) throw new Error('This receipt has no Desktop packages.');
  stage(receipt, '安装');
  await verifyFresh(receipt);
  if (process.env.DSH_HOME && resolve(process.env.DSH_HOME) !== desktopHome) {
    throw new Error('This shell has a different DSH_HOME. Use the daily Desktop environment.');
  }
  const { app, running, version } = desktopApp();
  if (!existsSync(join(profileDir, 'package.json'))) throw new Error('The daily desktop profile is not initialized.');
  for (const pkg of receipt.packages) {
    if (!semver.satisfies(version, pkg.engines, { includePrerelease: true })) {
      throw new Error(`${pkg.name} requires Desktop ${pkg.engines}; installed Desktop is ${version}.`);
    }
    assertArchive(pkg);
  }
  reserve(receipt);
  save(receipt, { desktopVersion: version });
  if (running) {
    const remaining = receipt.packages.filter(pkg => installedSource(pkg) !== `file:${pkg.tarball}`);
    if (remaining.length) {
      for (const pkg of remaining) console.log(`${pkg.name}: ${pkg.tarball}`);
      stage(receipt, '待安装', 'Desktop 正在运行。由本会话用电脑操作在插件页安装上列 tarball，启用并验收后继续。');
      process.exitCode = 2;
      return;
    }
  } else {
    const cli = join(app, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh');
    const env = { ...process.env, DSH_HOME: desktopHome };
    for (const pkg of receipt.packages) {
      if (desktopApp().running) throw new Error('Desktop opened during CLI installation. Continue from its plugin page.');
      if (installedSource(pkg) !== `file:${pkg.tarball}`) {
        run(cli, ['plugin', '--profile', 'desktop', 'add', pkg.tarball], { env, log: join(dirname(receipt.file), 'install.log') });
      }
      assertInstalled(pkg);
    }
    run('/usr/bin/open', ['-a', app]);
  }
  for (const pkg of receipt.packages) assertInstalled(pkg);
  stage(receipt, '待桌面验收', '在日常 Desktop 确认插件已启用且组件正在运行，操作本次需求的实际入口，记录结果。');
  process.exitCode = 2;
}

async function verifyCi(receipt) {
  if (receipt.workflows.length === 0) return [];
  const repo = receipt.remote.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  if (!repo) throw new Error('Cannot identify the GitHub repository from origin.');
  const endpoint = `repos/${repo}/actions/runs?branch=main&event=push&head_sha=${receipt.integrated}&per_page=100`;
  const deadline = Date.now() + 10 * 60_000;
  while (true) {
    let body;
    try {
      body = run('curl', ['--fail', '--silent', '--show-error', '--max-time', '20', `https://api.github.com/${endpoint}`]);
    } catch (error) {
      if (!/returned error: (401|403|404)/.test(error.message)) throw error;
      body = run('gh', ['api', endpoint]);
    }
    const { workflow_runs: runs } = JSON.parse(body);
    const waiting = [];
    const passed = [];
    for (const name of receipt.workflows) {
      const result = runs.find(run => run.name === name && run.head_sha === receipt.integrated);
      if (!result || result.status !== 'completed') {
        waiting.push(name);
      } else if (result.conclusion !== 'success') {
        throw new Error(`${name}: ${result.conclusion} (${result.html_url})`);
      } else {
        passed.push({ name, commit: result.head_sha, conclusion: result.conclusion, url: result.html_url });
      }
    }
    if (waiting.length === 0) return passed;
    save(receipt, { reason: `等待 GitHub Actions: ${waiting.join(', ')}`, ci: passed });
    if (Date.now() >= deadline) throw new Error(`GitHub Actions are still pending: ${waiting.join(', ')}. Retry finish to resume verification.`);
    await delay(15_000);
  }
}

async function finish(receipt, evidencePath) {
  stage(receipt, '核对远端');
  await verifyFresh(receipt);
  if (pluginsPending(receipt)) {
    if (!evidencePath && !receipt.desktop) throw new Error('Provide the observed Desktop acceptance evidence.');
    const evidence = evidencePath ? readJson(resolve(evidencePath)) : { desktop: receipt.desktop };
    stage(receipt, '核对安装');
    if (lockOwner() !== receipt.file) throw new Error('Run desktop before recording acceptance.');
    const { running, version } = desktopApp();
    if (!running || version !== receipt.desktopVersion) throw new Error('Daily Desktop must be running the version reserved for this delivery.');
    for (const pkg of receipt.packages) assertInstalled(pkg);
    stage(receipt, '启用');
    for (const pkg of receipt.packages) {
      const result = evidence.desktop?.[pkg.name];
      if (result?.enabled !== true || result?.running !== true) {
        throw new Error(`${pkg.name}: confirm the enabled switch and running component on daily Desktop.`);
      }
    }
    stage(receipt, '桌面验收');
    for (const pkg of receipt.packages) {
      const result = evidence.desktop[pkg.name];
      if (result?.result !== 'pass' ||
          typeof result?.scenario !== 'string' || !result.scenario.trim() ||
          typeof result?.observed !== 'string' || !result.observed.trim()) {
        throw new Error(`${pkg.name}: record enabled/running and the actual Desktop scenario and observed result.`);
      }
    }
    save(receipt, { desktop: evidence.desktop });
  }
  stage(receipt, '核对 CI');
  const ci = await verifyCi(receipt);
  await verifyFresh(receipt);
  for (const pkg of receipt.packages) assertInstalled(pkg);
  save(receipt, { ci });
  stage(receipt, '已交付');
  release(receipt);
}

const usage = `pnpm deliver start <已确认的任务基线提交>
pnpm deliver desktop <凭证路径>
pnpm deliver finish <凭证路径> [桌面验收证据 JSON]
pnpm deliver block <凭证路径> <阻塞原因>
pnpm deliver status <凭证路径>`;

async function main([command, arg, extra, ...rest]) {
  if (!command || command === '--help') {
    console.log(usage);
    return;
  }
  const valid = ['start', 'desktop', 'finish', 'block', 'status'].includes(command);
  if (!valid || !arg || rest.length || (command === 'block' && !extra?.trim()) ||
      (!['finish', 'block'].includes(command) && extra !== undefined)) {
    throw new Error(usage);
  }
  if (command === 'status') {
    console.log(JSON.stringify(readJson(resolve(arg)), null, 2));
    return;
  }
  let receipt;
  let commandLock;
  try {
    if (command === 'start') {
      mkdirSync(artifactRoot, { recursive: true });
      const dir = mkdtempSync(join(artifactRoot, 'delivery.'));
      receipt = { file: join(dir, 'receipt.json'), createdAt: new Date().toISOString() };
      stage(receipt, '预检');
      await prepare(receipt, arg);
      process.exitCode = 2;
      return;
    }
    const file = resolve(arg);
    if (basename(file) !== 'receipt.json' || dirname(dirname(file)) !== artifactRoot) {
      throw new Error('Use a receipt path emitted by deliver start.');
    }
    const lock = join(dirname(file), 'command.lock');
    mkdirSync(lock);
    commandLock = lock;
    receipt = readJson(file);
    if (receipt.file !== file || receipt.stage === '已交付') {
      receipt = undefined;
      throw new Error('Receipt path mismatch or delivery already completed.');
    }
    if (command === 'desktop') await install(receipt);
    if (command === 'finish') await finish(receipt, extra);
    if (command === 'block') {
      release(receipt);
      stage(receipt, receipt.stage, extra);
      process.exitCode = 1;
    }
  } catch (error) {
    if (receipt) stage(receipt, receipt.stage, error.message);
    throw error;
  } finally {
    if (commandLock) rmdirSync(commandLock);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
