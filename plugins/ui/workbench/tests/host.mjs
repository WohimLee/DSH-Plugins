import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createProbe } from './helpers/probe.mjs';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(directory, '../../..');
const cli = resolve(process.env.DSH_TEST_CLI ?? join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'dsh-workbench-host-'));
const home = join(temp, 'home');
await mkdir(home);
const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home,
  TMPDIR: process.env.TMPDIR ?? tmpdir(), SYSTEMROOT: process.env.SYSTEMROOT, CI: 'true', NO_COLOR: '1' };

function run(command, args, cwd = temp) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = data => { output = (output + data).slice(-40000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? accept(output) : reject(new Error(`${command} exited ${code}\n${output}`)); });
  });
}
const command = args => run(process.execPath, [cli, ...args]);
async function startHost(port = '0') {
  const child = spawn(process.execPath, [cli, 'web', '--port', port, '--no-open'], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-50000); });
  const closed = new Promise(accept => { child.on('close', () => { exited = true; accept(); }); });
  const stop = async () => {
    if (exited) return;
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed; clearTimeout(timer);
  };
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Web host exited:\n${log}`);
      const urls = [...log.matchAll(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/g)].map(match => new URL(match[0]));
      const url = urls.find(value => value.search) ?? urls[0];
      if (url) {
        try {
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.status < 500) return { url: url.href, stop, log: () => log };
        } catch {}
      }
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw new Error(`Web host readiness timeout:\n${log}`);
  } catch (error) { await stop(); throw error; }
}

let browser, host, page;
const consoleErrors = [];
let navigations = 0;
async function dismissSignIn() {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Get started' });
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
try {
  const runtimeVersion = (await command(['--version'])).trim();
  const artifactDir = process.env.DSH_TEST_ARTIFACT_DIR;
  if (!artifactDir) await run('pnpm', ['pack', '--pack-destination', temp], directory);
  const artifact = resolve(artifactDir ?? temp, `${pkg.name}-${pkg.version}.tgz`);
  const files = await run('tar', ['-tzf', artifact]);
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/client/index.d.ts', 'cordis.patch.yml', 'README.md']) assert.ok(files.includes(`package/${file}`), `${file} missing`);
  assert.doesNotMatch(files, /node_modules\/|auth\.json/);
  const probe = await createProbe(temp, runtimeVersion);
  await run('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', temp], probe);
  await command(['plugin', '--profile', 'web', 'add', join(temp, 'dsh-workbench-probe-0.0.0.tgz'), artifact]);
  const config = await command(['--profile', 'web', '--dump-config']);
  assert.ok(config.includes('dsh-workbench:main'));
  host = await startHost();
  browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text()); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(host.url);
  await page.locator('html[data-dsh-workbench="true"]').waitFor();
  const preview = page.getByRole('button', { name: /Continue|继续/, exact: true });
  await preview.waitFor({ state: 'visible' });
  await preview.click();
  await dismissSignIn();
  await page.locator('[data-workbench-rail]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-workbench-brand]').textContent(), 'DSH');
  const tree = page.locator('[data-workbench-tree]');
  const alpha = tree.locator('[data-row-key="session:workbench-test-alpha"]');
  const beta = tree.locator('[data-row-key="session:workbench-test-beta"]');
  const project = tree.locator('[data-wb-kind="project"]').filter({ has: page.getByRole('button', { name: 'workspace', exact: true }) });
  const child = tree.locator('[data-wb-kind="project"]').filter({ has: page.getByRole('button', { name: 'child-project', exact: true }) });
  const children = row => row.locator('xpath=following-sibling::*[1][@data-wb-project-children]');
  const projectChildren = children(project);
  const ownRows = container => container.locator(':scope > [data-wb-kind="session"]');
  await projectChildren.getByRole('button', { name: 'Show more', exact: true }).waitFor();
  assert.equal(await ownRows(projectChildren).count(), 10);
  await projectChildren.getByRole('button', { name: 'Show more', exact: true }).click();
  assert.equal(await ownRows(projectChildren).filter({ hasText: 'Workbench' }).count(), 12);
  await project.getByRole('button', { name: 'workspace', exact: true }).click();
  assert.equal(await tree.locator('[data-wb-kind="session"]').count(), 0);
  await project.getByRole('button', { name: 'workspace', exact: true }).click();
  assert.equal(await ownRows(projectChildren).count(), 10);
  await projectChildren.getByRole('button', { name: 'Show more', exact: true }).click();
  await alpha.hover();
  await alpha.getByRole('button', { name: 'Pin Chat', exact: true }).click();
  await alpha.getByRole('button', { name: 'Unpin Chat', exact: true }).waitFor();
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await alpha.getByRole('button', { name: 'Unpin Chat', exact: true }).click();
  await alpha.getByRole('button', { name: 'Pin Chat', exact: true }).waitFor();
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await writeFile(join(temp, 'activity'), 'workbench-test-extra-9');
  await ownRows(projectChildren).first().filter({ hasText: 'Workbench extra-9' }).waitFor();
  console.log('PASS real host user-message event advances the chat without inference.');
  assert.equal(await tree.getByRole('button', { name: 'New section', exact: true }).count(), 0);
  await page.locator('.wb-section-action').getByRole('button', { name: 'New section', exact: true }).click();
  await tree.getByRole('textbox', { name: 'Section name' }).waitFor();
  await page.locator('[data-workbench-rail]').getByRole('button', { name: 'Conversation', exact: true }).click();
  await tree.locator('[data-workbench-draft]').waitFor({ state: 'detached' });
  await page.locator('.wb-section-action').getByRole('button', { name: 'New section', exact: true }).click();
  await page.getByRole('textbox', { name: 'Section name' }).fill('Engineering');
  await page.getByRole('textbox', { name: 'Section name' }).press('Enter');
  const engineering = tree.locator('.wb-tree-section').filter({ has: page.getByRole('button', { name: 'Engineering', exact: true }) });
  assert.equal(await tree.locator('[data-wb-kind="section"]').first().innerText().then(x => x.trim()), 'Engineering');
  await engineering.locator('[data-wb-kind="section"]').dragTo(tree.locator('[data-workbench-tree-end]'));
  await tree.locator('[data-wb-kind="section"]').last().getByRole('button', { name: 'Engineering' }).waitFor();
  await project.dragTo(engineering.locator('[data-wb-kind="section"]'));
  await engineering.getByRole('button', { name: 'workspace', exact: true }).waitFor();
  const projectMenu = page.getByRole('menu', { name: 'Project menu', exact: true });
  await project.getByRole('button', { name: 'workspace', exact: true }).click({ button: 'right' });
  const menuLabels = await projectMenu.getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  await project.hover();
  await project.getByRole('button', { name: 'Project menu', exact: true }).click();
  assert.deepEqual(await projectMenu.getByRole('menuitem').allTextContents(), menuLabels);
  await page.keyboard.press('Escape');
  await project.hover();
  await project.getByRole('button', { name: 'Add subproject', exact: true }).click();
  const projectName = tree.getByRole('textbox', { name: 'Project name' });
  await projectName.fill('child-project');
  await projectName.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Choose working directory' });
  await picker.getByRole('textbox', { name: 'Directory path' }).fill(join(temp, 'workspace', 'child-project'));
  await picker.getByRole('button', { name: 'Use this directory' }).click();
  await projectChildren.locator('[data-wb-kind="project"]').filter({ hasText: 'child-project' }).waitFor();
  assert.equal(await projectChildren.locator(':scope > [data-wb-kind]').first().getAttribute('data-wb-kind'), 'project');
  await beta.dragTo(child);
  await children(child).locator('[data-row-key="session:workbench-test-beta"]').waitFor();
  const port = new URL(host.url).port;
  await host.stop();
  host = undefined;
  host = await startHost(port);
  await page.goto(host.url);
  await tree.waitFor();
  await dismissSignIn();
  await engineering.getByRole('button', { name: 'workspace', exact: true }).waitFor();
  await children(child).locator('[data-row-key="session:workbench-test-beta"]').waitFor();
  assert.equal(await beta.count(), 1);
  console.log('PASS project sections, nested projects, 10-row limit, pin/unpin, cross-project drag and restart persistence.');
  await page.getByRole('button', { name: 'Use native workspace list' }).click();
  await tree.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Search sessions' }).waitFor();
  await page.getByRole('button', { name: 'Use workbench project list' }).click();
  await tree.waitFor();
  await alpha.getByRole('button', { name: 'Workbench alpha', exact: true }).click();
  console.log('PASS native session alpha is selectable.');
  await alpha.locator('[aria-current="true"]').waitFor();
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  await beta.locator('[aria-current="true"]').waitFor();
  console.log('PASS switching to native session beta.');

  const guide = page.locator('[data-workbench-guide]:visible');
  const right = page.locator('[data-sidebar-right-open]');
  const summary = page.locator('[data-workbench-summary]');
  const summaryButton = page.getByRole('button', { name: 'Toggle pinned summary' });
  await summaryButton.click();
  await summary.getByText('Workbench beta', { exact: true }).waitFor();
  await summaryButton.click();
  await summary.waitFor({ state: 'detached' });
  await page.locator('[data-sidebar-right-expand]').click();
  await guide.waitFor();
  assert.equal(await guide.getByRole('button', { name: 'Changes', exact: true }).isDisabled(), true);
  assert.equal(await guide.getByRole('button', { name: 'Files', exact: true }).isEnabled(), true);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await right.locator('[data-workbench-guide] form').locator('input').click({ trial: true });
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'right-panel.png'), fullPage: true });
  }
  const omnibox = guide.getByRole('searchbox', { name: 'Search files or enter a URL' });
  await omnibox.fill('workbench-fixture');
  await omnibox.press('Enter');
  const found = guide.getByRole('button', { name: 'workbench-fixture.md' });
  await found.or(guide.getByText(/^Could not search|^No matching files/)).waitFor();
  assert.ok(await found.isVisible(), 'workspace file search must return the fixture');
  await found.click();
  const previewHeading = page.getByText('Workspace search and preview fixture', { exact: true });
  await previewHeading.waitFor();
  await right.getByRole('button', { name: 'New tab', exact: true }).click();
  await guide.waitFor();
  await right.getByRole('tab', { name: /workbench-fixture\.md/ }).click();
  await previewHeading.waitFor();
  await right.locator('[data-sidebar-right-mode="fullscreen"]:visible').click();
  await page.locator('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]').waitFor();
  await right.locator('[data-sidebar-right-mode="push"]:visible').click();
  await right.locator('[data-sidebar-right-toggle]:visible').click();
  await right.waitFor({ state: 'detached' });
  console.log('PASS right-side native tab opens a real workspace file from the guide, expands, restores and collapses; session summary uses real data.');
  await child.hover();
  await child.getByRole('button', { name: 'New session', exact: true }).click();
  await children(child).getByRole('textbox', { name: 'Session name' }).fill('New child session');
  await children(child).getByRole('textbox', { name: 'Session name' }).press('Enter');
  const createdChat = children(child).getByRole('button', { name: 'New child session', exact: true });
  await createdChat.waitFor();
  await dismissSignIn();
  await createdChat.click({ button: 'right' });
  const rowMenu = page.getByRole('menu', { name: 'Session menu', exact: true });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  await picker.getByRole('textbox', { name: 'Directory path' }).fill(join(temp, 'workspace'));
  await picker.getByRole('button', { name: 'Use this directory' }).click();
  await picker.waitFor({ state: 'detached' });
  await createdChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  assert.match(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), /[\\/]workspace$/);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.wb-section-session').getByRole('button', { name: 'New session', exact: true }).click();
  const standalone = tree.getByRole('textbox', { name: 'Session name' });
  await standalone.fill('Standalone fixture');
  await standalone.press('Enter');
  const standaloneRow = tree.locator('[data-wb-project-children="workbench:ungrouped"]').getByRole('button', { name: 'Standalone fixture', exact: true });
  await standaloneRow.waitFor();
  await dismissSignIn();
  await standaloneRow.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  assert.match(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), /workspaces[\/]standalone[\/][0-9a-f-]+$/);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await rowMenu.count(), 0);
  await host.stop();
  host = undefined;
  host = await startHost(port);
  await page.goto(host.url);
  await tree.waitFor();
  await dismissSignIn();
  await standaloneRow.waitFor();
  await createdChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  assert.match(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), /[\\/]workspace$/);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  console.log('PASS inline naming, equivalent menus, and restart persistence for edited directories and standalone Sessions.');
  await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();
  await page.waitForFunction(() => !!document.querySelector('[data-sidebar-collapsed="true"]'));
  assert.ok(await page.locator('[data-workbench-rail]').isVisible());
  await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();

  const rail = page.locator('[data-workbench-rail]');
  const homeButton = rail.getByRole('button', { name: 'Conversation', exact: true });
  const sidebar = page.locator('[data-slot="sidebar"]');
  const globalPanel = page.locator('[data-global-panel]');
  const checkToolPage = async () => {
    await tree.waitFor({ state: 'hidden' });
    await sidebar.locator('[data-slot="sidebar.session.action"]').waitFor({ state: 'hidden' });
    await globalPanel.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-side="sidebar"]:visible').count(), 0);
    assert.ok(await globalPanel.evaluate(panel => Math.abs(panel.getBoundingClientRect().left -
      panel.closest('[data-slot="root"] > div').getBoundingClientRect().left) < 2));
    assert.ok(await rail.isVisible());
  };
  assert.equal(await rail.getByRole('button', { name: 'New session', exact: true }).count(), 0);
  assert.equal(await rail.locator('.dsh-workbench-divider').count(), 0);
  for (const label of ['Plugins', 'Automation tasks']) {
    await rail.getByRole('button', { name: label, exact: true }).click();
    await checkToolPage();
    await homeButton.click();
    await tree.waitFor({ state: 'visible' });
    await children(child).locator('[data-row-key="session:workbench-test-beta"]').waitFor();
  }
  console.log('PASS Home-only sidebar and simplified rail on Plugins and Automation tasks.');
  assert.equal(await page.locator('[data-sidebar-scrollport] > nav:visible').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Toggle project sidebar' }).count(), 0);
  await rail.getByRole('button', { name: 'More panels' }).click();
  await rail.getByRole('button', { name: 'Pin to activity bar · Workbench probe' }).click();
  assert.equal(await rail.locator('[data-workbench-panel="workbench-probe"]').count(), 0);
  await rail.getByRole('button', { name: 'Workbench probe', exact: true }).click();
  await page.locator('[data-workbench-probe]').waitFor({ state: 'visible' });
  await checkToolPage();
  await rail.getByRole('button', { name: 'More panels' }).click();
  await rail.getByRole('button', { name: 'Pin to activity bar · Workbench probe' }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-workbench-panel="workbench-probe"]').click();
  await page.locator('[data-workbench-probe]').waitFor({ state: 'visible' });
  await checkToolPage();
  await page.locator('[data-workbench-rail]').getByRole('button', { name: /Conversation|对话/, exact: true }).click();
  if (await page.locator('[data-sidebar-collapsed="true"]').count()) {
    await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();
  }
  await beta.click();
  await page.setViewportSize({ width: 700, height: 900 });
  await rail.waitFor({ state: 'hidden' });
  const closedDrawer = page.locator('[data-sidebar-drawer][data-sidebar-collapsed]');
  const openDrawer = () => closedDrawer.locator('[data-sidebar-opener]').click();
  await openDrawer();
  const nativeNav = page.locator('[data-sidebar-drawer]:not([data-sidebar-collapsed]) [data-sidebar-scrollport] > nav');
  await nativeNav.getByRole('button', { name: 'Plugins', exact: true }).click();
  await globalPanel.waitFor({ state: 'visible' });
  await openDrawer();
  const homeFallback = page.locator('[data-workbench-home-fallback]');
  await homeFallback.waitFor({ state: 'visible' });
  await tree.waitFor({ state: 'hidden' });
  await sidebar.locator('[data-slot="sidebar.session.action"]').waitFor({ state: 'hidden' });
  await homeFallback.click();
  await globalPanel.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await closedDrawer.waitFor({ state: 'detached' });
  await page.locator('[data-workbench-rail]').waitFor({ state: 'visible' });
  if (await page.locator('[data-sidebar-collapsed="true"]').count()) {
    await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();
  }
  await tree.waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Session source' }).count(), 0);
  await page.locator('[data-workbench-panel="plugins"]').click();
  const enabled = page.getByRole('switch', { name: /^Enable (?:DSH Workbench|dsh-workbench)$/ });
  const beforeToggleNavigations = navigations;
  await enabled.click();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-dsh-workbench'));
  assert.equal(await page.locator('[data-workbench-rail]').count(), 0);
  assert.equal(await page.locator('style[data-dsh-workbench-style]').count(), 0);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="switch"]')].some(button => /^Enable (DSH Workbench|dsh-workbench)$/.test(button.getAttribute('aria-label') ?? '') && button.getAttribute('aria-checked') === 'false' && !button.disabled));
  await enabled.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="switch"]')].some(button => /^Enable (DSH Workbench|dsh-workbench)$/.test(button.getAttribute('aria-label') ?? '') && button.getAttribute('aria-checked') === 'true' && !button.disabled));
  await page.locator('html[data-dsh-workbench="true"]').waitFor();
  await page.locator('[data-workbench-rail]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-workbench-rail]').count(), 1);
  assert.equal(navigations, beforeToggleNavigations, 'hot disable/re-enable must not reload the page');
  await page.locator('[data-workbench-panel="workbench-probe"]').click();
  await page.locator('[data-workbench-probe]').waitFor({ state: 'visible' });
  await page.locator('[data-workbench-rail]').getByRole('button', { name: /Conversation|对话/, exact: true }).click();
  if (await page.locator('[data-sidebar-collapsed="true"]').count()) {
    await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();
  }
  await beta.click();
  console.log('PASS native plugin-manager UI hot disable/re-enable removes and restores workbench without duplicate rails, preserving external panels.');
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'workbench.png'), fullPage: true });
    console.log(`Screenshot: ${join(process.env.DSH_TEST_ARTIFACTS, 'workbench.png')}`);
  }
  assert.deepEqual(errors, []);
  assert.doesNotMatch(host.log(), /failed to (?:load|apply)|ERR_MODULE_NOT_FOUND/i);
  console.log('PASS actual Chromium UI: brand, native session switching/new session, independent rail during sidebar collapse, third-party panel and narrow fallback (synthetic history, no model request).');
  await host.stop(); host = undefined;
  await command(['plugin', '--profile', 'web', 'remove', pkg.name]);
  const removed = await command(['--profile', 'web', '--dump-config']);
  assert.ok(!removed.includes('dsh-workbench:main'));
  assert.ok(removed.includes('dsh-workbench-probe:main'));
  host = await startHost();
  await page.goto(host.url);
  await page.locator('[data-slot="sidebar.workspaces"]').waitFor({ state: 'visible' });
  await dismissSignIn();
  assert.equal(await page.locator('html[data-dsh-workbench]').count(), 0);
  assert.equal(await page.locator('[data-workbench-rail]').count(), 0);
  await page.locator('[data-row-key="session:workbench-test-alpha"]').click();
  await page.waitForFunction(() => document.querySelector('[data-row-key="session:workbench-test-alpha"]')?.getAttribute('aria-selected') === 'true');
  assert.deepEqual(errors, []);
  console.log('PASS removal/restart restores native sidebar and session navigation while preserving third-party plugin.');
  console.log(`DSH: ${runtimeVersion}; Browser: ${browser.version()}`);
} catch (error) {
  if (page) console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
  if (process.env.DSH_TEST_ARTIFACTS && page) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'failure.png'), fullPage: true });
    const debug = { error: error.message, navigations, consoleErrors, switches: await page.getByRole('switch').evaluateAll(nodes => nodes.map(node => ({ label: node.getAttribute('aria-label'), checked: node.getAttribute('aria-checked'), disabled: node.disabled }))), text: await page.locator('body').innerText(), host: host?.log() };
    await writeFile(join(process.env.DSH_TEST_ARTIFACTS, 'failure.json'), JSON.stringify(debug, null, 2).replace(/([?&]token=)[^\s&"\\]+/g, '$1[redacted]'));
  }
  if (host) console.error(host.log().slice(-5000).replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'));
  throw error;
} finally {
  await browser?.close();
  await host?.stop();
  await rm(temp, { recursive: true, force: true });
}
