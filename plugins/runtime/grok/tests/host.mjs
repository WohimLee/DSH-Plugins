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
const reply = 'Hello from the Grok stream.';
function outputItem(content) {
  return { type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant', content };
}
function completion(item) {
  return { id: 'resp_fixture', model: model.id, status: 'completed', output: [item],
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
}
const platform = createServer(async (request, response) => {
  const auth = request.headers.authorization;
  if (auth !== 'Bearer fixture-grok-key') return response.writeHead(401).end();
  if (request.url === '/v1/language-models' || request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(
      request.url.endsWith('/language-models') ? { models: [model] } : { data: [{ id: model.id, context_length: 200_000 }] },
    ));
    return;
  }
  if (request.url !== '/v1/responses') return response.writeHead(404).end();
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({ headers: request.headers, body: JSON.parse(body) });
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const added = { type: 'output_text', text: '', annotations: [] };
  const done = { ...added, text: reply };
  const events = [
    { type: 'response.created', response: { ...completion(outputItem([])), status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: outputItem([]) },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: added },
    { type: 'response.output_text.delta', item_id: 'msg_fixture', output_index: 0, content_index: 0, delta: reply },
    { type: 'response.content_part.done', item_id: 'msg_fixture', output_index: 0, content_index: 0, part: done },
    { type: 'response.output_item.done', output_index: 0, item: outputItem([done]) },
    { type: 'response.completed', response: completion(outputItem([done])) },
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
    details: panel.getByRole('region', { name: 'Grok connection details' }),
    connection: panel.getByRole('region', { name: 'Grok', exact: true }),
    group: panel.getByRole('region', { name: 'Available models' }).locator('summary').filter({ hasText: 'Grok' }),
  };
}

try {
  await mkdir(home);
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
    const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    const artifactDir = (source === directory ? process.env.DSH_TEST_ARTIFACT_DIR : process.env.DSH_TEST_MODEL_PICKER_ARTIFACT_DIR) || temp;
    if (artifactDir === temp) await run('pnpm', ['pack', '--pack-destination', temp], source);
    tarballs.push(join(artifactDir, `${pkg.name}-${pkg.version}.tgz`));
  }
  const files = (await run('tar', ['-tzf', tarballs[0]])).trim().split('\n');
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/transport.js', 'lib/proxy.js', 'lib/proxy.d.ts', 'locale/en.json', 'locale/zh.json', 'cordis.patch.yml', 'README.md']) {
    assert.ok(files.includes(`package/${file}`), file);
  }
  await run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', ...tarballs, '--ignore-scripts', '--prefer-offline']);
  const url = await launch(preload);
  browser = await chromium.launch(process.env.DSH_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE } : { channel: 'chrome' });
  const page = await openApp(url);
  const { connection, details, group } = await management(page);
  await connection.getByText('Grok is not connected').waitFor();
  assert.equal(await group.count(), 0);

  const setup = connection.getByRole('button', { name: 'Set up Grok' });
  assert.equal(await connection.locator('img').evaluate(image => image.naturalWidth), 96);
  await connection.getByRole('button', { name: 'Grok usage' }).hover();
  await connection.getByRole('tooltip').getByText('View API usage in the xAI Console.').waitFor();
  await details.waitFor({ state: 'hidden' });
  await setup.click();
  const keyInput = details.getByLabel('xAI API Key', { exact: true });
  await keyInput.fill('invalid');
  await details.getByRole('button', { name: 'Connect', exact: true }).click();
  await details.getByRole('alert').filter({ hasText: 'xAI rejected' }).waitFor();
  assert.equal(await group.count(), 0);

  await keyInput.fill('fixture-grok-key');
  await details.getByRole('button', { name: 'Connect', exact: true }).click();
  await connection.getByText('Connected with an xAI API Key').waitFor();
  await page.keyboard.press('Escape');
  await group.waitFor();
  await group.click();
  await page.getByText(model.id, { exact: true }).waitFor();
  await connection.getByRole('button', { name: 'View connection' }).click();
  assert.equal(await keyInput.inputValue(), '');

  await keyInput.fill('invalid');
  await details.getByRole('button', { name: 'Replace key', exact: true }).click();
  await details.getByRole('alert').filter({ hasText: 'xAI rejected' }).waitFor();
  assert.equal(await group.count(), 1);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click();
  const composer = page.locator('[data-composer-card]');
  await composer.locator('button[aria-haspopup="menu"]').filter({ hasText: /DeepSeek|Select model/i }).click();
  await page.getByRole('menuitem', { name: /^Models(?: |$)/ }).hover();
  await page.locator('[data-provider-row]').filter({ hasText: 'Grok' }).hover();
  await page.getByText(model.id, { exact: true }).click();
  await composer.locator('[contenteditable=true]').fill('Say hello from the Grok stream.');
  await composer.locator('[contenteditable=true]').press('Enter');
  await page.getByText(reply, { exact: true }).first().waitFor({ timeout: 20_000 });
  const inference = requests[0];
  assert.equal(inference.body.model, model.id);
  assert.equal(inference.body.stream, true);
  assert.equal(inference.body.reasoning?.effort, 'high');
  assert.equal(inference.headers.authorization, 'Bearer fixture-grok-key');
  for (const [key, value] of Object.entries(attributionHeaders({ ...APP_IDENTITY, suffix: 'dsh-profile/web' }))) {
    assert.equal(inference.headers[key], value);
  }

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Settings/ }).click();
  const settings = page.getByRole('dialog').filter({ hasText: 'Settings' });
  await settings.getByRole('button', { name: 'Grok', exact: true }).click();
  await settings.getByLabel('xAI API Key', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Replace key' }).waitFor();
  await page.close();
  await stopHost();
  const restartUrl = await launch(preload);
  const restarted = await openApp(restartUrl);
  const saved = await management(restarted);
  await saved.connection.getByText('Connected with an xAI API Key').waitFor();
  await saved.group.waitFor();
  await saved.connection.getByText('1 model', { exact: true }).waitFor();
  await saved.connection.getByRole('button', { name: 'View connection' }).click();
  await saved.details.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await saved.connection.getByText('Grok is not connected').waitFor();
  await saved.group.waitFor({ state: 'hidden' });
  assert.ok(!(await readFile(join(home, '.credentials.yaml'), 'utf8')).includes('fixture-grok-key'));
  const chinese = await openApp(restartUrl, 'zh-CN');
  await chinese.getByRole('button', { name: '模型管理', exact: true }).click();
  await chinese.setViewportSize({ width: 560, height: 900 });
  const grok = chinese.getByRole('region', { name: 'Grok', exact: true });
  const codex = chinese.getByRole('region', { name: 'Codex', exact: true });
  await grok.getByText('Grok 尚未连接').waitFor();
  const [first, second] = await Promise.all([codex.boundingBox(), grok.boundingBox()]);
  assert.equal(first.x, second.x);
  assert.ok(second.y >= first.y + first.height);
  await grok.getByRole('button', { name: '设置 Grok' }).click();
  await chinese.getByRole('region', { name: 'Grok 连接详情' }).getByRole('button', { name: '连接', exact: true }).waitFor();
  console.log('PASS isolated Web Grok connection, key validation, catalog, Responses streaming, restart and disconnect.');
} catch (error) {
  if (current?.log) console.error(publicLog(current.log));
  throw error;
} finally {
  await browser?.close();
  await stopHost();
  platform.close();
  await rm(temp, { force: true, recursive: true });
}
