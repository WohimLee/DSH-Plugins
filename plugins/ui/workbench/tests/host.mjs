import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
// Exercise the in-app directory browser rather than opening an OS picker from headless Chrome.
const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home,
  SSH_CONNECTION: '127.0.0.1 1 127.0.0.1 2',
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
const recordMessage = (id, text) => writeFile(join(temp, 'activity'), JSON.stringify({ id, text }));
async function startHost(port = '0', patch) {
  const child = spawn(process.execPath, [cli, 'web', ...(patch ? ['--patch', patch] : []), '--port', port, '--no-open'],
    { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const searchPatch = join(temp, 'search.patch.yml');
  await writeFile(searchPatch, "- id: session-query-sqlite\n  config:\n    path: ':memory:'\n    openAt: first-search\n");
  host = await startHost('0', searchPatch);
  browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }, locale: 'en-US', colorScheme: 'dark',
    deviceScaleFactor: process.env.DSH_TEST_ARTIFACTS ? 2 : 1,
  });
  await page.addInitScript(() => {
    const key = 'dsh-workbench:workspace-tree:v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      sections: [{ id: 'section:projects', title: 'Previously renamed section' }],
    }));
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text()); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const changedPaths = [
    'plugins/ui/workbench/src/client/messages.ts',
    'plugins/ui/workbench/src/client/workspace/EditProjectDialog.tsx',
    'plugins/ui/workbench/src/client/appearance/workspace.ts',
    'docs/plugins.md',
    'docs/work.md',
  ];
  const changedFilesFixture = changedPaths.map((path, index) => ({
    path, display: path, added: index === 0 ? 18 : 1, deleted: index === 0 ? 2 : 0,
  }));
  await page.route('**/api/changes.summary?sessionId=workbench-test-alpha&*', route => route.fulfill({
    json: { turn: 1, files: changedFilesFixture, total: 5, added: 22, deleted: 2 },
  }));
  await page.route('**/api/changes.diff?sessionId=workbench-test-alpha&*', route => route.fulfill({
    json: { ...changedFilesFixture[0], kind: 'text', before: true, after: true, coarse: false, hunks: [
      { oldStart: 32, oldLines: 2, newStart: 32, newLines: 2, lines: [
        ' archiveChats', '-Remove project', '+Remove project and sessions',
      ] },
    ] },
  }));
  await page.goto(host.url);
  await page.locator('html[data-dsh-workbench="true"]').waitFor();
  const preview = page.getByRole('button', { name: /Continue|继续/, exact: true });
  await preview.waitFor({ state: 'visible' });
  await preview.click();
  await dismissSignIn();
  await page.locator('[data-workbench-rail]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-workbench-brand]').textContent(), 'DSH');
  const tree = page.locator('[data-workbench-tree]');
  const recents = tree.locator('[data-row-key="section:projects"]');
  const recentsLabel = recents.getByRole('button', { name: 'Recents', exact: true });
  await recentsLabel.click({ button: 'right' });
  assert.equal(await page.getByRole('menu', { name: 'Section menu' }).count(), 0);
  assert.deepEqual(await recents.locator('.wb-tree-action').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))),
    ['Add project', 'New session']);
  const alpha = tree.locator('[data-row-key="session:workbench-test-alpha"]');
  const beta = tree.locator('[data-row-key="session:workbench-test-beta"]');
  const project = tree.locator('[data-wb-kind="project"]').filter({ has: page.getByRole('button', { name: 'workspace', exact: true }) });
  const child = tree.locator('[data-wb-kind="project"]').filter({ has: page.getByRole('button', { name: 'child-project', exact: true }) });
  const header = page.locator('[data-window-drag]').filter({ has: page.locator('[data-workbench-brand]') });
  const sidebarAction = page.locator('.wb-section-session');
  const newSection = sidebarAction.getByRole('button', { name: 'New Section', exact: true });
  const searchSessions = header.getByRole('button', { name: 'Search sessions', exact: true });
  await header.getByRole('button', { name: 'View activity' }).waitFor();
  await searchSessions.waitFor();
  await newSection.waitFor();
  assert.equal(await header.getByRole('button', { name: 'New Section', exact: true }).count(), 0);
  assert.equal(await sidebarAction.getByRole('button', { name: 'New session', exact: true }).count(), 0);
  await page.mouse.move(1200, 400);
  const titleBounds = row => row.locator('.wb-tree-label > span').first().boundingBox();
  const projectTitleBounds = await titleBounds(project);
  const chatTitleBounds = await titleBounds(alpha);
  assert.ok(Math.abs(projectTitleBounds.x - chatTitleBounds.x) <= 1, 'project and child chat share a text column');
  const treeWidths = await tree.evaluate(el => ({ content: el.scrollWidth, viewport: el.clientWidth }));
  assert.equal(treeWidths.content, treeWidths.viewport, 'idle row actions must not add a horizontal scrollbar');
  const sidebarGeometry = () => tree.evaluate(el => {
    const column = el.closest('[data-slot="sidebar"]').parentElement;
    const rail = document.querySelector('[data-workbench-rail]').getBoundingClientRect();
    const sidebar = column.getBoundingClientRect();
    const main = column.nextElementSibling.getBoundingClientRect();
    const handle = column.parentElement.querySelector('[data-side="sidebar"]').getBoundingClientRect();
    return [rail.width, sidebar.width, main.x, handle.x];
  });
  assert.deepEqual(await sidebarGeometry(), [52, 283.5, 335.5, 335.5], 'default expanded sidebar and drag handle at 100%');
  await page.mouse.move(339.5, 200);
  await page.mouse.down();
  await page.mouse.move(359.5, 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-side="sidebar"]').style.left === '300px');
  assert.deepEqual(await sidebarGeometry(), [52, 303.5, 355.5, 355.5], 'drag moves the sidebar and separator by the same amount');
  await page.mouse.move(359.5, 200);
  await page.mouse.down();
  await page.mouse.move(339.5, 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-side="sidebar"]').style.left === '280px');
  for (const row of [project, alpha]) {
    assert.deepEqual(await row.locator('.wb-tree-label').evaluate(label => {
      const style = getComputedStyle(label);
      return [style.fontSize, style.lineHeight, label.getBoundingClientRect().height];
    }), ['13.5px', '20px', 31]);
  }
  const restWidth = (await alpha.locator('.wb-tree-label').boundingBox()).width;
  await alpha.hover();
  const hoverWidth = (await alpha.locator('.wb-tree-label').boundingBox()).width;
  assert.ok(restWidth > hoverWidth, 'inactive rows give trailing action space back to the title');
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
  const archive = tree.locator('[data-workbench-archived]');
  async function checkMenuDensity(name, groups) {
    const menu = page.getByRole('menu', { name: name + ' menu', exact: true });
    await menu.waitFor();
    const density = await menu.evaluate(element => {
      const buttons = [...element.querySelectorAll('button')];
      const first = getComputedStyle(buttons[0]);
      const area = element.getBoundingClientRect();
      const bounds = buttons.map(button => button.getBoundingClientRect());
      return {
        fontSize: first.fontSize,
        lineHeight: first.lineHeight,
        rowHeights: [...new Set(bounds.map(rect => rect.height))],
        rowSteps: [...new Set(bounds.slice(1).map((rect, index) => rect.y - bounds[index].y))].sort((a, b) => a - b),
        outerInsets: [bounds[0].top - area.top, area.bottom - bounds.at(-1).bottom],
        groups: element.querySelectorAll('hr').length,
      };
    });
    assert.deepEqual(density, {
      fontSize: '13px', lineHeight: '16px', rowHeights: [24], rowSteps: [24, 35],
      outerInsets: [5, 5], groups,
    }, name + ' menu density at 100%');
    if (process.env.DSH_TEST_ARTIFACTS) {
      await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
      await menu.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, name.toLowerCase() + '-menu.png') });
    }
  }
  const archiveLabel = archive.getByRole('button', { name: 'Archived', exact: true });
  assert.equal(await recents.locator('..').locator('xpath=following-sibling::*[1]').getAttribute('data-workbench-archived'), 'true');
  await archiveLabel.click({ button: 'right' });
  assert.equal(await page.getByRole('menu', { name: 'Section menu' }).count(), 0);
  await alpha.click({ button: 'right' });
  await checkMenuDensity('Session', 4);
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  const archivedAlpha = archive.locator('[data-row-key="archived:workbench-test-alpha"]');
  await archivedAlpha.waitFor();
  await alpha.waitFor({ state: 'detached' });
  await archiveLabel.click();
  await archivedAlpha.waitFor({ state: 'detached' });
  await archiveLabel.click();
  await archivedAlpha.hover();
  await archivedAlpha.getByRole('button', { name: 'Unarchive session' }).click();
  await archivedAlpha.waitFor({ state: 'detached' });
  await alpha.waitFor();
  console.log('PASS fixed Archived section and host archive/restore round trip.');
  await alpha.hover();
  const alphaActions = () => alpha.locator('.wb-tree-action').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect().x));
  const readPositions = await alphaActions();
  await alpha.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  const unreadMark = alpha.locator(':scope > .wb-status-unread');
  await page.mouse.move(900, 200);
  await unreadMark.waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'sidebar-unread.png') });
  await alpha.hover();
  await unreadMark.waitFor({ state: 'hidden' });
  assert.deepEqual(await alphaActions(), readPositions);
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'sidebar-unread-hover.png') });
  await page.mouse.move(900, 200);
  await unreadMark.waitFor();
  const bell = page.getByRole('button', { name: 'View activity' });
  await bell.locator('.wb-status-unread').waitFor();
  await bell.click();
  const activity = page.locator('[data-workbench-activity-list]');
  const priority = activity.locator('section').filter({ has: page.getByRole('heading', { name: 'Priority' }) });
  await priority.getByText('Activity preview fixture', { exact: true }).waitFor();
  await priority.getByRole('button', { name: /Workbench alpha/i }).click();
  await bell.locator('.wb-status-unread').waitFor({ state: 'detached' });
  await bell.click();
  await alpha.waitFor();
  assert.equal(await alpha.locator('.wb-status-unread').count(), 0);
  console.log('PASS unread hover preserves action positions, activity bell, unread priority and open acknowledgement.');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(host.url).origin });
  await alpha.click({ button: 'right' });
  const alphaMenu = page.getByRole('menu', { name: 'Session menu', exact: true });
  const renameWithShortcut = alphaMenu.getByRole('menuitem', { name: 'Rename', exact: true });
  const renameShortcut = await renameWithShortcut.getAttribute('aria-keyshortcuts');
  assert.ok(renameShortcut);
  assert.equal(await renameWithShortcut.locator('svg').count(), 1);
  await renameWithShortcut.press('Escape');
  await page.keyboard.press(renameShortcut);
  const shortcutRename = page.getByRole('dialog', { name: 'Rename session', exact: true });
  await shortcutRename.waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await shortcutRename.waitFor({ state: 'detached' });
  await alpha.click({ button: 'right' });
  const copyItem = alphaMenu.getByRole('menuitem', { name: 'Copy', exact: true });
  const moveItem = alphaMenu.getByRole('menuitem', { name: 'Move session', exact: true });
  await moveItem.hover();
  const moveMenu = page.getByRole('menu', { name: 'Move session', exact: true });
  await moveMenu.waitFor();
  await copyItem.hover();
  await moveMenu.waitFor({ state: 'detached' });
  const copyMenu = page.getByRole('menu', { name: 'Copy', exact: true });
  await copyMenu.waitFor();
  const [parentBounds, copyBounds] = await Promise.all([alphaMenu.boundingBox(), copyMenu.boundingBox()]);
  assert.ok(copyBounds.x > parentBounds.x + parentBounds.width - 10, 'hover opens Copy next to the visible parent');
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'session-copy-submenu.png') });
  assert.equal(await copyMenu.getByRole('menuitem', { name: 'Copy session link' }).isDisabled(), true);
  await copyMenu.getByRole('menuitem', { name: 'Copy working directory' }).click();
  await page.waitForFunction(async expected => await navigator.clipboard.readText() === expected, join(temp, 'workspace'));
  await alpha.click({ button: 'right' });
  await copyItem.focus();
  await copyItem.press('ArrowRight');
  const markdownCopy = copyMenu.getByRole('menuitem', { name: 'Copy as Markdown' });
  assert.equal(await markdownCopy.evaluate(button => document.activeElement === button), true);
  await markdownCopy.press('ArrowLeft');
  await copyMenu.waitFor({ state: 'detached' });
  assert.equal(await copyItem.evaluate(button => document.activeElement === button), true);
  await copyItem.press('ArrowRight');
  await markdownCopy.click();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('Activity preview fixture'));
  console.log('PASS icons, effective shortcut hints, flyout mouse and keyboard, and clipboard contents.');
  await alpha.hover();
  const pinChat = alpha.getByRole('button', { name: 'Pin Chat', exact: true });
  const unpinChat = alpha.getByRole('button', { name: 'Unpin Chat', exact: true });
  const pinShape = button => button.locator('svg path').evaluate(path => {
    const style = getComputedStyle(path);
    return { path: path.getAttribute('d'), fill: style.fill, stroke: style.stroke, color: style.color };
  });
  const outline = await pinShape(pinChat);
  assert.equal(outline.fill, 'none');
  assert.equal(outline.stroke, outline.color);
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'sidebar-unpinned.png') });
  await pinChat.click();
  await unpinChat.waitFor();
  assert.equal(await unpinChat.getAttribute('aria-pressed'), 'true');
  const solid = await pinShape(unpinChat);
  assert.notEqual(solid.path, outline.path);
  assert.equal(solid.fill, solid.color);
  assert.equal(solid.stroke, 'none');
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await page.mouse.move(1200, 400);
  await unpinChat.blur();
  assert.equal(await unpinChat.evaluate(button => getComputedStyle(button).opacity), '1');
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'sidebar-pinned.png') });
  const pinnedX = await unpinChat.evaluate(button => button.getBoundingClientRect().x);
  await alpha.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await page.mouse.move(900, 200);
  await unreadMark.waitFor();
  assert.equal(await unpinChat.evaluate(button => button.getBoundingClientRect().x), pinnedX);
  await alpha.hover();
  await unreadMark.waitFor({ state: 'hidden' });
  assert.equal(await unpinChat.evaluate(button => button.getBoundingClientRect().x), pinnedX);
  await alpha.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as read' }).click();
  await unpinChat.click();
  await alpha.hover();
  await pinChat.waitFor();
  assert.equal(await pinChat.getAttribute('aria-pressed'), 'false');
  const restored = await pinShape(pinChat);
  assert.equal(restored.path, outline.path);
  assert.equal(restored.fill, 'none');
  assert.equal(restored.stroke, restored.color);
  console.log('PASS pin icon switches from outline to solid and back when unpinned.');
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await recordMessage('workbench-test-extra-9', 'Synthetic activity event');
  await ownRows(projectChildren).first().filter({ hasText: 'Workbench extra-9' }).waitFor();
  console.log('PASS real host user-message event advances the chat without inference.');
  const searchDialog = page.getByRole('dialog', { name: 'Search sessions', exact: true });
  const query = searchDialog.getByRole('searchbox', { name: 'Search sessions' });
  await searchSessions.click();
  await query.waitFor();
  assert.equal(await query.evaluate(input => input === document.activeElement), true);
  await query.fill('Review the edited files');
  await searchDialog.getByRole('button', { name: /Workbench alpha/ }).waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'session-search.png') });
  await query.fill('No session matches 9d64c3');
  await searchDialog.getByText('No matching sessions.', { exact: true }).waitFor();
  await query.press('Escape');
  await searchDialog.waitFor({ state: 'detached' });
  assert.equal(await searchSessions.evaluate(button => button === document.activeElement), true);
  await searchSessions.click();
  await query.waitFor();
  await page.mouse.click(1200, 400);
  await searchDialog.waitFor({ state: 'detached' });
  await searchSessions.click();
  await query.fill('workbench beta');
  await searchDialog.getByRole('button', { name: /Workbench beta/ }).waitFor();
  await query.press('Enter');
  await searchDialog.waitFor({ state: 'detached' });
  await beta.locator('[aria-current="true"]').waitFor();
  await alpha.getByRole('button', { name: 'Workbench alpha', exact: true }).click();
  console.log('PASS sidebar search opens content and title matches, handles no match, and restores focus on dismissal.');
  assert.equal(await tree.getByRole('button', { name: 'New Section', exact: true }).count(), 0);
  await newSection.click();
  await tree.getByRole('textbox', { name: 'Section name' }).waitFor();
  await page.locator('[data-workbench-rail]').getByRole('button', { name: 'Conversation', exact: true }).click();
  await tree.locator('[data-workbench-draft]').waitFor({ state: 'detached' });
  await newSection.click();
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
  await checkMenuDensity('Project', 3);
  const menuLabels = await projectMenu.getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  await project.hover();
  await project.getByRole('button', { name: 'Project menu', exact: true }).click();
  assert.deepEqual(await projectMenu.getByRole('menuitem').allTextContents(), menuLabels);
  assert.equal(await projectMenu.getByRole('separator').count(), 3);
  await projectMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const projectEditor = page.getByRole('dialog', { name: 'Edit project', exact: true });
  const projectTitle = projectEditor.getByRole('textbox', { name: 'Project name' });
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await projectEditor.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'edit-project.png') });
  }
  const folderRow = projectEditor.locator('.wb-folder-row').first();
  await folderRow.hover();
  const tooltip = folderRow.getByRole('tooltip');
  await tooltip.waitFor();
  assert.equal(await tooltip.textContent(), await realpath(join(temp, 'workspace')));
  await projectTitle.hover();
  await tooltip.waitFor({ state: 'hidden' });
  await projectTitle.fill('Discard me');
  await projectEditor.getByRole('button', { name: /^Remove folder/ }).click();
  await page.mouse.click(5, 5);
  await projectEditor.waitFor({ state: 'detached' });
  await project.click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  assert.equal(await projectTitle.inputValue(), 'workspace');
  await projectEditor.getByRole('button', { name: /^Remove folder/ }).waitFor();
  await projectEditor.getByRole('button', { name: 'Add folder' }).click();
  const folderPicker = page.getByRole('dialog', { name: 'Choose working directory' });
  await folderPicker.getByRole('textbox').fill(join(temp, 'workspace', 'child-project'));
  await folderPicker.getByRole('button', { name: 'Use this directory' }).click();
  await projectTitle.fill('Renamed workspace');
  await projectEditor.getByRole('button', { name: 'Save' }).click();
  await tree.getByRole('button', { name: 'Renamed workspace', exact: true }).click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  assert.equal(await projectTitle.inputValue(), 'Renamed workspace');
  await projectTitle.fill('workspace');
  await projectEditor.getByRole('button', { name: 'Save' }).click();
  await projectEditor.waitFor({ state: 'detached' });
  await project.click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Section' }).click();
  await page.getByRole('menu', { name: 'Section', exact: true }).getByRole('menuitem', { name: 'Recents', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await project.hover();
  await project.getByRole('button', { name: 'Add subproject', exact: true }).click();
  const createProject = page.getByRole('dialog', { name: 'Create project', exact: true });
  const projectName = createProject.getByRole('textbox', { name: 'Project name' });
  const createButton = createProject.getByRole('button', { name: 'Create project', exact: true });
  const picker = page.getByRole('dialog', { name: 'Choose working directory' });
  const chooseFolder = async path => {
    await picker.getByRole('textbox', { name: 'Directory path' }).fill(path);
    await picker.getByRole('button', { name: 'Use this directory' }).click();
    await picker.waitFor({ state: 'detached' });
  };
  const addRoot = async path => {
    await createProject.getByRole('button', { name: 'Add', exact: true }).click();
    await chooseFolder(path);
  };
  assert.equal(await projectName.evaluate(input => document.activeElement === input), true);
  assert.equal(await tree.locator('[data-workbench-draft]').count(), 0);
  assert.equal(await createButton.isDisabled(), true);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await createProject.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'create-project.png') });
  }
  await projectName.fill('child-project');
  assert.equal(await createButton.isDisabled(), true);
  await addRoot(join(temp, 'workspace'));
  await createButton.click();
  await createProject.getByRole('alert').filter({ hasText: 'A project already uses this working folder.' }).waitFor();
  await createProject.getByRole('button', { name: /^Remove folder/ }).click();
  await addRoot(join(temp, 'workspace', 'child-project'));
  await createButton.click();
  await createProject.waitFor({ state: 'detached' });
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
  const accountMenu = page.locator('[data-slot="settings.launcher"] button[aria-haspopup="menu"]');
  const toggleView = page.getByRole('button', { name: 'Use native workspace list' });
  const railBounds = await page.locator('[data-workbench-rail]').boundingBox();
  for (const control of [toggleView, accountMenu]) {
    const bounds = await control.boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - railBounds.x - railBounds.width / 2) < 2,
      'wide layout centers both footer actions on the activity rail');
  }
  await accountMenu.click();
  await page.getByRole('menuitem', { name: /Settings/ }).waitFor();
  await page.keyboard.press('Escape');
  await toggleView.click();
  await tree.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Search sessions' }).waitFor();
  await page.getByRole('button', { name: 'Use workbench project list' }).click();
  await tree.waitFor();
  await alpha.getByRole('button', { name: 'Workbench alpha', exact: true }).click();
  console.log('PASS native session alpha is selectable.');
  await alpha.locator('[aria-current="true"]').waitFor();
  const sessionHeader = page.locator('[data-slot="conversation.session.header"] nav').getByText('Workbench alpha', { exact: true });
  assert.equal(await sessionHeader.evaluate(title => getComputedStyle(title).fontSize), '12.5px');
  const paragraph = page.locator('[data-conversation-content]').getByText('Activity preview fixture', { exact: true });
  assert.deepEqual(await paragraph.evaluate(text => {
    const measure = () => {
      const style = getComputedStyle(text);
      return [style.fontSize, style.lineHeight];
    };
    const baseline = measure();
    const themeSize = '--dsh-content-font-size';
    const bodyStyle = document.body.style;
    const previous = bodyStyle.getPropertyValue(themeSize);
    bodyStyle.setProperty(themeSize, '15px');
    try {
      return [baseline, measure()];
    } finally {
      if (previous) bodyStyle.setProperty(themeSize, previous);
      else bodyStyle.removeProperty(themeSize);
    }
  }), [['13px', '24px'], ['13px', '24px']], '100% uses the same message size with the Desktop text preference');
  const bubble = page.locator('[data-message-bubble]').filter({ hasText: 'Review the edited files' });
  const darkTheme = page.locator('body[data-ds-dark-theme]');
  const bubbleFill = () => bubble.evaluate(node => getComputedStyle(node).backgroundColor);
  await darkTheme.waitFor({ state: 'attached' });
  assert.equal(await bubbleFill(), 'rgb(14, 48, 116)');
  await page.emulateMedia({ colorScheme: 'light' });
  await darkTheme.waitFor({ state: 'detached' });
  assert.equal(await bubbleFill(), 'rgb(237, 243, 254)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await darkTheme.waitFor({ state: 'attached' });
  const theme = await page.addStyleTag({ content: 'body { --dsh-content-font-size: 15px !important; --dsh-code-font-size: 15px !important; }' });
  const composer = page.locator('[data-composer-card]');
  const draft = composer.locator('[data-composer-input]');
  const placeholder = composer.locator('[data-composer-placeholder]');
  const typography = node => {
    const { fontSize, lineHeight } = getComputedStyle(node);
    return [fontSize, lineHeight];
  };
  assert.deepEqual(await placeholder.evaluate(typography), ['13.5px', '24px']);
  await draft.fill('输入框部分的字体也是，codex的比较小，dsh很大');
  await draft.press('Shift+Enter');
  await page.keyboard.insertText('第二行输入文字');
  const draftLines = await draft.evaluate(node => {
    const textNodes = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const tops = new Set();
    for (let text; (text = textNodes.nextNode());) {
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(rect.top);
    }
    return [...tops];
  });
  assert.equal(draftLines.length, 2);
  assert.equal(draftLines[1] - draftLines[0], 24);
  assert.deepEqual(await draft.evaluate(typography), ['13.5px', '24px']);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await composer.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'composer-typography.png') });
    await bubble.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'user-message-bubble.png') });
  }
  await draft.fill('');
  await placeholder.waitFor();
  const changedFiles = page.locator('[data-changed-files]');
  const changesTitle = changedFiles.getByText('Edited 5 files', { exact: true });
  const changesTotal = changedFiles.getByText('+22', { exact: true });
  const changedRows = changedFiles.getByRole('listitem');
  const firstFile = changedRows.first().getByRole('button');
  const fold = changedFiles.getByRole('button', { name: 'Show all 5 changed files' });
  assert.deepEqual(await changesTitle.evaluate(typography), ['14px', '20px']);
  assert.deepEqual(await changesTotal.evaluate(typography), ['13px', '18px']);
  assert.deepEqual(await firstFile.getByText(changedPaths[0], { exact: true }).evaluate(typography), ['14px', '22px']);
  assert.deepEqual(await firstFile.getByText('+18', { exact: true }).evaluate(typography), ['13px', '22px']);
  assert.equal((await firstFile.boundingBox()).height, 36);
  assert.equal((await fold.evaluate(typography))[0], '14px');
  assert.equal(await changedRows.count(), 4);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await changedFiles.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'edited-files-typography.png') });
  }
  await fold.click();
  assert.equal(await changedRows.count(), 5);
  await changedFiles.getByRole('button', { name: 'Collapse changed files', exact: true }).click();
  assert.equal(await changedRows.count(), 4);
  await firstFile.hover();
  const hoverDiff = page.locator('[data-changes-hover-preview]');
  const contextRow = hoverDiff.locator('[data-diff-line="context"]');
  await contextRow.getByText('archiveChats', { exact: true }).waitFor();
  assert.deepEqual(await contextRow.getByText('archiveChats', { exact: true }).evaluate(typography), ['12px', '22px']);
  assert.deepEqual(await contextRow.getByText('32', { exact: true }).first().evaluate(typography), ['12px', '22px']);
  assert.equal((await contextRow.boundingBox()).height, 22);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await hoverDiff.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'hover-diff-typography.png') });
  }
  await page.mouse.move(100, 100);
  await hoverDiff.waitFor({ state: 'detached' });
  await theme.evaluate(node => node.remove());
  console.log('PASS composer, Edited files card and hover diff typography at 100% with 15px host preferences, plus dark and light user bubbles.');
  const tabs = page.locator('[data-conversation-tabs]');
  await tabs.getByRole('tab', { name: 'Trajectory' }).click();
  await tabs.getByRole('tab', { name: 'Chat', exact: true }).click();
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  await beta.locator('[aria-current="true"]').waitFor();
  console.log('PASS switching to native session beta.');

  await recordMessage('running-fixture', 'running');
  const spinner = beta.getByRole('img', { name: 'Running', exact: true });
  await spinner.waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) {
    await beta.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'running-session.png'), animations: 'disabled' });
  }
  assert.deepEqual(await spinner.evaluate(element => {
    const style = getComputedStyle(element);
    return [element.localName, element.querySelector('circle')?.getAttribute('r'), style.width, style.height, style.animationName];
  }), ['svg', '5', '11px', '11px', 'wb-spin']);
  await bell.click();
  const activitySpinner = activity.getByRole('button', { name: /Workbench beta/ }).getByRole('img', { name: 'Running', exact: true });
  await activitySpinner.waitFor();
  assert.equal(await activitySpinner.locator('circle').count(), 2);
  await recordMessage('running-fixture', 'idle');
  await activitySpinner.waitFor({ state: 'detached' });
  await bell.click();
  await tree.waitFor();
  console.log('PASS circular running indicator in the project and activity lists.');


  const guide = page.locator('[data-workbench-guide]:visible');
  const right = page.locator('[data-sidebar-right-open]');
  const summary = page.locator('[data-workbench-summary]');
  await recordMessage('subagent-fixture', 'running');
  const summaryButton = page.getByRole('button', { name: 'Toggle pinned summary' });
  const summaryComposer = page.locator('[data-conversation-content] [data-composer-card]');
  const summaryScroll = page.locator('[data-conversation-content] [data-conversation-scroll]');
  const closedComposer = await summaryComposer.boundingBox();
  const closedScroll = await summaryScroll.boundingBox();
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-closed.png') });
  await summaryButton.click();
  const summaryFolder = summary.getByRole('button', { name: join(temp, 'workspace', 'child-project'), exact: true });
  await summaryFolder.waitFor();
  assert.equal(await summaryFolder.innerText(), 'child-project');
  assert.equal(await summaryFolder.getAttribute('title'), join(temp, 'workspace', 'child-project'));
  assert.equal(await summary.getByRole('heading', { name: 'Created chats' }).count(), 0);
  assert.deepEqual(await summary.evaluate(element => {
    const heading = getComputedStyle(element.querySelector('h2'));
    const changes = getComputedStyle(element.querySelector('.wb-summary-changes'));
    return [heading.fontSize, heading.fontWeight, changes.fontSize, changes.lineHeight];
  }), ['13px', '400', '14px', '20px']);
  const openedPanel = await summary.boundingBox();
  const openedScroll = await summaryScroll.boundingBox();
  const openedComposer = await summaryComposer.boundingBox();
  assert.ok(openedComposer.x < closedComposer.x - 100, 'the wide chat composer moves left');
  assert.ok(Math.abs(openedComposer.width - closedComposer.width) < 1, 'the wide chat composer keeps its width');
  assert.ok(openedScroll.x + openedScroll.width <= openedPanel.x, 'the wide summary clears the message scrollport');
  assert.equal(await right.count(), 0, 'opening Summary does not open the native tool panel');
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-open-wide.png') });
  await page.keyboard.press('Escape');
  await summary.waitFor({ state: 'detached' });
  assert.ok(await summaryButton.evaluate(element => element === document.activeElement));
  assert.ok(Math.abs((await summaryScroll.boundingBox()).width - closedScroll.width) < 1);
  await page.setViewportSize({ width: 1180, height: 1000 });
  // Allow the frame's ResizeObserver to publish the new host column width.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const narrowComposer = await summaryComposer.boundingBox();
  await summaryButton.click();
  await summaryFolder.waitFor();
  const narrowPanel = await summary.boundingBox();
  const narrowOpenedComposer = await summaryComposer.boundingBox();
  assert.ok(Math.abs(narrowOpenedComposer.x - narrowComposer.x) < 1,
    `the narrow summary leaves the composer in place (${narrowComposer.x} → ${narrowOpenedComposer.x})`);
  assert.ok(narrowPanel.x >= 0 && narrowPanel.x + narrowPanel.width <= 1180, 'the narrow summary fits in the window');
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-open-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await summary.getByRole('button', { name: 'Subagents' }).getByText(/\b1 Active\b/).waitFor();
  await summary.getByRole('button', { name: 'Subagents' }).click();
  const agents = right.locator('.wb-agent-list');
  await agents.getByRole('heading', { name: 'Active · 1' }).waitFor();
  await agents.getByRole('button', { name: /Inspect workbench fixture/ }).waitFor();
  await recordMessage('subagent-fixture', 'done');
  await agents.getByRole('heading', { name: 'Done · 1' }).waitFor();
  assert.equal(await tree.locator('[data-row-key="session:workbench-child-record"]').count(), 0,
    'child records belong in the parent panel and stay out of ordinary session rows');
  if (process.env.DSH_TEST_ARTIFACTS) await right.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'subagents.png') });
  await agents.getByRole('button', { name: /Inspect workbench fixture/ }).click();
  await right.locator('.wb-agent-conversation').getByText('Inspect the sample directory', { exact: true }).waitFor();
  await right.locator('.wb-agent-detail header').getByText('Fixture model · high').waitFor();
  await right.locator('.wb-agent-conversation strong').filter({ hasText: 'Directory checked' }).waitFor();
  await right.locator('.wb-agent-detail summary').click();
  await right.locator('.wb-agent-detail details[open] time').waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await right.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'subagent-record.png') });
  await right.getByRole('button', { name: 'Back', exact: true }).click();
  await agents.getByRole('button', { name: /Inspect workbench fixture/ }).waitFor();
  await agents.getByRole('button', { name: /Inspect workbench fixture/ }).click();
  await right.locator('.wb-agent-detail').getByRole('heading', { name: 'Inspect workbench fixture' }).waitFor();
  await alpha.getByRole('button', { name: 'Workbench alpha', exact: true }).click();
  await right.locator('.wb-agent-detail').waitFor({ state: 'hidden' });
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  await summaryButton.click();
  await summary.getByRole('button', { name: 'Subagents' }).click();
  await agents.getByRole('button', { name: /Inspect workbench fixture/ }).waitFor();
  await right.getByRole('button', { name: 'New tab', exact: true }).click();
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
  const conversation = page.locator('[data-conversation-content]');
  const editor = page.locator('[data-composer-seat] [contenteditable="true"]');
  const openDraft = async (trigger, previousId) => {
    await trigger.click();
    const handle = await page.waitForFunction(previous => {
      const id = document.querySelector('[data-conversation-content]')?.getAttribute('data-conversation-session');
      return id && id !== previous ? id : null;
    }, previousId);
    const id = await handle.jsonValue();
    await dismissSignIn();
    await editor.waitFor();
    assert.equal(await tree.locator(`[data-row-key="session:${id}"]`).count(), 0);
    assert.equal(await tree.getByRole('textbox', { name: 'Session name' }).count(), 0);
    return id;
  };
  const childNewSession = child.getByRole('button', { name: 'New session', exact: true });
  await child.hover();
  const childDraft = await openDraft(childNewSession, await conversation.getAttribute('data-conversation-session'));
  await editor.fill('New child session');
  assert.equal(await ownRows(children(child)).count(), 1, 'typing leaves the draft out of the sidebar');
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  await child.hover();
  assert.equal(await openDraft(childNewSession, 'workbench-test-beta'), childDraft, 'reopening reuses the unsent draft');
  assert.equal(await editor.innerText(), 'New child session');
  await recordMessage(childDraft, 'New child session');
  const createdRow = children(child).locator(`[data-row-key="session:${childDraft}"]`);
  const createdChat = createdRow.getByRole('button', { name: 'New child session', exact: true });
  await createdChat.waitFor();
  assert.equal(await ownRows(children(child)).first().getAttribute('data-row-key'), 'session:' + childDraft);
  await createdChat.click({ button: 'right' });
  const rowMenu = page.getByRole('menu', { name: 'Session menu', exact: true });
  await rowMenu.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename session', exact: true });
  const title = rename.getByRole('textbox', { name: 'Session name' });
  assert.equal(await title.inputValue(), 'New child session');
  assert.equal(await title.evaluate(input => document.activeElement === input && input.selectionStart === 0 &&
    input.selectionEnd === input.value.length), true);
  await title.fill('Discarded name');
  await title.press('Escape');
  await rename.waitFor({ state: 'detached' });
  assert.equal(await createdChat.count(), 1);
  await createdRow.hover();
  await createdRow.getByRole('button', { name: 'Session menu', exact: true }).click();
  await rowMenu.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await title.fill(' ');
  const saveTitle = rename.getByRole('button', { name: 'Save', exact: true });
  assert.equal(await saveTitle.isDisabled(), true);
  await title.fill('Renamed child session');
  await saveTitle.click();
  await rename.waitFor({ state: 'detached' });
  const renamedChat = createdRow.getByRole('button', { name: 'Renamed child session', exact: true });
  await renamedChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  await picker.getByRole('textbox', { name: 'Directory path' }).fill(join(temp, 'workspace'));
  await picker.getByRole('button', { name: 'Use this directory' }).click();
  await picker.waitFor({ state: 'detached' });
  await renamedChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  assert.match(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), /[\\/]workspace$/);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  const recentsProjectPath = join(temp, 'recents-project');
  await mkdir(recentsProjectPath);
  const addProject = recents.getByRole('button', { name: 'Add project', exact: true });
  const openCreate = async () => {
    await recents.hover();
    await addProject.click();
    assert.equal(await projectName.inputValue(), '');
    assert.equal(await createProject.locator('.wb-folder-row').count(), 0);
  };
  await recentsLabel.click();
  assert.equal(await recentsLabel.getAttribute('aria-expanded'), 'false');
  await openCreate();
  await projectName.fill('Discard project');
  await addRoot(recentsProjectPath);
  const behindDialog = await recentsLabel.boundingBox();
  await page.mouse.click(behindDialog.x + 15, behindDialog.y + 8);
  await createProject.waitFor({ state: 'detached' });
  assert.equal(await addProject.evaluate(button => document.activeElement === button), true);
  assert.equal(await recentsLabel.getAttribute('aria-expanded'), 'false');
  assert.equal(await tree.getByText('Discard project', { exact: true }).count(), 0);
  for (const cancel of [() => page.keyboard.press('Escape'),
    () => createProject.getByRole('button', { name: 'Close', exact: true }).click(),
    () => createProject.getByRole('button', { name: 'Cancel', exact: true }).click()]) {
    await openCreate();
    await projectName.fill('Discard project');
    await cancel();
    await createProject.waitFor({ state: 'detached' });
  }
  const engineeringRow = engineering.locator('[data-wb-kind="section"]');
  await engineeringRow.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Section menu' }).getByRole('menuitem', { name: 'Add project' }).click();
  await createProject.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openCreate();
  await projectName.fill('Recents fixture');
  const addFolder = createProject.getByRole('button', { name: 'Add', exact: true });
  await addFolder.click();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await projectName.inputValue(), 'Recents fixture');
  await addRoot(recentsProjectPath);
  const extraSource = join(temp, 'extra-source');
  await mkdir(extraSource);
  await createProject.getByRole('button', { name: 'Add folder', exact: true }).click();
  await picker.getByRole('textbox').fill(join(temp, 'missing-source'));
  await picker.getByRole('button', { name: 'Use this directory' }).click();
  await picker.getByRole('alert').waitFor();
  await chooseFolder(extraSource);
  const sourceRows = createProject.locator('.wb-folder-row');
  const primaryBadge = createProject.getByRole('button', { name: /^Primary: / });
  const makePrimary = createProject.getByRole('button', { name: /^Make primary: / });
  const firstSource = sourceRows.filter({ hasText: 'recents-project' });
  const secondSource = sourceRows.filter({ hasText: 'extra-source' });
  const actionOpacity = () => makePrimary.evaluate(button => getComputedStyle(button).opacity);
  await projectName.click();
  assert.equal(await primaryBadge.innerText(), 'Primary');
  assert.equal(await firstSource.getByRole('button', { name: /^Primary: / }).count(), 1);
  assert.equal(await actionOpacity(), '0');
  await secondSource.hover();
  assert.equal(await actionOpacity(), '1');
  if (process.env.DSH_TEST_ARTIFACTS) {
    await createProject.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'create-project-primary.png') });
  }
  await makePrimary.click();
  assert.equal(await sourceRows.first().locator('span').textContent(), 'recents-project');
  assert.equal(await secondSource.getByRole('button', { name: /^Primary: / }).count(), 1);
  await secondSource.getByRole('button', { name: /^Remove folder/ }).click();
  assert.equal(await firstSource.getByRole('button', { name: /^Primary: / }).count(), 1);
  const addAnother = createProject.getByRole('button', { name: 'Add folder', exact: true });
  await addAnother.click();
  await chooseFolder(extraSource);
  await projectName.click();
  await page.keyboard.press('Tab'); // Remove the primary folder.
  await page.keyboard.press('Tab'); // Make the second folder primary.
  assert.equal(await actionOpacity(), '1');
  assert.equal(await makePrimary.evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Enter');
  assert.equal(await secondSource.getByRole('button', { name: /^Primary: / }).evaluate(button => document.activeElement === button), true);
  await createButton.click();
  await createProject.waitFor({ state: 'detached' });
  const recentsProject = recents.locator('..').getByRole('button', { name: 'Recents fixture', exact: true });
  await recentsProject.waitFor();
  const newProjectRow = recentsProject.locator('..');
  await newProjectRow.hover();
  await newProjectRow.getByRole('button', { name: 'Add subproject' }).click();
  await createProject.getByRole('button', { name: 'Add', exact: true }).click();
  assert.equal(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), await realpath(extraSource),
    'the next folder chooser starts from the project root actually registered with the host');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await createProject.getByRole('button', { name: 'Cancel', exact: true }).click();
  await recentsProject.click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await projectEditor.getByText('extra-source', { exact: true }).waitFor();
  await projectEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS modal project creation, clean dismissal from all four controls, nested picker, and multiple source folders.');

  await child.hover();
  const topDraft = await openDraft(childNewSession, childDraft);
  await renamedChat.click();
  await recentsLabel.click();
  assert.equal(await recentsLabel.getAttribute('aria-expanded'), 'false');
  await recents.hover();
  assert.equal(await openDraft(recents.getByRole('button', { name: 'New session', exact: true }), childDraft), topDraft);
  await recentsLabel.click();
  assert.equal(await rowMenu.count(), 0);
  await host.stop();
  host = undefined;
  host = await startHost(port);
  await page.goto(host.url);
  await tree.waitFor();
  await dismissSignIn();
  await recentsProject.waitFor();
  await searchSessions.click();
  await query.fill('Renamed child session');
  await searchDialog.getByRole('button', { name: /Renamed child session/ }).waitFor();
  await query.fill('No session matches 9d64c3');
  await searchDialog.getByText('No matching sessions.', { exact: true }).waitFor();
  await query.press('Escape');
  await searchDialog.waitFor({ state: 'detached' });
  assert.equal(await tree.locator(`[data-row-key="session:${topDraft}"]`).count(), 0);
  await renamedChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await picker.waitFor();
  assert.match(await picker.getByRole('textbox', { name: 'Directory path' }).inputValue(), /[\\/]workspace$/);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  console.log('PASS draft-only new session UI, first-message titles, modal rename from both menus, and restart persistence for the title and working directory.');
  console.log('PASS Recents ignores the old custom title, has only creation actions, and retains new projects across restart.');
  await page.locator('[data-sidebar-opener]:visible, [data-sidebar-toggle]:visible').first().click();
  await page.waitForFunction(() => !!document.querySelector('[data-sidebar-collapsed="true"]'));
  assert.ok(await page.locator('[data-workbench-rail]').isVisible());
  await accountMenu.click({ trial: true });
  await toggleView.click();
  await page.getByRole('button', { name: 'Search sessions' }).waitFor();
  await page.getByRole('button', { name: 'Use workbench project list' }).click();

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
    await accountMenu.click({ trial: true });
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
  await recordMessage('session-deletion-fixture', '');
  const locationFile = join(temp, 'deletion-locations.json');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await access(locationFile).then(() => true, () => false)) break;
    await new Promise(accept => setTimeout(accept, 100));
  }
  const locations = JSON.parse(await readFile(locationFile, 'utf8'));
  // A complete catalog read discovers the fixture that has already released its live writer.
  await page.reload();
  const cold = tree.locator('[data-row-key="session:workbench-delete-cold"]');
  const live = tree.locator('[data-row-key="session:workbench-delete-live"]');
  const ungrouped = tree.getByRole('button', { name: 'Ungrouped chats', exact: true });
  await ungrouped.waitFor();
  if (await ungrouped.getAttribute('aria-expanded') === 'false') await ungrouped.click();
  await live.waitFor();
  await cold.waitFor();
  const ungroupedRow = ungrouped.locator('..');
  const newUngrouped = ungroupedRow.getByRole('button', { name: 'New session', exact: true });
  await beta.click();
  await ungroupedRow.hover();
  const ungroupedDraft = await openDraft(newUngrouped, 'workbench-test-beta');
  await editor.fill('New ungrouped conversation');
  await beta.click();
  await ungrouped.click({ button: 'right' });
  const ungroupedMenu = page.getByRole('menu', { name: 'Ungrouped chats menu', exact: true });
  assert.equal(await openDraft(ungroupedMenu.getByRole('menuitem', { name: 'New session' }), 'workbench-test-beta'), ungroupedDraft);
  assert.equal(await editor.innerText(), 'New ungrouped conversation');
  await recordMessage(ungroupedDraft, 'New ungrouped conversation');
  const createdUngrouped = tree.locator(`[data-row-key="session:${ungroupedDraft}"]`);
  await createdUngrouped.waitFor();
  assert.equal(await createdUngrouped.locator('..').getAttribute('data-wb-project-children'), 'workbench:ungrouped');
  await ungroupedRow.hover();
  await ungroupedRow.getByRole('button', { name: 'Ungrouped chats menu' }).click();
  await ungroupedMenu.getByRole('menuitem', { name: 'Remove group' }).click();
  const groupRemoval = page.getByRole('dialog', { name: /Remove group · Ungrouped chats/ });
  await groupRemoval.getByText(/permanently deleted/).first().waitFor();
  await groupRemoval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await ungrouped.waitFor();
  await createdUngrouped.waitFor();
  await access(locations.cold);
  console.log('PASS ungrouped creation, draft reuse and safe cancellation of group removal.');
  await cold.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  const archivedCold = archive.locator('[data-row-key="archived:workbench-delete-cold"]');
  if (await archiveLabel.getAttribute('aria-expanded') === 'false') await archiveLabel.click();
  await archivedCold.waitFor();
  const confirmDelete = async (row, accept) => {
    await row.click({ button: 'right' });
    const asserted = new Promise(resolve => page.once('dialog', async dialog => {
      const message = dialog.message();
      if (accept) await dialog.accept(); else await dialog.dismiss();
      resolve(message);
    }));
    await page.getByRole('menuitem', { name: 'Permanently delete', exact: true }).click();
    assert.match(await asserted, /Permanently delete this session\?/);
  };
  await confirmDelete(archivedCold, false);
  await access(locations.cold);
  await confirmDelete(archivedCold, true);
  await archivedCold.waitFor({ state: 'detached' });
  await assert.rejects(access(dirname(locations.cold)), { code: 'ENOENT' });
  await confirmDelete(live, true);
  await tree.getByText('This session will be permanently deleted the next time DSH starts.', { exact: true }).waitFor();
  await access(locations.live);
  const deletionPort = new URL(host.url).port;
  await host.stop();
  host = await startHost(deletionPort);
  await page.goto(host.url);
  await page.locator('[data-workbench-tree]').waitFor();
  await assert.rejects(access(dirname(locations.live)), { code: 'ENOENT' });
  assert.equal(await page.getByText('Delete fixture live', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Delete fixture cold', { exact: true }).count(), 0);
  console.log('PASS cancel, archived session deletion, queued live-session deletion, catalog refresh and durable deletion after restart.');
  // A previous Workbench release could already have flattened this group.
  await page.evaluate(() => {
    const key = 'dsh-workbench:workspace-tree:v1';
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...state, ungroupedInRecents: true }));
  });
  await page.reload();
  await dismissSignIn();
  await createdUngrouped.waitFor();
  assert.equal(await ungrouped.count(), 0);
  await recentsLabel.click({ button: 'right' });
  const recentsMenu = page.getByRole('menu', { name: 'Section menu', exact: true });
  await recentsMenu.getByRole('menuitem', { name: 'Delete ungrouped sessions', exact: true }).click();
  assert.equal(await groupRemoval.locator('b').textContent(), '1',
    'ungrouped removal counts ordinary sessions and leaves child records with the parent');
  await groupRemoval.getByRole('button', { name: 'Remove group', exact: true }).click();
  await groupRemoval.waitFor({ state: 'detached' });
  await createdUngrouped.waitFor({ state: 'detached' });
  await ungrouped.waitFor({ state: 'detached' });
  await dismissSignIn();

  await renamedChat.click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  const archivedChild = archive.locator(`[data-row-key="archived:${childDraft}"]`);
  await archivedChild.waitFor();
  const childLabel = child.getByRole('button', { name: 'child-project', exact: true });
  await childLabel.click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await projectEditor.getByRole('button', { name: 'Remove local project', exact: true }).click();
  const projectRemoval = page.getByRole('dialog', { name: /Remove project · child-project/ });
  await projectRemoval.getByText(/Includes archived sessions/).waitFor();
  assert.ok(Number(await projectRemoval.locator('b').textContent()) >= 1);
  if (process.env.DSH_TEST_ARTIFACTS) await projectRemoval.screenshot({
    path: join(process.env.DSH_TEST_ARTIFACTS, 'remove-project.png'),
  });
  await projectRemoval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await projectEditor.waitFor();
  await projectEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await childLabel.click({ button: 'right' });
  await projectMenu.getByRole('menuitem', { name: 'Remove project', exact: true }).click();
  await projectRemoval.getByRole('button', { name: 'Remove project', exact: true }).click();
  await projectRemoval.waitFor({ state: 'detached' });
  await childLabel.waitFor({ state: 'detached' });
  assert.equal(await tree.locator(`[data-row-key="session:${childDraft}"]`).count(), 0);
  await access(join(temp, 'workspace', 'child-project'));
  await alpha.waitFor();

  await host.stop();
  host = await startHost(deletionPort);
  await page.goto(host.url);
  await alpha.waitFor();
  assert.equal(await tree.locator(`[data-row-key="archived:${childDraft}"]`).count(), 0);
  assert.equal(await tree.locator(`[data-row-key="archived:${ungroupedDraft}"]`).count(), 0);
  console.log('PASS project and ungrouped removal confirms scope, retains directories, and clears queued sessions after restart.');
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
