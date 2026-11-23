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
const recordMessage = (id, text) => writeFile(join(temp, 'activity'), JSON.stringify({ id, text }));
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
  await header.getByRole('button', { name: 'View activity' }).waitFor();
  await header.getByRole('button', { name: 'New section', exact: true }).waitFor();
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
  await alpha.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await alpha.locator(':scope > .wb-status-unread').waitFor();
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
  console.log('PASS activity bell, unread priority, open acknowledgement and project list restoration.');
  await alpha.hover();
  await alpha.getByRole('button', { name: 'Pin Chat', exact: true }).click();
  await alpha.getByRole('button', { name: 'Unpin Chat', exact: true }).waitFor();
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await alpha.getByRole('button', { name: 'Unpin Chat', exact: true }).click();
  await alpha.getByRole('button', { name: 'Pin Chat', exact: true }).waitFor();
  assert.equal(await ownRows(projectChildren).first().getAttribute('data-row-key'), 'session:workbench-test-alpha');
  await recordMessage('workbench-test-extra-9', 'Synthetic activity event');
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
  await projectMenu.getByRole('menuitem', { name: 'Recents', exact: true }).waitFor();
  await page.keyboard.press('Escape');
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
  const tabs = page.locator('[data-conversation-tabs]');
  await tabs.getByRole('tab', { name: 'Trajectory' }).click();
  await tabs.getByRole('tab', { name: 'Chat', exact: true }).click();
  await beta.getByRole('button', { name: 'Workbench beta', exact: true }).click();
  await beta.locator('[aria-current="true"]').waitFor();
  console.log('PASS switching to native session beta.');

  const guide = page.locator('[data-workbench-guide]:visible');
  const right = page.locator('[data-sidebar-right-open]');
  const summary = page.locator('[data-workbench-summary]');
  await recordMessage('subagent-fixture', '');
  const summaryButton = page.getByRole('button', { name: 'Toggle pinned summary' });
  await summaryButton.click();
  await summary.getByRole('button', { name: join(temp, 'workspace', 'child-project'), exact: true }).waitFor();
  await summary.getByRole('button', { name: 'Subagents' }).click();
  const agents = right.locator('.wb-agent-list');
  await agents.getByRole('heading', { name: 'Done · 1' }).waitFor();
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
  await recents.hover();
  await recents.getByRole('button', { name: 'Add project', exact: true }).click();
  await projectName.fill('Recents fixture');
  await projectName.press('Enter');
  await picker.getByRole('textbox', { name: 'Directory path' }).fill(recentsProjectPath);
  await picker.getByRole('button', { name: 'Use this directory' }).click();
  const recentsProject = recents.locator('..').getByRole('button', { name: 'Recents fixture', exact: true });
  await recentsProject.waitFor();

  const topNewSession = page.locator('.wb-section-session').getByRole('button', { name: 'New session', exact: true });
  const topDraft = await openDraft(topNewSession, childDraft);
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
  for (let attempt = 0; attempt < 50; attempt++) {
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
