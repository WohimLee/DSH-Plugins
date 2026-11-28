import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { APP_IDENTITY, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { chromium } from 'playwright-core';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(directory, '../../..');
const cli = resolve(process.env.DSH_TEST_CLI ?? join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
const temp = await mkdtemp(join(tmpdir(), 'dsh-grok-'));
const home = join(temp, 'home');
const env = {
  PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home, TMPDIR: temp,
  SYSTEMROOT: process.env.SYSTEMROOT, NO_PROXY: 'api.x.ai,127.0.0.1,localhost', CI: 'true', NO_COLOR: '1', DEEPSEEK_API_KEY: 'fixture-deepseek-key',
  npm_config_store_dir: process.env.npm_config_store_dir, npm_config_offline: process.env.npm_config_offline,
};
const exec = promisify(execFile);
const run = async (command, args, cwd = temp) => (await exec(command, args, { cwd, env, timeout: 180000 })).stdout;
let current, browser;
const requests = [];
const model = { id: 'grok-fixture', capabilities: { reasoning_effort: ['low', 'high'], default_reasoning_effort: 'high' }, input_modalities: ['text'], output_modalities: ['text'] };
const workModel = { ...model, id: 'grok-work-fixture' };
const modelsByKey = new Map([
  ['Bearer fixture-grok-key', model],
  ['Bearer fixture-grok-work-key', workModel],
]);
const reply = 'Hello from the Grok stream.';
const workReply = 'Hello from the Grok work stream.';
const fixturePrompt = 'Reply using the selected Grok API account.';
function outputItem(content) {
  return { type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant', content };
}
function completion(item, servedModel) {
  return { id: 'resp_fixture', model: servedModel, status: 'completed', output: [item],
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
}
const platform = createServer(async (request, response) => {
  const servedModel = modelsByKey.get(request.headers.authorization);
  if (!servedModel) return response.writeHead(401).end();
  if (request.url === '/v1/language-models' || request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(
      request.url.endsWith('/language-models') ? { models: [servedModel] } : { data: [{ id: servedModel.id, context_length: 200_000 }] },
    ));
    return;
  }
  if (request.url !== '/v1/responses') return response.writeHead(404).end();
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  if (payload.model !== servedModel.id) return response.writeHead(403).end();
  requests.push({ headers: request.headers, body: payload });
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const answer = servedModel === workModel ? workReply : reply;
  const added = { type: 'output_text', text: '', annotations: [] };
  const done = { ...added, text: answer };
  const events = [
    { type: 'response.created', response: { ...completion(outputItem([]), servedModel.id), status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: outputItem([]) },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: added },
    { type: 'response.output_text.delta', item_id: 'msg_fixture', output_index: 0, content_index: 0, delta: answer },
    { type: 'response.content_part.done', item_id: 'msg_fixture', output_index: 0, content_index: 0, part: done },
    { type: 'response.output_item.done', output_index: 0, item: outputItem([done]) },
    { type: 'response.completed', response: completion(outputItem([done]), servedModel.id) },
  ];
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});

async function launch(preload) {
  const host = spawn(process.execPath, ['--import', preload, cli, 'web', '--port', '0', '--no-open'], { cwd: temp, env });
  current = { host, closed: new Promise(accept => host.once('close', accept)), log: '' };
  for (const stream of [host.stdout, host.stderr]) stream.on('data', chunk => {
    current.log = (current.log + chunk).slice(-20000);
  });
  for (let attempt = 0; attempt < 150 && host.exitCode === null; attempt++) {
    const urls = [...current.log.matchAll(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/g)].map(match => new URL(match[0]));
    const url = urls.find(candidate => candidate.search);
    if (url) return url;
    await delay(200);
  }
  assert.fail(publicLog(current.log));
}

function publicLog(log) {
  return log.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
}

async function stopHost() {
  if (!current) return;
  current.host.kill();
  await current.closed;
  current = undefined;
}

async function openApp(url, locale = 'en-US') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale, colorScheme: 'dark' });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(url.href);
  const proceed = page.getByRole('button', { name: /^(Continue|继续)$/ });
  if (await proceed.waitFor({ timeout: 3000 }).then(() => true, () => false)) await proceed.click();
  const dialog = page.getByRole('dialog').filter({ hasText: /Get started|开始使用/ });
  if (await dialog.waitFor({ timeout: 2500 }).then(() => true, () => false)) {
    await dialog.getByRole('button', { name: /^(Close|关闭)$/ }).click();
  }
  return page;
}

async function management(page) {
  await page.getByRole('button', { name: 'Model management', exact: true }).click();
  const panel = page.getByRole('main', { name: 'Model management' });
  return {
    panel,
    connection: panel.getByRole('region', { name: 'Grok', exact: true }),
    groups: panel.getByRole('region', { name: 'Available models' }).locator('summary').filter({ hasText: 'Grok' }),
  };
}

