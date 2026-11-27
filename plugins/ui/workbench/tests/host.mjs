import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createProbe } from './helpers/probe.mjs';
import { checkWindowDrag } from './helpers/window-drag.mjs';

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
const folderOutline = locator => locator.locator('svg').evaluate(svg => ({
  path: svg.querySelector('path').getAttribute('d'), width: svg.getBoundingClientRect().width,
  stroke: getComputedStyle(svg).strokeWidth, decorative: svg.getAttribute('aria-hidden'),
}));

async function saveFolderScreenshot(locator, name) {
  if (!process.env.DSH_TEST_ARTIFACTS) return;
  await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
  await locator.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, name + '.png') });
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
  await checkWindowDrag(page);
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
  assert.deepEqual(await sidebarAction.getByRole('button').allTextContents(), ['New Section']);
  assert.equal(await searchSessions.textContent(), '');
  assert.equal(await recentsLabel.evaluate(button => getComputedStyle(button).color), 'rgb(147, 150, 154)');
  await page.mouse.move(1200, 400);
  const newSectionOutline = await folderOutline(newSection);
  assert.deepEqual(newSectionOutline, {
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM12 8v8M8 12h8',
    width: 16, stroke: '1.7px', decorative: 'true',
  });
  const addProjectOutline = await folderOutline(recents.getByRole('button', { name: 'Add project', exact: true }));
  await saveFolderScreenshot(newSection, 'new-section-circle-plus');
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
    return [rail.width, sidebar.width, main.x, handle.x + handle.width / 2];
  });
  assert.deepEqual(await sidebarGeometry(), [52, 296, 348, 348], 'default expanded sidebar and drag handle at 100%');
  assert.deepEqual(await tree.evaluate(element => {
    const sidebar = element.closest('[data-slot="sidebar"]').parentElement;
    const rail = document.querySelector('[data-workbench-rail]');
    return [getComputedStyle(rail).backgroundColor, getComputedStyle(sidebar).backgroundColor];
  }), ['rgb(41, 44, 46)', 'rgb(32, 33, 34)']);
  const sidebarHandle = page.locator('[data-side="sidebar"]');
  const startSidebarDrag = async () => {
    const box = await sidebarHandle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, 200);
    await page.mouse.down();
  };
  await startSidebarDrag();
  await page.mouse.move(368, 200, { steps: 5 });
  assert.deepEqual(await sidebarGeometry(), [52, 316, 368, 368], 'the divider follows the pointer before release');
  await page.mouse.up();
  assert.deepEqual(await sidebarGeometry(), [52, 316, 368, 368], 'drag moves the sidebar and separator by the same amount');
  const firstSidebarRow = async locator => {
    const bounds = await locator.boundingBox();
    return locator.evaluate((button, box) => {
      const icon = button.querySelector('svg').getBoundingClientRect();
      const { fontFamily, fontSize, lineHeight } = getComputedStyle(button);
      return [box.x, box.y, box.height, icon.x, icon.y, fontFamily, fontSize, lineHeight];
    }, bounds);
  };
  const homeSidebarRow = await firstSidebarRow(newSection);
  const homeRail = page.locator('[data-workbench-rail]');
  for (const [pointerX, width] of [[120, 238], [760, 468]]) {
    await startSidebarDrag();
    await page.mouse.move(pointerX, 200, { steps: 7 });
    await page.mouse.up();
    const end = width + 52;
    assert.deepEqual(await sidebarGeometry(), [52, width, end, end], 'drag clamps at the measured bounds');
    for (const [label, selector] of [
      ['Plugins', '[data-workbench-plugins-navigation] > button'],
      ['Scheduled', '[data-workbench-scheduled-new]'],
    ]) {
      await homeRail.getByRole('button', { name: label, exact: true }).click();
      const first = page.locator(selector).first();
      await first.waitFor();
      assert.equal(await first.evaluate(button => button.closest('nav').getBoundingClientRect().width), width, label);
      assert.deepEqual(await firstSidebarRow(first), homeSidebarRow, label);
    }
    await homeRail.getByRole('button', { name: 'Conversation', exact: true }).click();
    await newSection.waitFor();
    assert.deepEqual(await sidebarGeometry(), [52, width, end, end], 'switching preserves the user-resized track');
  }
  await startSidebarDrag();
  await page.mouse.move(348, 200, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await sidebarGeometry(), [52, 296, 348, 348]);
  for (const row of [project, alpha]) {
    assert.deepEqual(await row.locator('.wb-tree-label').evaluate(label => {
      const style = getComputedStyle(label);
      return [style.fontSize, style.lineHeight, label.getBoundingClientRect().height];
    }), [row === project ? '14px' : '13.6px', '20px', 31]);
  }
  const sessionTitle = alpha.locator('.wb-tree-label > span');
  const readTitleFont = () => sessionTitle.evaluate(node => {
    const { fontFamily, fontWeight } = getComputedStyle(node);
    return { fontFamily, fontWeight };
  });
  const defaultFont = await readTitleFont();
  assert.match(defaultFont.fontFamily, /^-apple-system, .+?, "Segoe UI", sans-serif$/);
  assert.doesNotMatch(defaultFont.fontFamily, /PingFang/);
  assert.equal(defaultFont.fontWeight, '430');
  await page.evaluate(() => document.body.style.setProperty('--dsh-font-family-text', 'Georgia'));
  assert.match((await readTitleFont()).fontFamily, /^Georgia,/);
  await page.evaluate(() => document.body.style.removeProperty('--dsh-font-family-text'));
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
  const projectLabel = project.getByRole('button', { name: 'workspace', exact: true });
  const addSubprojectOutline = await folderOutline(project.getByRole('button', { name: 'Add subproject', exact: true }));
  await page.mouse.move(1200, 400);
  const openOutline = await folderOutline(projectLabel);
  await saveFolderScreenshot(project, 'folder-project-open');
  await projectLabel.click();
  await page.mouse.move(1200, 400);
  const closedOutline = await folderOutline(projectLabel);
  await saveFolderScreenshot(project, 'folder-project-closed');
  assert.equal(await projectLabel.getAttribute('aria-expanded'), 'false');
  assert.equal(await tree.locator('[data-wb-kind="session"]').count(), 0);
  await projectLabel.press('Enter');
  assert.equal(await projectLabel.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await folderOutline(projectLabel), openOutline);
  assert.ok(Math.abs((await titleBounds(project)).x - projectTitleBounds.x) <= 1, 'folder opening keeps the project title in the same column');
  assert.equal(await ownRows(projectChildren).count(), 10);
  await projectChildren.getByRole('button', { name: 'Show more', exact: true }).click();
  const scheduledMark = row => row.getByRole('img', { name: 'Has an active scheduled task' });
  assert.equal(await scheduledMark(alpha).count(), 0);
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'session-clock-before.png') });
  await recordMessage('schedule-clock-fixture', 'create');
  await scheduledMark(alpha).waitFor();
  assert.equal(await scheduledMark(beta).count(), 0);
  const scheduledIcon = await scheduledMark(alpha).boundingBox();
  const scheduledTitle = await titleBounds(alpha);
  assert.equal(scheduledIcon.width, 14);
  assert.ok(scheduledIcon.x >= scheduledTitle.x + scheduledTitle.width);
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'session-clock-after.png') });
  const actionBoxes = async row => {
    const menu = row.getByRole('button', { name: 'Session menu', exact: true });
    const pin = row.getByRole('button', { name: 'Pin Chat', exact: true });
    await menu.waitFor();
    await pin.waitFor();
    return [await menu.boundingBox(), await pin.boundingBox()];
  };
  await alpha.hover();
  const scheduledActions = await actionBoxes(alpha);
  if (process.env.DSH_TEST_ARTIFACTS) await alpha.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'session-clock-hover.png') });
  assert.equal(await scheduledMark(alpha).isVisible(), false, 'hover hides the scheduled clock');
  const alphaBox = await alpha.boundingBox();
  const hoveredPin = scheduledActions[1];
  assert.equal(scheduledIcon.x + scheduledIcon.width / 2, hoveredPin.x + hoveredPin.width / 2,
    'resting clock and hover pin share a horizontal center');
  assert.equal(scheduledIcon.y + scheduledIcon.height / 2, alphaBox.y + alphaBox.height / 2,
    'clock is centered vertically in the row');
  await beta.hover();
  const ordinaryActions = await actionBoxes(beta);
  assert.deepEqual(scheduledActions.map(({ x, width }) => [x, width]), ordinaryActions.map(({ x, width }) => [x, width]));
  await scheduledMark(alpha).waitFor();
  const alphaTop = (await alpha.boundingBox()).y;
  await alpha.click({ button: 'right' });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: 'Permanently delete', exact: true }).click();
  const sidebarNotice = page.locator('[data-workbench-sidebar-notice]');
  const deleteFailure = 'Could not delete this session. Check that it has finished and try again.';
  await sidebarNotice.getByRole('alert').getByText(deleteFailure).waitFor();
  assert.equal(await tree.getByText(deleteFailure).count(), 0);
  assert.equal((await alpha.boundingBox()).y, alphaTop, 'feedback does not move the session list');
  if (process.env.DSH_TEST_ARTIFACTS) await sidebarNotice.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'sidebar-delete-notice.png') });
  await sidebarNotice.getByRole('button', { name: 'Close', exact: true }).click();
  await sidebarNotice.waitFor({ state: 'detached' });
  await recordMessage('schedule-clock-fixture', 'pause');
  await scheduledMark(alpha).waitFor({ state: 'detached' });
  await recordMessage('schedule-clock-fixture', 'resume');
  await scheduledMark(alpha).waitFor();
  const activityToggle = header.getByRole('button', { name: 'View activity' });
  await activityToggle.click();
  const scheduledActivity = page.locator('[data-workbench-activity-list]').getByRole('button', { name: /Workbench alpha/ });
  await scheduledMark(scheduledActivity).waitFor();
  await activityToggle.click();
  await tree.waitFor({ state: 'visible' });
  await recordMessage('schedule-clock-fixture', 'target:workbench-test-beta');
  await scheduledMark(beta).waitFor();
  assert.equal(await scheduledMark(alpha).count(), 0, 'the prior target loses its clock after reassignment');
  await recordMessage('schedule-clock-fixture', 'target:new');
  await scheduledMark(beta).waitFor({ state: 'detached' });
  assert.equal(await scheduledMark(alpha).count(), 0, 'runs in new sessions have no current sidebar target');
  await recordMessage('schedule-clock-fixture', 'target:workbench-test-alpha');
  await scheduledMark(alpha).waitFor();
  await recordMessage('schedule-clock-fixture', 'delete');
  await scheduledMark(alpha).waitFor({ state: 'detached' });
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
  await priority.getByText(/^Activity preview fixture/).waitFor();
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
  const projectNameOutline = await folderOutline(projectEditor.locator('.wb-project-name'));
  const sourceFolderOutline = await folderOutline(projectEditor.locator('.wb-folder-row').first());
  const addSourceOutline = await folderOutline(projectEditor.getByRole('button', { name: 'Add folder' }));
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
  assert.notEqual(openOutline.path, closedOutline.path, 'opening the project must change the folder silhouette');
  assert.deepEqual(projectNameOutline, closedOutline);
  assert.deepEqual(sourceFolderOutline, closedOutline);
  assert.deepEqual(await folderOutline(createProject.locator('.wb-project-name')), closedOutline);
  assert.deepEqual(await folderOutline(createProject.getByRole('button', { name: 'Add', exact: true })), addSourceOutline);
  assert.deepEqual(addSubprojectOutline, addProjectOutline);
  assert.deepEqual(addProjectOutline, addSourceOutline);
  const newSessionOutline = await folderOutline(project.getByRole('button', { name: 'New session', exact: true }));
  assert.match(newSessionOutline.path, /M12 5H6\.5.*M10 14\.5/);
  assert.deepEqual([newSessionOutline.width, newSessionOutline.stroke, newSessionOutline.decorative], [16, '1.75px', 'true']);
  assert.deepEqual(await folderOutline(recents.getByRole('button', { name: 'New session', exact: true })), newSessionOutline);
  for (const outline of [openOutline, closedOutline, addSourceOutline, addProjectOutline]) {
    assert.deepEqual([outline.width, outline.stroke, outline.decorative], [16, '1.65px', 'true']);
  }
  assert.match(addSourceOutline.path, /M12 10v6M9 13h6/);
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
  const userImage = page.locator('[data-message-attachments] button').filter({ has: page.getByAltText('workbench-image.png') });
  const assistantImage = page.locator('[data-chat-flow-kind="assistant-step"] button[data-variant]').filter({ has: page.getByAltText('workbench-image.png') });
  await userImage.waitFor();
  await assistantImage.waitFor();
  assert.equal(await userImage.getAttribute('data-variant'), 'tile');
  assert.equal(await assistantImage.getAttribute('data-variant'), 'single');
  const { width, height } = await userImage.boundingBox();
  assert.deepEqual([width, height], [64, 64]);
  const original = page.getByRole('dialog').getByAltText('workbench-image.png');
  await userImage.click();
  await original.waitFor();
  await original.evaluate(image => image.decode());
  assert.deepEqual(await original.evaluate(image => [image.naturalWidth, image.naturalHeight]), [320, 200]);
  await page.keyboard.press('Escape');
  await original.waitFor({ state: 'detached' });
  if (process.env.DSH_TEST_ARTIFACTS) await userImage.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'user-image-compact.png') });
  console.log('PASS compact user image and full-resolution lightbox, with the assistant image retaining its native variant.');
  const sessionHeader = page.locator('[data-slot="conversation.session.header"] nav').getByText('Workbench alpha', { exact: true });
  assert.equal(await sessionHeader.evaluate(title => getComputedStyle(title).fontSize), '13px');
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
  }), [['14px', '22.75px'], ['14px', '22.75px']], '100% uses the Codex desktop body size with the host text preference');
  const bubble = page.locator('[data-message-bubble]').filter({ hasText: 'Review the edited files' });
  assert.deepEqual(await bubble.evaluate(node => {
    const { fontFamily, fontSize, lineHeight } = getComputedStyle(node);
    return [fontFamily, fontSize, lineHeight];
  }), [await paragraph.evaluate(node => getComputedStyle(node).fontFamily), '14px', '22.75px']);
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
  const inlineCode = page.locator('[data-conversation-content] code').filter({ hasText: /^main$/ });
  assert.deepEqual(await inlineCode.evaluate(node => {
    const { fontFamily, fontSize } = getComputedStyle(node);
    return [fontFamily, fontSize];
  }), ['ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace', '12.25px']);
  const assistantCode = page.locator('[data-conversation-content] [data-chat-flow-kind="assistant-step"] [data-code-block-content]');
  const codeFontFamily = await inlineCode.evaluate(node => getComputedStyle(node).fontFamily);
  for (const [name, code] of [
    ['plain', assistantCode.locator('pre > code').filter({ hasText: 'workspace/' })],
    ['highlighted', assistantCode.locator('pre.shiki > code').filter({ hasText: 'const sample' })],
  ]) {
    await code.waitFor();
    const typography = await code.evaluate(node => {
      const { fontFamily, fontSize, lineHeight } = getComputedStyle(node);
      return { fontFamily, fontSize, lineHeight };
    });
    if (process.env.DSH_TEST_ARTIFACTS) {
      console.log(`Assistant ${name} code block typography:`, typography);
      await code.locator('xpath=ancestor::*[@data-code-wrap][1]').screenshot({
        path: join(process.env.DSH_TEST_ARTIFACTS, `assistant-code-block-${name}.png`),
      });
    }
    assert.deepEqual(typography, {
      fontFamily: codeFontFamily,
      fontSize: '12px', lineHeight: '20px',
    }, 'assistant code blocks use Codex typography with a 15px host code preference');
  }
  console.log('PASS assistant code block typography for plain and highlighted fences.');
  const duration = page.getByRole('button', { name: /^Completed in / });
  await duration.waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) {
    await duration.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'completed-duration-typography.png') });
  }
  assert.equal(await duration.locator('span').first().evaluate(label => getComputedStyle(label).fontSize), '14px',
    'completed timing uses the Workbench reference size with a 15px host preference');
  if (await duration.getAttribute('aria-expanded') === 'false') await duration.click();
  const toolSummary = page.locator('[data-conversation-content] [data-step-process]')
    .getByRole('button', { name: /^Read files/ });
  await toolSummary.waitFor();
  const summaryLabel = toolSummary.getByText(/^Read files/);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await toolSummary.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'tool-summary-typography.png') });
    const sample = await paragraph.evaluateHandle(node => {
      const span = document.createElement('span');
      span.dataset.workbenchTypefaceSample = '';
      span.textContent = '我会先核对 Harness 主检出和几个开发工作树。';
      node.append(document.createElement('br'), span);
      return span;
    });
    try {
      const client = await page.context().newCDPSession(page);
      await client.send('DOM.enable');
      await client.send('CSS.enable');
      const { root } = await client.send('DOM.getDocument');
      const { nodeId } = await client.send('DOM.querySelector', {
        nodeId: root.nodeId, selector: '[data-workbench-typeface-sample]',
      });
      console.log('Conversation platform fonts:', await client.send('CSS.getPlatformFontsForNode', { nodeId }));
      await client.detach();
      await page.locator('[data-workbench-typeface-sample]').screenshot({
        path: join(process.env.DSH_TEST_ARTIFACTS, 'assistant-typeface.png'),
      });
    } finally {
      await sample.evaluate(span => { span.previousSibling.remove(); span.remove(); });
      await sample.dispose();
    }
  }
  const toolSummaryTypography = await summaryLabel.evaluate(label => {
    const { fontFamily, fontSize, lineHeight, fontWeight } = getComputedStyle(label);
    return { text: label.textContent, fontFamily, fontSize, lineHeight, fontWeight };
  });
  console.log('Tool summary typography:', toolSummaryTypography);
  const assistantFont = await paragraph.evaluate(node => getComputedStyle(node).fontFamily);
  console.log('Assistant font family:', assistantFont);
  assert.match(assistantFont, /^-apple-system, (?:BlinkMacSystemFont|"?system-ui"?), "Segoe UI", sans-serif$/);
  assert.equal(toolSummaryTypography.fontFamily, assistantFont);
  assert.equal(toolSummaryTypography.fontWeight, '430');
  assert.equal(toolSummaryTypography.fontSize, '14px',
    'tool summary uses the Workbench reference size with a 15px host preference');
  assert.equal(await toolSummary.getAttribute('aria-expanded'), 'false');
  await toolSummary.click();
  assert.equal(await toolSummary.getAttribute('aria-expanded'), 'true');
  await toolSummary.click();
  assert.equal(await toolSummary.getAttribute('aria-expanded'), 'false');
  await duration.click();
  assert.equal(await duration.getAttribute('aria-expanded'), 'false');
  console.log('PASS tool summary typography and native tool and turn disclosure.');
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
  await draft.press('ControlOrMeta+A');
  await draft.press('Backspace');
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
  const question = page.locator('[data-question-key]');
  const questionPager = question.locator('footer > div:first-child');
  const questionRadio = question.getByRole('radio');
  const questionSubmit = question.getByRole('button', { name: 'Submit', exact: true });
  const questionAnswer = join(temp, 'activity.answer');
  const assertQuestionAnswer = async expected => {
    await question.waitFor({ state: 'hidden' });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await access(questionAnswer).then(() => true, () => false)) {
        assert.deepEqual(JSON.parse(await readFile(questionAnswer, 'utf8')).answers, expected);
        await rm(questionAnswer);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Native question service did not record the answer');
  };
  await recordMessage('question-card-fixture', 'single');
  await question.waitFor();
  await questionPager.waitFor({ state: 'hidden' });
  assert.deepEqual(await question.locator('h2').evaluate(typography), ['14px', '20px']);
  assert.equal((await question.locator('[data-option-description]').first().evaluate(typography))[0], '14px');
  const answerBox = question.locator('textarea');
  await answerBox.fill('中文');
  await answerBox.press('2');
  assert.equal(await answerBox.inputValue(), '中文2');
  await answerBox.dispatchEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
  assert.equal(await question.isVisible(), true);
  await answerBox.fill('');
  await answerBox.blur();
  await page.keyboard.press('2');
  assert.equal(await questionRadio.nth(1).getAttribute('aria-checked'), 'true');
  assert.equal(await questionSubmit.isEnabled(), true);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await question.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'question-card-single.png') });
  }
  await questionSubmit.click();
  await assertQuestionAnswer([{ id: 'account', selected: ['Work'] }]);

  await recordMessage('question-card-fixture', 'batch');
  await question.waitFor();
  await questionPager.waitFor();
  assert.equal(await questionPager.textContent(), '1 / 2');
  await questionRadio.first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await questionRadio.nth(1).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  await question.getByRole('heading', { name: 'Choose backup accounts' }).waitFor();
  const backupOption = question.getByRole('checkbox', { name: 'Personal', exact: true });
  await backupOption.focus();
  await page.keyboard.press('ArrowLeft');
  await questionRadio.first().waitFor();
  await questionRadio.first().focus();
  await page.keyboard.press('2');
  await backupOption.waitFor();
  assert.equal(await questionPager.textContent(), '2 / 2');
  await backupOption.focus();
  await page.keyboard.press('1');
  assert.equal(await backupOption.getAttribute('aria-checked'), 'true');
  await questionSubmit.click();
  await assertQuestionAnswer([{ id: 'account', selected: ['Work'] }, { id: 'backup', selected: ['Personal'] }]);
  console.log('PASS question card typography, singleton and batch pagination, keyboard selection, IME and native submission.');
  const tabs = page.locator('[data-conversation-tabs]');
  const chatTab = tabs.getByRole('tab', { name: 'Chat', exact: true });
  const trajectoryTab = tabs.getByRole('tab', { name: 'Trajectory' });
  const headerGeometry = await tabs.evaluate(strip => {
    const row = strip.parentElement;
    const header = strip.closest('header[data-window-drag]');
    const title = header.querySelector('[data-slot="conversation.session.header"] nav');
    const rule = getComputedStyle(row, '::before');
    return {
      titleAboveTabs: title.getBoundingClientRect().bottom < row.getBoundingClientRect().top,
      rule: rule.borderTopWidth,
      tabsHeight: strip.getBoundingClientRect().height,
    };
  });
  assert.deepEqual(headerGeometry, { titleAboveTabs: true, rule: '1px', tabsHeight: 37 });
  await trajectoryTab.click();
  assert.equal(await trajectoryTab.getAttribute('aria-selected'), 'true');
  assert.deepEqual(await trajectoryTab.evaluate(tab => {
    const underline = getComputedStyle(tab, '::after');
    return [underline.height, underline.backgroundColor === getComputedStyle(tab).color];
  }), ['2px', true]);
  await chatTab.press('Enter');
  assert.equal(await chatTab.getAttribute('aria-selected'), 'true');
  if (process.env.DSH_TEST_ARTIFACTS) {
    await page.locator('header[data-window-drag]').filter({ has: tabs }).screenshot({
      path: join(process.env.DSH_TEST_ARTIFACTS, 'session-header.png'),
    });
  }
  console.log('PASS Session title above the divider, native view tabs with underline, and keyboard switching.');
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
  const projectGroup = summary.locator('[data-summary-group="project"]');
  const projectHeading = projectGroup.getByRole('button', { name: 'child-project', exact: true });
  const primarySummaryPath = await realpath(join(temp, 'workspace', 'child-project'));
  const additionalSummaryPath = await realpath(join(temp, 'deletion-workspace'));
  const summaryFolder = summary.getByRole('button', { name: primarySummaryPath, exact: true });
  await summaryFolder.waitFor();
  assert.equal(await summaryFolder.innerText(), 'child-project');
  assert.equal(await summaryFolder.getAttribute('title'), primarySummaryPath);
  assert.equal(await projectHeading.getAttribute('aria-expanded'), 'true');
  await projectHeading.click();
  await summaryFolder.waitFor({ state: 'hidden' });
  await projectHeading.press('Enter');
  await summaryFolder.waitFor();
  assert.equal(await summary.getByRole('button', { name: /Created chats/ }).count(), 0);
  assert.equal(await summary.getByRole('group', { name: 'Sources' }).count(), 0, 'project folders are not chat sources');
  assert.deepEqual(await summary.evaluate(element => {
    const heading = getComputedStyle(element.querySelector('.wb-summary-heading'));
    const changes = getComputedStyle(element.querySelector('.wb-summary-changes'));
    return [heading.fontSize, heading.fontWeight, changes.fontSize, changes.lineHeight];
  }), ['13px', '400', '14px', '20px']);
  const summaryHeadingFit = () => summary.evaluate(card => {
    const heading = card.querySelector('.wb-summary-heading');
    const label = heading.querySelector('span');
    const previous = label.textContent;
    label.textContent = 'bugfix-2026-11-23-qoder-model-request-with-a-long-checkout-name';
    try {
      return {
        cardFits: card.clientWidth === card.scrollWidth,
        titleEllipsized: label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis',
        fill: getComputedStyle(card).backgroundColor,
        titleColor: getComputedStyle(heading).color,
      };
    } finally {
      label.textContent = previous;
    }
  });
  const expectedSummaryFit = { cardFits: true, titleEllipsized: true, fill: 'rgb(43, 44, 46)', titleColor: 'rgb(176, 179, 184)' };
  assert.deepEqual(await summaryHeadingFit(), expectedSummaryFit);
  const childProjectKey = await child.getAttribute('data-row-key');
  assert.ok(childProjectKey?.startsWith('project:'));
  // Feed the persisted folder configuration through the normal cross-window refresh.
  const configureSummaryFolders = paths => page.evaluate(({ workspaceId, paths }) => {
    const key = 'dsh-workbench:workspace-tree:v1';
    const treeState = JSON.parse(localStorage.getItem(key));
    const sourceFolders = { ...treeState.sourceFolders, [workspaceId]: paths };
    localStorage.setItem(key, JSON.stringify({ ...treeState, sourceFolders }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, { workspaceId: childProjectKey.slice('project:'.length), paths });
  await configureSummaryFolders([primarySummaryPath, additionalSummaryPath]);
  await summary.getByRole('heading', { name: 'Project folders · 2' }).waitFor();
  assert.equal(await summary.getByRole('group', { name: 'Project folders' }).getByRole('button').count(), 2);
  assert.equal(await projectGroup.getByRole('button', { name: 'Changes', exact: true }).count(), 1);
  await summary.getByRole('button', { name: additionalSummaryPath, exact: true }).waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-multiple-folders.png') });
  await configureSummaryFolders([primarySummaryPath]);
  await summary.getByRole('heading', { name: 'Project folders · 1' }).waitFor();
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
  assert.deepEqual(await summaryHeadingFit(), expectedSummaryFit);
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-open-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const agentGroup = summary.locator('[data-summary-group="agents"]');
  const agentHeading = agentGroup.getByRole('button', { name: 'Subagents · 1', exact: true });
  const summaryAgent = agentGroup.getByRole('button', { name: /Inspect workbench fixture/ });
  const chevron = agentHeading.locator('svg');
  await agentHeading.waitFor();
  await page.mouse.move(100, 100);
  assert.equal(await chevron.evaluate(element => getComputedStyle(element).opacity), '0');
  await agentHeading.hover();
  assert.equal(await chevron.evaluate(element => getComputedStyle(element).opacity), '1');
  assert.equal(await summaryAgent.isVisible(), false);
  await agentHeading.click();
  await summaryAgent.getByText('Active', { exact: true }).waitFor();
  const agentIcon = await summaryAgent.locator('.wb-agent-icon').evaluate(element => [element.textContent.trim(), getComputedStyle(element).color]);
  await recordMessage('subagent-fixture', 'done');
  await summaryAgent.getByText('Done', { exact: true }).waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'summary-subagents-expanded.png') });
  await agentHeading.click();
  await summaryAgent.waitFor({ state: 'hidden' });
  await agentHeading.press('Space');
  await summaryAgent.click();
  await summary.waitFor({ state: 'detached' });
  const agents = right.locator('.wb-agent-list');
  assert.equal(await tree.locator('[data-row-key="session:workbench-child-record"]').count(), 0,
    'child records belong in the parent panel and stay out of ordinary session rows');
  await right.locator('.wb-agent-conversation').getByText('Inspect the sample directory', { exact: true }).waitFor();
  await right.locator('.wb-agent-detail header').getByText('Fixture model · high').waitFor();
  await right.locator('.wb-agent-conversation strong').filter({ hasText: 'Directory checked' }).waitFor();
  await right.locator('.wb-agent-detail summary').click();
  await right.locator('.wb-agent-detail details[open] time').waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await right.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'subagent-record.png') });
  await right.getByRole('button', { name: 'Back', exact: true }).click();
  const agentListRow = agents.getByRole('button', { name: /Inspect workbench fixture/ });
  await agentListRow.waitFor();
  await agents.getByRole('heading', { name: 'Done · 1' }).waitFor();
  assert.deepEqual(await agentListRow.locator('.wb-agent-icon').evaluate(element => [element.textContent.trim(), getComputedStyle(element).color]), agentIcon);
  if (process.env.DSH_TEST_ARTIFACTS) await right.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'subagents.png') });
  await agentListRow.click();
  await right.locator('.wb-agent-detail').getByRole('heading', { name: 'Inspect workbench fixture' }).waitFor();
  await alpha.getByRole('button', { name: 'Workbench alpha', exact: true }).click();
  await right.locator('.wb-agent-detail').waitFor({ state: 'hidden' });
  await summaryButton.click();
  await projectGroup.getByRole('button', { name: 'workspace', exact: true }).waitFor();
  assert.equal(await agentGroup.count(), 0);
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  if (!(await summary.isVisible())) await summaryButton.click();
  await projectHeading.waitFor();
  await agentHeading.waitFor();
  assert.equal(await agentHeading.getAttribute('aria-expanded'), 'false');
  await agentHeading.click();
  await summaryAgent.click();
  await right.locator('.wb-agent-detail').getByRole('heading', { name: 'Inspect workbench fixture' }).waitFor();
  await right.getByRole('button', { name: 'Back', exact: true }).click();
  await agentListRow.waitFor();
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
  const checkToolPage = async (navigationWidth = 0) => {
    await tree.waitFor({ state: 'hidden' });
    await sidebar.locator('[data-slot="sidebar.session.action"]').waitFor({ state: 'hidden' });
    await globalPanel.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-side="sidebar"]:visible').count(), 0);
    await page.waitForFunction(width => {
      const panel = document.querySelector('[data-global-panel]');
      return panel && Math.abs(panel.getBoundingClientRect().left -
        panel.closest('[data-slot="root"] > div').getBoundingClientRect().left - width) < 2;
    }, navigationWidth);
    assert.ok(await rail.isVisible());
    await accountMenu.click({ trial: true });
  };
  assert.equal(await rail.getByRole('button', { name: 'New session', exact: true }).count(), 0);
  assert.equal(await rail.locator('.dsh-workbench-divider').count(), 0);
  await rail.getByRole('button', { name: 'Plugins', exact: true }).click();
  const pluginsNavigation = page.locator('[data-workbench-plugins-navigation]');
  await pluginsNavigation.waitFor();
  await checkToolPage(296);
  const readManagementChrome = (navigation, body, heading) => navigation.evaluate((element, selectors) => {
    const main = document.querySelector(selectors.body);
    const title = main.querySelector(selectors.heading);
    const headingStyle = getComputedStyle(title);
    return [getComputedStyle(element).backgroundColor, getComputedStyle(main).backgroundColor,
      headingStyle.fontSize, headingStyle.lineHeight, headingStyle.fontWeight];
  }, { body, heading });
  const expectedManagementChrome = ['rgb(32, 33, 34)', 'rgb(24, 25, 26)', '21px', '27.3px', '550'];
  const basicList = page.locator('[data-plugin-group="basic"] > ul');
  await basicList.waitFor();
  assert.deepEqual(await readManagementChrome(pluginsNavigation, '[data-plugin-panel]', '[data-plugin-header-part="title"]'), expectedManagementChrome);
  assert.equal(await basicList.evaluate(list => getComputedStyle(list).gridTemplateColumns.split(' ').length), 2);
  const basicPlugins = pluginsNavigation.locator('[data-workbench-plugin-group="basic"]');
  await basicPlugins.click();
  await pluginsNavigation.locator('[data-workbench-plugin-group="basic"][aria-current="true"]').waitFor();
  const visiblePluginGroups = page.locator('[data-plugin-group]:visible');
  assert.deepEqual(await visiblePluginGroups.evaluateAll(groups => groups.map(group => group.getAttribute('data-plugin-group'))), ['basic']);
  for (const group of ['extensions', 'bundles']) {
    await pluginsNavigation.locator(`[data-workbench-plugin-group="${group}"]`).click();
    await page.locator(`[data-plugin-group="${group}"]:visible`).waitFor();
    assert.deepEqual(await visiblePluginGroups.evaluateAll(groups => groups.map(item => item.getAttribute('data-plugin-group'))), [group]);
  }
  await pluginsNavigation.locator('[data-workbench-plugin-group="overview"]').click();
  const pluginSearch = page.locator('[data-workbench-plugin-search] input');
  await pluginSearch.waitFor();
  await pluginSearch.fill('shell');
  await page.getByRole('button', { name: 'View Shell', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'View Subagent', exact: true }).count(), 0);
  await pluginSearch.clear();
  await page.locator('[data-plugin-header-part="title"]').waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'plugins-page.png') });
  await homeButton.click();
  await tree.waitFor({ state: 'visible' });

  await rail.getByRole('button', { name: 'Scheduled', exact: true }).click();
  await checkToolPage(296);
  const schedule = page.getByTestId('task-manager-page');
  const scheduledNavigation = page.locator('[data-workbench-scheduled-navigation]');
  await scheduledNavigation.waitFor();
  await schedule.getByRole('heading', { name: 'Scheduled', exact: true }).waitFor();
  await schedule.getByRole('button', { name: 'Active', exact: true }).waitFor();
  await schedule.getByRole('searchbox', { name: 'Search scheduled tasks' }).waitFor();
  assert.deepEqual(await readManagementChrome(scheduledNavigation, '[data-testid="task-manager-page"]', 'h1'), expectedManagementChrome);
  const pausedTasks = scheduledNavigation.locator('[data-workbench-scheduled-paused]');
  assert.equal(await pausedTasks.evaluate(element => element.open), false);
  const catalog = schedule.getByRole('list', { name: 'Task catalog' });
  const fixtureNames = ['Workbench layout fixture one', 'Workbench layout fixture two'];
  for (const name of fixtureNames) {
    await scheduledNavigation.locator('[data-workbench-scheduled-new]').click();
    const form = schedule.getByRole('complementary', { name: 'Create manually' });
    await form.getByLabel('Automation task name').fill(name);
    await form.getByLabel('Automation task instruction').fill('Isolated layout fixture. No run is requested.');
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await catalog.getByRole('button', { name, exact: true }).waitFor();
    await schedule.getByRole('button', { name: 'Close details' }).click();
  }
  const firstTask = catalog.getByRole('button', { name: fixtureNames[0], exact: true });
  const subsequentTask = catalog.getByRole('button', { name: fixtureNames[1], exact: true });
  assert.equal((await firstTask.boundingBox()).height, 49);
  assert.equal(Math.abs((await subsequentTask.boundingBox()).y - (await firstTask.boundingBox()).y), 49);
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'scheduled-page.png') });
  const activeTask = scheduledNavigation.locator('[data-workbench-scheduled-group="active"] [data-workbench-scheduled-task]').filter({ hasText: fixtureNames[0] });
  const taskActions = scheduledNavigation.getByRole('button', { name: 'Task actions · ' + fixtureNames[0], exact: true });
  const taskMenu = page.getByRole('menu', { name: 'Scheduled task menu · ' + fixtureNames[0], exact: true });
  await page.mouse.move(1100, 180);
  assert.equal(await taskActions.evaluate(button => getComputedStyle(button).opacity), '0');
  await activeTask.hover();
  assert.equal(await taskActions.evaluate(button => getComputedStyle(button).opacity), '1');
  await taskActions.click();
  await taskMenu.waitFor();
  const menuBounds = await taskMenu.boundingBox();
  const triggerBounds = await taskActions.boundingBox();
  assert.ok(Math.abs(menuBounds.x + menuBounds.width - triggerBounds.x - triggerBounds.width) <= 1);
  const menuStates = () => taskMenu.getByRole('menuitem').evaluateAll(items => items.map(item => [item.textContent, item.disabled]));
  const activeMenu = [['Pause', false], ['Run now', false], ['Edit', false], ['Share', true], ['Delete', false]];
  assert.deepEqual(await menuStates(), activeMenu);
  assert.match(await taskMenu.getByRole('menuitem', { name: 'Share', exact: true }).getAttribute('title'), /unavailable in this host/);
  if (process.env.DSH_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'scheduled-task-menu.png') });
  await page.keyboard.press('Escape');
  assert.equal(await taskActions.evaluate(button => button === document.activeElement), true);
  await activeTask.click({ button: 'right' });
  assert.deepEqual(await menuStates(), activeMenu);
  await page.keyboard.press('Escape');
  assert.equal(await activeTask.evaluate(button => button === document.activeElement), true);
  await activeTask.press('Shift+F10');
  await taskMenu.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await activeTask.waitFor({ state: 'detached' });
  await pausedTasks.locator('summary').click();
  const pausedTask = pausedTasks.locator('[data-workbench-scheduled-task]').filter({ hasText: fixtureNames[0] });
  await pausedTask.click({ button: 'right' });
  assert.deepEqual(await menuStates(), [['Resume', false], ...activeMenu.slice(1)]);
  await taskMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await schedule.getByRole('complementary', { name: 'Task details' }).waitFor();
  await schedule.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  assert.equal(await pausedTask.getAttribute('aria-current'), 'true');
  await pausedTask.click({ button: 'right' });
  await taskMenu.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  await activeTask.waitFor();
  await schedule.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await activeTask.click({ button: 'right' });
  const deleteEntry = taskMenu.getByRole('menuitem', { name: 'Delete', exact: true });
  assert.equal(await deleteEntry.getAttribute('data-danger'), 'true');
  await deleteEntry.click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete scheduled task · ' + fixtureNames[0], exact: true });
  await deleteDialog.getByText('This cannot be undone.').waitFor();
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await deleteDialog.waitFor({ state: 'detached' });
  await activeTask.waitFor();
  assert.equal(await activeTask.evaluate(button => button === document.activeElement), true);
  await activeTask.click({ button: 'right' });
  await deleteEntry.click();
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await activeTask.waitFor({ state: 'detached' });
  await firstTask.waitFor({ state: 'detached' });
  await subsequentTask.waitFor();
  await homeButton.click();
  await tree.waitFor({ state: 'visible' });
  await children(child).locator('[data-row-key="session:workbench-test-beta"]').waitFor();
  console.log('PASS native Plugins navigation, Scheduled row spacing, two menu triggers, native edit, pause/resume and confirmed delete, and return to the same Home session.');
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
  await sidebarNotice.getByRole('status').getByText('This session will be permanently deleted the next time DSH starts.', { exact: true }).waitFor();
  await sidebarNotice.getByRole('button', { name: 'Close', exact: true }).click();
  await sidebarNotice.waitFor({ state: 'detached' });
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
  await userImage.waitFor();
  assert.equal(await userImage.getAttribute('data-variant'), 'single');
  assert.ok((await userImage.boundingBox()).width > 64);
  if (process.env.DSH_TEST_ARTIFACTS) await userImage.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'user-image-native.png') });
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
