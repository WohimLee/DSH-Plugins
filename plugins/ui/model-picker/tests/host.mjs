import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(directory, '../../..');
const cli = resolve(process.env.DSH_TEST_CLI ?? join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
const temp = await mkdtemp(join(tmpdir(), 'dsh-model-picker-'));
const home = join(temp, 'home');
const codexHome = join(home, '.codex');
const env = {
  PATH: process.env.PATH, HOME: home, USERPROFILE: home, DSH_HOME: home, CODEX_HOME: codexHome,
  TMPDIR: process.env.TMPDIR ?? tmpdir(), SYSTEMROOT: process.env.SYSTEMROOT, CI: 'true', NO_COLOR: '1',
  NO_PROXY: '*',
  DEEPSEEK_API_KEY: 'fixture-key',
};
const exec = promisify(execFile);
const run = async (command, args, cwd = temp) => (await exec(command, args, { cwd, env, timeout: 180000 })).stdout;
const dsh = args => run(process.execPath, [cli, ...args]);
const binary = join(temp, 'codex-fixture');
const qoder = join(temp, 'qoder-fixture');
const fixtureFetch = join(temp, 'provider-api-fixtures.mjs');
const patch = join(temp, 'model-picker.yml');
let host, closed, browser, page, log = '';
const platform = createServer((request, response) => {
  if (request.headers['x-dsh-auth-token'] !== 'synthetic-dsh-grant') return response.writeHead(401).end();
  const path = request.url?.split('?')[0];
  if (path?.endsWith('/models')) {
    return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      object: 'list', data: [{ id: 'deepseek-v4.1-flash', object: 'model', created: 0, owned_by: 'deepseek' }],
    }));
  }
  const value = path === '/api/v0/users/get_user_summary' ? {
    normal_wallets: [{ currency: 'CNY', balance: '23.48' }],
    bonus_wallets: [{ currency: 'CNY', balance: '7.00' }],
  } : path === '/auth-api/v0/users/current'
    ? { id: 'picker-test-user', email: '', id_profile: { name: 'Picker fixture' } }
    : { notifications: [], next_poll_after: 600 };
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    code: 0, data: { biz_code: 0, biz_data: value },
  }));
});
try {
  await mkdir(codexHome, { recursive: true });
  await new Promise((accept, reject) => {
    platform.once('error', reject);
    platform.listen(0, '127.0.0.1', accept);
  });
  const origin = `http://127.0.0.1:${platform.address().port}`;
  await writeFile(join(home, '.credentials.yaml'), `version: 1
refs: {}
records:
  deepseek-account-platform/default:
    kind: grant
    payload:
      version: 1
      token: synthetic-dsh-grant
      issuer: ${origin}
`, { mode: 0o600 });
  await writeFile(join(codexHome, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'codex-fixture', display_name: 'Codex Fixture', input_modalities: ['text', 'image'], visibility: 'list', supported_in_api: true,
      supported_reasoning_levels: [{ effort: 'high' }, { effort: 'low' }] },
    ...Array.from({ length: 9 }, (_, i) => ({
      slug: `codex-long-${i}`, display_name: `Codex model ${i + 2}`, visibility: 'list', supported_in_api: true,
    })),
  ] }));
  await writeFile(binary, `#!/usr/bin/env node
const readline = require('node:readline');
for (const key of ['CODEX_HOME']) if (!process.env[key]) process.exit(2);
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method } = JSON.parse(line);
  if (method === 'initialize') console.log(JSON.stringify({ id, result: {} }));
  if (method === 'account/rateLimits/read') console.log(JSON.stringify({ id, result: { rateLimits: {
    primary: { usedPercent: 18, windowDurationMins: 300 },
    secondary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: 1810000000 }
  } } }));
});
`, { mode: 0o755 });
  await writeFile(qoder, `#!/usr/bin/env node
const readline = require('node:readline');
let remaining;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { request, request_id } = JSON.parse(line);
  const reply = response => console.log(JSON.stringify({ type: 'control_response', response: {
    subtype: 'success', request_id, response,
  } }));
  if (request.type === 'daemon.initialize') {
    const auth = JSON.stringify(request.auth);
    remaining = auth.includes('fixture-work') ? 240 : auth.includes('fixture-personal') ? 60 : undefined;
    reply({ daemon_protocol_version: 2, daemon_version: 'fixture', capabilities: ['multi_session_v2', 'daemon_queries_v1'] });
  }
  if (request.type === 'daemon.open_session' && remaining === undefined) {
    console.log(JSON.stringify({ type: 'control_response', response: {
      subtype: 'error', request_id, code: 'AUTH_REQUIRED', error: 'Authentication required.',
    } }));
  }
  if (request.type === 'daemon.get_models') {
    const models = remaining === 60 ? [{ value: 'auto', displayName: 'Auto', description: '' }]
      : remaining === 240 ? [{ value: 'lite', displayName: 'Lite', description: '' }]
      : [];
    reply({ models });
  }
  if (request.type === 'daemon.get_usage_info') {
    reply({ usage: remaining === undefined ? null : { userQuota: { total: 300, remaining },
      addOnQuota: { total: 100, remaining: 20 } }, session: {} });
  }
  if (request.type === 'daemon.shutdown') reply(undefined);
});
`, { mode: 0o755 });
  await writeFile(fixtureFetch, `
const original = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = new Headers(options.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.href === 'https://api.openai.com/v1/models') {
    return headers.get('authorization') === 'Bearer fixture-codex-api'
      ? Response.json({ data: [{ id: 'gpt-5.3-codex' }, { id: 'gpt-unrelated' }] })
      : new Response(null, { status: 401 });
  }
  if (url.href === 'https://api.deepseek.com/models') {
    return headers.get('x-api-key') === 'fixture-deepseek-api'
      ? Response.json({ data: [{ id: 'deepseek-flash', input_modalities: ['text'], api_capabilities: { anthropic_messages: {} } }] })
      : new Response(null, { status: 401 });
  }
  return original(input, options);
};
`);
  await writeFile(patch, `- id: deepseek-account
  config:
    platformOrigin: ${origin}
    harnessOrigin: ${origin}
    allowLoopbackHttp: true
- id: llm-deepseek-account
  config:
    baseURL: ${origin}/anthropic
- id: llm-deepseek
  config:
    baseURL: http://127.0.0.1:9
- id: dsh-codex:main
  config:
    codexPath: ${JSON.stringify(binary)}
- id: dsh-qoder:main
  config:
    cliPath: ${JSON.stringify(qoder)}
`);
  const packages = [directory, join(root, 'plugins/runtime/codex'), join(root, 'plugins/runtime/qoder')];
  const tarballs = [];
  for (const dir of packages) {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const artifactDir = dir === directory && process.env.DSH_TEST_ARTIFACT_DIR;
    if (!artifactDir) await run('pnpm', ['pack', '--pack-destination', temp], dir);
    tarballs.push(join(artifactDir || temp, `${pkg.name}-${pkg.version}.tgz`));
  }
  const files = await run('tar', ['-tzf', tarballs[0]]);
  for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md']) assert.ok(files.includes(`package/${file}`));
  await dsh(['plugin', '--profile', 'web', 'add', ...tarballs, '--ignore-scripts']);
  host = spawn(process.execPath, ['--import', fixtureFetch, cli, 'web', '--patch', patch, '--port', '0', '--no-open'],
    { cwd: temp, env });
  closed = new Promise(accept => host.on('close', accept));
  for (const stream of [host.stdout, host.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-30000); });
  let url;
  for (let attempt = 0; attempt < 150 && host.exitCode === null; attempt++) {
    const urls = [...log.matchAll(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/g)].map(match => new URL(match[0]));
    url = urls.find(candidate => candidate.search);
    if (url) break;
    await delay(200);
  }
  assert.ok(url, log);
  browser = await chromium.launch(process.env.DSH_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE } : { channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(url.href);
  await page.getByRole('button', { name: /Continue|继续/, exact: true }).click({ timeout: 15000 });
  const dialog = page.getByRole('dialog').filter({ hasText: 'Get started' });
  await dialog.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  const trigger = page.locator('[data-composer-card] button[aria-haspopup="menu"]').filter({ hasText: /DeepSeek|Select model/i });
  const visibleProviders = page.locator('[data-dsh-model-picker] [data-provider-row]');
  const openModels = async () => {
    await trigger.click();
    await page.getByRole('menuitem', { name: /^Models(?: |$)/ }).hover();
    await visibleProviders.filter({ hasText: 'DeepSeek' }).waitFor();
  };
  const closeModels = async () => {
    await page.keyboard.press('Escape');
    if (await page.getByRole('menuitem', { name: /^Models(?: |$)/ }).isVisible()) await page.keyboard.press('Escape');
  };
  await openModels();
  assert.equal(await visibleProviders.filter({ hasText: 'Qoder' }).count(), 0, 'unbound accounts must not appear in Models');
  assert.equal(await visibleProviders.filter({ hasText: 'Codex' }).count(), 0, 'a Codex cache alone must not advertise models');
  await closeModels();

  await page.getByRole('button', { name: 'Model management', exact: true }).click();
  const management = page.getByRole('main', { name: 'Model management' });
  const codexConnection = management.getByRole('region', { name: 'Codex', exact: true });
  const available = management.getByRole('region', { name: 'Available models' });
  const qoderConnection = management.getByRole('region', { name: 'Qoder', exact: true });
  const deepseekConnection = management.getByRole('region', { name: 'DeepSeek', exact: true });
  const nav = management.getByRole('navigation', { name: 'Model management' });
  const overview = nav.getByRole('button', { name: 'Overview', exact: true });
  const addProvider = nav.getByRole('button', { name: 'Add provider', exact: true });
  const providerInput = management.getByRole('combobox', { name: 'Provider', exact: true });
  const methodInput = management.getByRole('combobox', { name: 'Connection method', exact: true });
  const openCodex = codexConnection.getByRole('button', { name: 'View connection' });
  const qoderAddForm = management.getByRole('form', { name: 'Add account' });
  const setupQoder = async (method = 'api') => {
    await addProvider.click();
    await methodInput.selectOption(method);
    await providerInput.selectOption('qoder');
  };

  await deepseekConnection.waitFor();
  assert.equal(await overview.getAttribute('aria-current'), 'page');
  assert.equal(await nav.getByRole('button', { name: /^(Codex|Qoder|Grok)$/ }).count(), 0);
  assert.equal(await codexConnection.count(), 0);
  assert.equal(await qoderConnection.count(), 0);
  const layout = () => management.locator('.dsh-connection-card').evaluateAll(cards => cards.map(card => ({
    ...card.getBoundingClientRect().toJSON(), provider: card.querySelector('.dsh-connection-icon')?.dataset.provider,
  })));

  await addProvider.click();
  await providerInput.selectOption('codex');
  await methodInput.selectOption('desktop');
  await management.getByText('codex login', { exact: true }).waitFor();
  await management.getByText('Installed', { exact: true }).waitFor();
  await management.getByText('Signed out', { exact: true }).waitFor();
  await methodInput.selectOption('api');
  assert.equal(await management.getByText('Desktop app', { exact: true }).count(), 0);
  await management.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  await overview.evaluate(node => {
    if (node.getAttribute('aria-current') !== 'page') throw new Error('Cancel must return to Overview');
  });

  await setupQoder('desktop');
  await management.getByText('Desktop app', { exact: true }).waitFor();
  assert.equal(await qoderAddForm.count(), 0);
  await methodInput.selectOption('api');
  await qoderAddForm.getByLabel('Personal access token').waitFor();
  await overview.click();
  assert.equal(await available.locator('summary').filter({ hasText: 'Codex' }).count(), 0);
  const auth = join(codexHome, 'auth.json');
  await writeFile(auth, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'codex-fixture-token', account_id: 'codex-fixture-account' } }));
  await codexConnection.getByRole('status').filter({ hasText: 'Local Codex sign-in detected' }).waitFor();
  const wide = await layout();
  assert.deepEqual(wide.map(card => card.provider), ['codex', 'deepseek']);
  assert.equal(wide[0].top, wide[1].top, 'desktop cards share a row');
  await page.setViewportSize({ width: 560, height: 900 });
  const narrow = await layout();
  assert.ok(narrow[1].top > narrow[0].top, 'narrow views stack cards');
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCodex.focus();
  await page.keyboard.press('Enter');
  await management.getByRole('heading', { name: 'Codex', exact: true, level: 1 }).waitFor();
  assert.equal(await nav.getByRole('button', { name: 'Codex', exact: true }).getAttribute('aria-current'), 'page');
  await management.getByRole('region', { name: 'Desktop', exact: true }).getByText('Signed in', { exact: true }).waitFor();
  await overview.click();
  const cardTitle = await codexConnection.getByRole('heading', { name: 'Codex', exact: true }).boundingBox();
  await page.mouse.click(cardTitle.x + cardTitle.width / 2, cardTitle.y + cardTitle.height / 2);
  await management.getByRole('heading', { name: 'Codex', exact: true, level: 1 }).waitFor();
  await overview.click();
  const connectedCodex = available.locator('summary').filter({ hasText: 'Codex' });
  await connectedCodex.click();
  const fixture = available.getByRole('listitem').filter({ hasText: 'Codex Fixture' });
  await fixture.getByText(/声明输入：text、image。/).waitFor();
  // The same route can lose a capability while the management page is open.
  const cachePath = join(codexHome, 'models_cache.json');
  const before = await readFile(cachePath, 'utf8');
  const updated = JSON.parse(before);
  updated.models[0].input_modalities = ['text'];
  await writeFile(cachePath, JSON.stringify(updated));
  await fixture.getByText(/声明输入：text。/).waitFor();
  await writeFile(cachePath, before);
  await fixture.getByText(/声明输入：text、image。/).waitFor();
  await rm(auth);
  await codexConnection.waitFor({ state: 'detached' });
  await nav.getByRole('button', { name: 'Codex', exact: true }).waitFor({ state: 'detached' });
  await connectedCodex.waitFor({ state: 'detached' });
  await writeFile(auth, JSON.stringify({ tokens: { access_token: 'codex-fixture-token', account_id: 'codex-fixture-account' } }));
  await connectedCodex.waitFor();
  const codexUsage = codexConnection.getByRole('button', { name: 'Codex usage' });
  const codexTooltip = codexConnection.getByRole('tooltip');
  assert.equal(await codexTooltip.isVisible(), false);
  const beforeUsage = await layout();
  await codexUsage.hover();
  await codexTooltip.getByText(/Weekly · 62% left.*Resets/).waitFor();
  await codexTooltip.getByText(/5 (?:hr|hours) · 82% left/).waitFor();
  assert.equal(await codexUsage.getAttribute('data-remaining'), '62');
  assert.deepEqual(await layout(), beforeUsage, 'the usage tooltip does not move the cards');
  await deepseekConnection.getByRole('button', { name: 'DeepSeek usage' }).hover();
  await deepseekConnection.getByRole('tooltip').getByText(/Bonus balance.*7\.00/).waitFor();
  await deepseekConnection.getByRole('tooltip').getByText(/Account balance.*23\.48/).waitFor();
  await setupQoder();
  const addToken = qoderAddForm.getByLabel('Personal access token');
  const addRemark = qoderAddForm.getByLabel('Remark (optional)');
  // The first Desktop check can replace the connection contribution while the
  // test switches methods. Complete both fields on the settled API form before
  // attempting the one write.
  for (let attempt = 0; attempt < 3; attempt++) {
    await addRemark.fill('Managed from sidebar');
    await addToken.fill('fixture-personal');
    if (await addToken.inputValue() === 'fixture-personal' && await addRemark.inputValue() === 'Managed from sidebar') break;
  }
  assert.equal(await addToken.inputValue(), 'fixture-personal');
  assert.equal(await addRemark.inputValue(), 'Managed from sidebar');
  await qoderAddForm.getByRole('button', { name: 'Bind account' }).click();
  await management.getByRole('heading', { name: 'Qoder', exact: true, level: 1 }).waitFor();
  const managedQoder = management.getByRole('group', { name: 'Managed from sidebar' });
  await managedQoder.waitFor();
  await overview.click();
  const connectedQoder = available.locator('summary').filter({ hasText: 'Qoder' });
  await connectedQoder.waitFor();
  const manageQoder = qoderConnection.getByRole('button', { name: 'Manage accounts' });
  await qoderConnection.getByText('Connected', { exact: true }).waitFor();
  assert.equal(await managedQoder.isVisible(), false);
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await management.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'model-management.png') });
    await codexUsage.hover();
    await management.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'model-management-usage.png') });
  }
  await manageQoder.click();
  await managedQoder.getByRole('button', { name: 'Unbind' }).click();
  await management.getByRole('heading', { name: 'Model management', exact: true, level: 1 }).waitFor();
  await qoderConnection.waitFor({ state: 'detached' });
  await nav.getByRole('button', { name: 'Qoder', exact: true }).waitFor({ state: 'detached' });
  await connectedQoder.waitFor({ state: 'detached' });
  await addProvider.click();
  await providerInput.selectOption('codex');
  await methodInput.selectOption('api');
  await management.getByLabel('OpenAI API key').fill('invalid-codex-key');
  await management.getByLabel('Account name').fill('Codex API fixture');
  await management.getByRole('button', { name: 'Connect', exact: true }).click();
  await management.getByRole('alert').getByText('The provider rejected this API key.').waitFor();
  await management.getByLabel('OpenAI API key').fill('fixture-codex-api');
  await management.getByRole('button', { name: 'Connect', exact: true }).click();
  await management.getByRole('heading', { name: 'Codex', exact: true, level: 1 }).waitFor();
  const codexApi = management.getByRole('region', { name: 'API', exact: true });
  await codexApi.getByText('Codex API fixture', { exact: true }).waitFor();
  await codexApi.getByRole('button', { name: 'Remove', exact: true }).click();
  await codexApi.getByText('Codex API fixture', { exact: true }).waitFor({ state: 'detached' });

  await addProvider.click();
  await providerInput.selectOption('deepseek');
  await methodInput.selectOption('api');
  await management.getByLabel('API key', { exact: true }).fill('fixture-deepseek-api');
  await management.getByLabel('Account name').fill('DeepSeek API fixture');
  await management.getByRole('button', { name: 'Connect', exact: true }).click();
  await management.getByRole('heading', { name: 'DeepSeek', exact: true, level: 1 }).waitFor();
  const deepseekApi = management.getByRole('region', { name: 'API', exact: true });
  await deepseekApi.getByText('DeepSeek API fixture', { exact: true }).waitFor();
  await deepseekApi.getByRole('button', { name: 'Remove', exact: true }).click();
  await deepseekApi.getByText('DeepSeek API fixture', { exact: true }).waitFor({ state: 'detached' });
  await overview.click();
  console.log('PASS Model management: Overview, connected-only sidebar and cards, keyboard and pointer navigation, Desktop detection, API configuration, and live catalog updates.');
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click();

  const openSettings = async () => {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    await page.getByRole('dialog').filter({ hasText: 'Settings' }).getByRole('button', { name: 'Qoder', exact: true }).click();
  };
  await openSettings();
  const settings = page.getByRole('dialog').filter({ hasText: 'Settings' });
  const qoderSettings = settings.getByRole('region', { name: 'Qoder accounts' });
  const bind = async (remark, token) => {
    await qoderSettings.getByRole('button', { name: 'Add account', exact: true }).click();
    const form = qoderSettings.getByRole('form', { name: 'Add account' });
    await form.getByLabel('Personal access token').fill(token);
    if (remark) await form.getByLabel('Remark (optional)').fill(remark);
    await form.getByRole('button', { name: 'Bind account' }).click();
    await form.waitFor({ state: 'detached' });
    const card = qoderSettings.getByRole('group', { name: remark || /^Account /, exact: true });
    await card.getByText('Connected · 1 available model').waitFor();
    return card;
  };
  assert.equal(await qoderSettings.getByRole('group', { name: /^(Personal|Work|Account )/ }).count(), 0);
  const unnamed = await bind('', 'fixture-personal');
  await unnamed.getByLabel('Remark', { exact: true }).fill('Personal');
  await unnamed.getByRole('button', { name: 'Save remark' }).click();
  await qoderSettings.getByRole('group', { name: 'Personal', exact: true }).waitFor();
  await bind('Work', 'fixture-work');

  const options = page.locator('[data-dsh-model-picker]').getByLabel('Account', { exact: true }).locator('option');
  const workOption = options.filter({ hasText: /^Work · API$/ });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await openModels();
  await visibleProviders.filter({ hasText: 'Qoder' }).hover();
  const originalWorkRoute = await workOption.getAttribute('value');
  assert.match(originalWorkRoute, /^qoder-account-a-[0-9a-f]{24}$/);
  await closeModels();

  await openSettings();
  const work = qoderSettings.getByRole('group', { name: 'Work', exact: true });
  await work.getByLabel('Remark', { exact: true }).fill('Research');
  await work.getByRole('button', { name: 'Save remark' }).click();
  const renamed = qoderSettings.getByRole('group', { name: 'Research', exact: true });
  await renamed.waitFor();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await openModels();
  await visibleProviders.filter({ hasText: 'Qoder' }).hover();
  assert.equal(await options.filter({ hasText: /^Research · API$/ }).getAttribute('value'), originalWorkRoute);
  await closeModels();

  await openSettings();
  await renamed.getByRole('button', { name: 'Unbind' }).click();
  await renamed.waitFor({ state: 'detached' });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await openModels();
  await visibleProviders.filter({ hasText: 'Qoder' }).hover();
  await page.locator('[data-dsh-model-picker] [data-model-row]').getByText('Auto', { exact: true }).waitFor();
  assert.equal(await options.filter({ hasText: /^Research · API$/ }).count(), 0);
  await closeModels();

  await openSettings();
  await bind('Work', 'fixture-work');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await openModels();
  await visibleProviders.filter({ hasText: 'Qoder' }).hover();
  const workRoute = await workOption.getAttribute('value');
  assert.notEqual(workRoute, originalWorkRoute);
  await closeModels();

  await page.getByRole('button', { name: 'Model management', exact: true }).click();
  const qoderAccount = qoderConnection.getByRole('combobox', { name: 'Qoder account' });
  const qoderUsage = qoderConnection.getByRole('button', { name: 'Qoder usage' });
  const qoderTooltip = qoderConnection.getByRole('tooltip');
  await qoderAccount.selectOption({ label: 'Personal' });
  await qoderUsage.focus();
  await qoderTooltip.getByText('Plan · 60 / 300 Credits left', { exact: true }).waitFor();
  assert.equal(await qoderUsage.getAttribute('data-remaining'), '20');
  await qoderAccount.selectOption(workRoute);
  await qoderUsage.hover();
  await qoderTooltip.getByText('Plan · 240 / 300 Credits left', { exact: true }).waitFor();
  await qoderTooltip.getByText('Add-on · 20 / 100 Credits left', { exact: true }).waitFor();
  assert.equal(await qoderUsage.getAttribute('data-remaining'), '80');
  assert.equal(await management.getByRole('dialog').count(), 0, 'account and usage controls must not open details');
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click();

  console.log('PASS isolated Web Qoder accounts: no preset accounts, optional remarks, stable routes on rename and removal on unbind.');

  await trigger.click();
  const browse = page.getByRole('menuitem', { name: /^Models(?: |$)/ });
  if (!await browse.isVisible()) {
    await page.getByRole('menuitemradio', { name: /DeepSeek/i }).first().click();
    await trigger.click();
  }
  const stockModel = page.getByRole('menuitem', { name: /^Model(?: |$)/ });
  assert.equal(await stockModel.count(), 0);
  assert.match(await browse.innerText(), /DeepSeek-V4\.1-Flash/);
  await page.keyboard.press('ArrowDown');
  const effort = page.getByRole('menuitem', { name: /^Effort/ });
  assert.ok(await effort.evaluate(node => node === document.activeElement));
  await page.keyboard.press('ArrowDown');
  assert.ok(await browse.evaluate(node => node === document.activeElement));
  const collapsed = await browse.boundingBox();
  await browse.hover();
  const picker = page.locator('.dsh-model-picker-flyout[data-branch="models"] [data-dsh-model-picker]');
  await picker.waitFor();
  assert.deepEqual(await browse.boundingBox(), collapsed, 'hovering Models must not move the entry');
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'models-first-hover.png') });
  }
  assert.equal(await picker.locator('[data-model-row]').count(), 0, 'hovering Models first opens only providers');

  const menu = page.getByRole('menu').filter({ has: picker });
  const panel = picker.locator('..');
  const assertDocked = async side => {
    const parent = await menu.boundingBox();
    const child = await panel.boundingBox();
    const anchor = await browse.boundingBox();
    const gap = side === 'right' ? child.x - (parent.x + parent.width) : parent.x - (child.x + child.width);
    assert.ok(Math.abs(gap) < 1, `panel must touch the menu on the ${side}; gap was ${gap}px`);
    assert.ok(child.y < anchor.y + anchor.height && child.y + child.height > anchor.y);
  };
  await assertDocked('left');
  const provider = name => picker.locator('[data-provider-row]').filter({ hasText: name });
  const model = name => picker.locator('[data-model-row]').getByText(name, { exact: true });
  await provider('DeepSeek').hover();
  assert.equal(await picker.getByText(/Usage unavailable|Bonus balance|Credits left|% left/).count(), 0);
  assert.equal(await picker.locator('.picker-ring, .picker-usage').count(), 0);
  await effort.waitFor();
  await page.getByText('Enable agent teamwork', { exact: true }).waitFor();
  const hoverTargets = ['DeepSeek', 'Codex', 'Qoder'];
  const originalRows = await Promise.all(hoverTargets.map(name => provider(name).boundingBox()));
  const providers = picker.getByRole('group', { name: 'Providers', exact: true });
  const right = picker.getByRole('group', { name: 'Models', exact: true });
  const threeProviders = await providers.boundingBox();
  assert.equal(await providers.locator('[data-provider-row]').count(), 3);
  assert.equal(threeProviders.height, originalRows.reduce((height, row) => height + row.height, 0));
  const menuFrame = await menu.boundingBox();
  const assertStableHover = async (index, expected) => {
    await provider(hoverTargets[index]).hover();
    assert.equal(await provider(hoverTargets[index]).getAttribute('aria-expanded'), 'true');
    await model(expected).waitFor();
    assert.deepEqual(await menu.boundingBox(), menuFrame, 'the anchored menu must retain its size and position');
    assert.deepEqual(await Promise.all(hoverTargets.map(name => provider(name).boundingBox())), originalRows);
    const providerPanel = await picker.locator('.picker-primary').boundingBox();
    const modelPanel = await right.boundingBox();
    assert.ok(providerPanel.width <= 145 && modelPanel.width <= 207, 'both submenus use compact widths');
    assert.ok(Math.abs(modelPanel.x + modelPanel.width - providerPanel.x) < 1, 'left-facing model and provider panes touch');
  };
  await assertStableHover(1, 'Codex Fixture');
  const firstCodex = await model('Codex Fixture').boundingBox();
  await page.mouse.move(firstCodex.x + firstCodex.width / 2, firstCodex.y + firstCodex.height / 2, { steps: 8 });
  await model('Codex Fixture').waitFor();
  assert.ok(await right.getByText('Desktop', { exact: true }).isVisible());
  if (process.env.DSH_TEST_ARTIFACTS) {
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'models-provider-menu.png') });
  }
  await right.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await right.evaluate(el => el.scrollTop > 0));
  await assertStableHover(2, 'Auto');
  await assertStableHover(0, 'DeepSeek-V4.1-Flash');

  await effort.hover();
  await picker.waitFor({ state: 'detached' });
  const hoverEffort = page.locator('[data-branch="effort"]');
  await hoverEffort.getByRole('menuitemradio').first().hover();
  await hoverEffort.waitFor();
  if (process.env.DSH_TEST_ARTIFACTS) {
    await page.screenshot({ path: join(process.env.DSH_TEST_ARTIFACTS, 'effort-hover.png') });
  }
  await page.mouse.move(8, 8);
  await hoverEffort.waitFor({ state: 'detached' });
  await browse.hover();
  await providers.waitFor();
  assert.equal(await right.count(), 0, 're-entering Models starts at the provider level');
  await provider('Qoder').hover();
  await picker.getByRole('searchbox').hover();
  await right.waitFor({ state: 'detached' });

  await browse.focus();
  await browse.press('ArrowRight');
  const keyboardSearch = picker.getByRole('searchbox');
  await keyboardSearch.press('ArrowDown');
  const firstProvider = provider('DeepSeek');
  assert.ok(await firstProvider.evaluate(node => node === document.activeElement));
  assert.equal(await right.count(), 0, 'keyboard focus alone does not open a provider');
  await firstProvider.press('ArrowRight');
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-model-row'));
  await page.keyboard.press('ArrowLeft');
  await right.waitFor({ state: 'detached' });
  await firstProvider.evaluate(async node => {
    await new Promise(requestAnimationFrame);
    if (node !== document.activeElement) throw new Error('Provider focus was not restored');
  });
  await provider('Qoder').hover();
  const account = picker.getByLabel('Account', { exact: true });
  await account.focus();
  await account.selectOption(workRoute);
  assert.ok(await account.evaluate(el => el === document.activeElement));
  if (process.env.DSH_TEST_ARTIFACTS) {
    await mkdir(process.env.DSH_TEST_ARTIFACTS, { recursive: true });
    const panelFrame = await picker.locator('..').boundingBox();
    const x = Math.min(menuFrame.x, panelFrame.x);
    const y = Math.min(menuFrame.y, panelFrame.y);
    const clip = { x, y,
      width: Math.max(menuFrame.x + menuFrame.width, panelFrame.x + panelFrame.width) - x,
      height: Math.max(menuFrame.y + menuFrame.height, panelFrame.y + panelFrame.height) - y };
    await page.screenshot({ clip, path: join(process.env.DSH_TEST_ARTIFACTS, 'model-picker-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ clip, path: join(process.env.DSH_TEST_ARTIFACTS, 'model-picker-light.png') });
  }
  await model('Lite').waitFor();
  assert.equal(await model('Auto').count(), 0);
  assert.ok(await account.locator('option').filter({ hasText: /^Work · API$/ }).count());
  const search = picker.getByRole('searchbox');
  await search.fill('codex fixture');
  await model('Codex Fixture').waitFor();
  assert.equal(await model('Lite').count(), 0);
  await search.press('Escape');
  await picker.waitFor({ state: 'detached' });
  const rootZoom = await page.addStyleTag({ content: 'html { zoom: .9; }' });
  await effort.hover();
  await browse.hover();
  await picker.waitFor();
  await assertDocked('left');
  await search.press('Escape');
  await picker.waitFor({ state: 'detached' });
  const centerMenu = await page.addStyleTag({ content: `
    [role="menu"]:has(.dsh-model-picker-entry) { left: 610px; right: auto; justify-self: start; }
  ` });
  await effort.hover();
  await browse.hover();
  await picker.waitFor();
  await assertDocked('right');
  await search.press('Escape');
  await picker.waitFor({ state: 'detached' });
  await centerMenu.evaluate(node => node.remove());
  await rootZoom.evaluate(node => node.remove());
  await page.setViewportSize({ width: 480, height: 760 });
  await browse.hover();
  await providers.waitFor();
  assert.equal(await right.count(), 0);
  const compactRail = await providers.boundingBox();
  await provider('Qoder').hover();
  await model('Auto').waitFor();
  assert.deepEqual(await providers.boundingBox(), compactRail);
  const compact = await picker.boundingBox();
  assert.ok(compact.x >= 0 && compact.x + compact.width <= 480);
  const compactPanel = await panel.boundingBox();
  const compactMenu = await menu.boundingBox();
  const verticalGap = Math.min(
    Math.abs(compactPanel.y + compactPanel.height - compactMenu.y),
    Math.abs(compactMenu.y + compactMenu.height - compactPanel.y),
  );
  assert.ok(verticalGap < 1, `compact panel must touch the menu; gap was ${verticalGap}px`);
  await account.selectOption(workRoute);
  await model('Lite').click();
  await picker.waitFor({ state: 'detached' });
  await page.locator(`[data-composer-card] [data-provider-id="${workRoute}"][data-model-id="lite"]`).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  const selectedTrigger = page.locator('[data-composer-card] button[aria-label^="Select model, current"]');
  await selectedTrigger.click();
  await browse.waitFor();
  assert.equal(await effort.count(), 0, 'Qoder fixture advertises no effort levels');
  await browse.hover();
  await provider('Codex').hover();
  const fixtureRow = picker.locator('[data-model-row]').filter({ hasText: 'Codex Fixture' });
  assert.equal((await fixtureRow.innerText()).trim(), 'Codex Fixture');
  await model('Codex Fixture').click();
  assert.doesNotMatch(await selectedTrigger.innerText(), /Image input|Text input|可发图片|仅文本/);
  await selectedTrigger.filter({ hasText: 'Codex Fixture' }).click();
  await effort.focus();
  await effort.press('ArrowRight');
  const levels = page.getByRole('menuitemradio');
  assert.deepEqual(await levels.allTextContents(), ['Default', 'high', 'low']);
  await levels.filter({ hasText: 'high' }).click();
  await selectedTrigger.filter({ hasText: 'high' }).click();
  await browse.hover();
  await provider('Codex').hover();
  await model('Codex model 2').click();
  await selectedTrigger.filter({ hasText: 'Codex model 2' }).click();
  assert.equal(await effort.count(), 0, 'changing to a no-effort model clears the previous selection');
  assert.doesNotMatch(await selectedTrigger.getAttribute('aria-label'), /reasoning effort/);
  await page.keyboard.press('Escape');
  console.log('PASS native effort menu follows the selected provider and model, including no-effort models.');
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  const toggle = page.getByRole('switch', { name: /^Enable (?:Model picker|dsh-model-picker)$/i });
  await toggle.click();
  const stylesheet = page.locator('style[data-dsh-model-picker-style]');
  await stylesheet.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click({ timeout: 5000 });
  await page.locator('[data-composer-card] button[aria-label^="Select model, current"]').click();
  await stockModel.waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await toggle.and(page.locator('[aria-checked="false"]')).click();
  await stylesheet.waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
  console.log('PASS isolated Web model picker: stable row sizing and independent scrolling, docking, narrow desktop, selection without usage, search and hot reload.');
} catch (error) {
  if (page) console.error(await page.locator('body').innerText().then(text => text.slice(-3200)).catch(() => ''));
  console.error(log.replace(/([?&]token=)[^&\s]+/g, '$1[redacted]'));
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    host.kill('SIGTERM');
    const kill = setTimeout(() => host.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(kill);
  }
  if (platform.listening) await new Promise(accept => platform.close(accept));
  await rm(temp, { recursive: true, force: true });
}