async function settings(page) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Settings/ }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' });
  await dialog.getByRole('button', { name: 'Grok', exact: true }).click();
  return dialog.getByRole('region', { name: 'Grok API accounts' });
}

async function send(page, target) {
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click();
  const composer = page.locator('[data-composer-card]');
  await composer.locator('button[aria-haspopup="menu"]').filter({ hasText: /DeepSeek|Grok|Select model/i }).click();
  await page.getByRole('menuitem', { name: /^Models(?: |$)/ }).hover();
  const providers = page.locator('[data-provider-row]');
  await providers.filter({ hasText: 'Grok' }).first().hover();
  const named = providers.filter({ hasText: 'Grok · Work' });
  if (target === workModel) {
    if (await named.count()) await named.hover();
    else {
      const accounts = page.locator('[data-dsh-model-picker]').getByLabel('Account', { exact: true });
      const workAccount = accounts.getByRole('option', { name: /^Work(?: · API)?$/ });
      const value = await workAccount.getAttribute('value');
      assert.ok(value, 'named Grok account exposes a route value');
      await accounts.selectOption(value);
    }
  }
  await page.getByText(target.id, { exact: true }).click();
  await composer.locator('[contenteditable=true]').fill(fixturePrompt);
  await composer.locator('[contenteditable=true]').press('Enter');
  await page.getByText(target === workModel ? workReply : reply, { exact: true }).first().waitFor({ timeout: 20_000 });
}

try {
  await mkdir(home);
  const credentialsFixture = join(home, '.credentials.yaml');
  await writeFile(credentialsFixture, `version: 1
records:
  dsh-grok/api-key:
    kind: grant
    payload: fixture-grok-key
`, { mode: 0o600 });
  await new Promise((accept, reject) => {
    platform.once('error', reject);
    platform.listen(0, '127.0.0.1', accept);
  });
  const preload = join(temp, 'preload.mjs');
  await writeFile(preload, `
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === 'api.x.ai') {
    const local = new URL(url.pathname + url.search, 'http://127.0.0.1:${platform.address().port}');
    return fetchOriginal(input instanceof Request ? new Request(local, input) : local, options);
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return fetchOriginal(input, options);
  return Promise.reject(new Error('External network disabled in Grok fixture'));
};
`);
  const tarballs = [];
  for (const source of [directory, join(root, 'plugins/ui/model-picker')]) {
    if (source !== directory && process.env.DSH_TEST_MODEL_PICKER_TARBALL) {
      tarballs.push(resolve(process.env.DSH_TEST_MODEL_PICKER_TARBALL));
      continue;
    }
    const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    const artifactDir = (source === directory ? process.env.DSH_TEST_ARTIFACT_DIR : process.env.DSH_TEST_MODEL_PICKER_ARTIFACT_DIR) || temp;
    if (artifactDir === temp) await run('pnpm', ['pack', '--pack-destination', temp], source);
    tarballs.push(join(artifactDir, `${pkg.name}-${pkg.version}.tgz`));
  }
  const files = (await run('tar', ['-tzf', tarballs[0]])).trim().split('\n');
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/transport.js', 'lib/proxy.js', 'lib/proxy.d.ts', 'lib/model-network-failure.js', 'lib/model-network-recovery.js', 'locale/en.json', 'locale/zh.json', 'cordis.patch.yml', 'README.md']) {
    assert.ok(files.includes(`package/${file}`), file);
  }
  await run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', ...tarballs, '--ignore-scripts', '--prefer-offline']);
  const url = await launch(preload);
  browser = await chromium.launch(process.env.DSH_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE } : { channel: 'chrome' });
  const page = await openApp(url);
  const { panel, connection, groups } = await management(page);
  await connection.getByText('Connected with an xAI API Key').waitFor();
  await groups.first().waitFor();
  assert.equal(await connection.locator('img').evaluate(image => image.naturalWidth), 96);
  const legacyUsage = connection.getByRole('button', { name: 'Grok usage' });
  const hasOverviewUsage = await legacyUsage.count() > 0;
  if (!hasOverviewUsage) await connection.getByRole('button', { name: 'View connection' }).click();
  const usage = hasOverviewUsage ? connection : panel.getByRole('region', { name: 'Usage', exact: true });
  await usage.getByRole('button', { name: 'Grok usage' }).hover();
  await usage.getByRole('tooltip').getByText('View API usage in the xAI Console.').waitFor();

  const api = await settings(page);
  await api.getByText('Default account', { exact: true }).waitFor();
  await api.getByRole('button', { name: 'Replace key for Default account' }).click();
  const keyInput = api.getByLabel('xAI API Key', { exact: true });
  assert.equal(await keyInput.inputValue(), '');
  await keyInput.fill('invalid');
  await api.getByRole('button', { name: 'Replace key', exact: true }).click();
  await api.getByRole('alert').filter({ hasText: 'xAI rejected' }).waitFor();
  await api.getByRole('button', { name: 'Cancel', exact: true }).click();
  const addProvider = page.getByRole('button', { name: 'Add provider', exact: true });
  const hasProviderSetup = (await addProvider.count()) > 0;
  let setup = api;
  if (hasProviderSetup) {
    await page.keyboard.press('Escape');
    await addProvider.click();
    await page.getByLabel('Provider', { exact: true }).selectOption('grok');
    const method = page.getByLabel('Connection method', { exact: true });
    await method.selectOption('desktop');
    const detection = page.locator('.dsh-desktop-detection').filter({ hasText: 'Grok Bot desktop app' });
    await detection.getByRole('status').filter({ hasText: /^(Installed|Not detected|Check unavailable)$/ }).waitFor();
    await page.getByText(/DSH cannot use the Grok Bot sign-in yet/).waitFor();
    assert.equal(await page.getByLabel('xAI API Key', { exact: true }).count(), 0);
    await method.selectOption('api');
    setup = page.getByRole('region', { name: 'Grok API accounts' });
  }
  await setup.getByLabel('Account name', { exact: true }).fill('Work');
  await setup.getByLabel('xAI API Key', { exact: true }).fill('fixture-grok-work-key');
  await setup.getByRole('button', { name: 'Connect', exact: true }).click();
  await setup.getByText('Work', { exact: true }).waitFor();
  assert.equal(await setup.getByRole('listitem').count(), 2);
  if (!hasProviderSetup) await page.keyboard.press('Escape');

  await send(page, model);
  const other = await openApp(url);
  await send(other, workModel);
  await other.close();
  for (const [index, expected] of [model, workModel].entries()) {
    const inference = requests.find(request => request.body.model === expected.id && request.body.input.some(
      item => item.role === 'user' && item.content?.some?.(block => block.text === fixturePrompt),
    ));
    assert.ok(inference, expected.id);
    assert.equal(inference.body.model, expected.id);
    assert.equal(inference.body.stream, true);
    assert.equal(inference.body.reasoning?.effort, 'high');
    assert.equal(inference.headers.authorization, index === 0 ? 'Bearer fixture-grok-key' : 'Bearer fixture-grok-work-key');
    for (const [key, value] of Object.entries(attributionHeaders({ ...APP_IDENTITY, suffix: 'dsh-profile/web' }))) {
      assert.equal(inference.headers[key], value);
    }
  }

  const savedDocument = await readFile(credentialsFixture, 'utf8');
  const namedRecord = savedDocument.match(/dsh-grok\/account-[a-f0-9-]+/)?.[0];
  assert.ok(namedRecord);
  assert.ok(savedDocument.includes('dsh-grok/api-key'));
  await page.close();
  await stopHost();
  const restartUrl = await launch(preload);
  const restarted = await openApp(restartUrl);
  const saved = await management(restarted);
  await saved.groups.first().waitFor();
  const savedApi = await settings(restarted);
  await savedApi.getByText('Default account', { exact: true }).waitFor();
  await savedApi.getByText('Work', { exact: true }).waitFor();
  await savedApi.getByRole('button', { name: 'Disconnect Work', exact: true }).click();
  await savedApi.getByText('Work', { exact: true }).waitFor({ state: 'hidden' });
  const afterWork = await readFile(credentialsFixture, 'utf8');
  assert.ok(!afterWork.includes(namedRecord));
  assert.ok(afterWork.includes('dsh-grok/api-key'));
  await restarted.keyboard.press('Escape');
  await saved.connection.getByRole('button', { name: 'Remove Grok', exact: true }).click();
  const remove = saved.panel.getByRole('dialog', { name: 'Remove Grok', exact: true });
  await remove.getByRole('button', { name: 'Remove', exact: true }).click();
  await remove.waitFor({ state: 'detached' });
  await saved.groups.first().waitFor({ state: 'hidden' });
  if (hasProviderSetup) await saved.connection.waitFor({ state: 'hidden' });
  const removed = await readFile(credentialsFixture, 'utf8');
  assert.ok(!removed.includes('fixture-grok-key') && !removed.includes('fixture-grok-work-key'));

  const chinese = await openApp(restartUrl, 'zh-CN');
  await chinese.getByRole('button', { name: '账号菜单', exact: true }).click();
  await chinese.getByRole('menuitem', { name: /^设置/ }).click();
  const dialog = chinese.getByRole('dialog').filter({ hasText: '设置' });
  await dialog.getByRole('button', { name: 'Grok', exact: true }).click();
  await chinese.setViewportSize({ width: 560, height: 900 });
  await dialog.getByRole('region', { name: 'Grok API 账号' }).getByLabel('账号名称', { exact: true }).waitFor();
  console.log('PASS isolated Web Grok legacy credential, separate API accounts, model and streaming isolation, restart and disconnect.');
} catch (error) {
  if (current?.log) console.error(publicLog(current.log));
  throw error;
} finally {
  await browser?.close();
  await stopHost();
  platform.close();
  await rm(temp, { force: true, recursive: true });
}
