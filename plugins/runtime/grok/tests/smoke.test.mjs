import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { readCatalog, RejectedKey } from '../lib/catalog.js';

test('uses the Key-scoped language catalog and enriches only those models', async t => {
  const requests = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer fixture-key');
    assert.equal(init.redirect, 'error');
    for (const [key, value] of Object.entries(attributionHeaders())) assert.equal(init.headers[key], value);
    if (url === 'https://api.x.ai/v1/language-models') return Response.json({ models: [
      { id: 'grok-4.7', input_modalities: ['text', 'image'], output_modalities: ['text'],
        capabilities: { reasoning_effort: ['low', 'high'], default_reasoning_effort: 'high' }, prompt_text_token_price: 20_000 },
      { id: 'latest', aliases: ['grok-new'], input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'image-only', input_modalities: ['text'], output_modalities: ['image'] },
    ] });
    assert.equal(url, 'https://api.x.ai/v1/models');
    return Response.json({ data: [{ id: 'latest', context_length: 500_000 }, { id: 'ungranted', context_length: 123 }] });
  });
  const models = await readCatalog('fixture-key', new AbortController().signal, requests);
  assert.deepEqual(models.map(model => model.id), ['grok-4.7', 'latest']);
  assert.deepEqual(models[0].input, ['text', 'image']);
  assert.equal(models[0].thinkingLevelMap.medium, null);
  assert.equal(models[0].defaultEffort, 'high');
  assert.equal(models[1].reasoning, false);
  assert.equal(models[0].cost.input, 2);
  assert.equal(models[1].contextWindow, 500_000);
  assert.equal(models[1].name, 'grok-new');
  assert.equal(requests.mock.callCount(), 2);
});

test('distinguishes rejected keys from valid empty catalogs and prevents fallback advertising', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) =>
    init.headers.authorization === 'Bearer invalid' ? new Response(null, { status: 401 }) : Response.json({ models: [] }),
  );
  const signal = new AbortController().signal;
  await assert.rejects(readCatalog('invalid', signal, fetch), RejectedKey);
  assert.deepEqual(await readCatalog('empty', signal, fetch), []);
  assert.equal(fetch.mock.callCount(), 2);
});

test('refreshes route capabilities from the account and sends image bytes through xAI Responses', async t => {
  const { GrokAdapter } = await import('../lib/index.js');
  const { grokProvider } = await import('../lib/catalog.js');
  const { InMemoryCredentialStore, defaultProviderAuthContext } = await import('@earendil-works/pi-ai');
  const { resolveRetryPolicy } = await import('@deepseek-ai/dsh-llm');
  const controller = new AbortController();
  let declaredInputs = ['text', 'image', 'audio'];
  const load = () => readCatalog('fixture', controller.signal, async url =>
    url.endsWith('/models') ? Response.json({ data: [{ id: 'grok-alias-fixture', context_length: 128_000,
      capabilities: { reasoning_effort: ['high', 'future'], default_reasoning_effort: 'high' },
      prompt_image_token_price: 15_000, long_context_threshold: 64_000 }] }) :
      Response.json({ models: [{ id: 'grok-model-fixture', aliases: ['grok-alias-fixture'], input_modalities: declaredInputs,
        output_modalities: ['text'] }] }));
  let catalog = await load();
  const buildProfiles = () => new Map([['grok', {
    provider: 'grok', displayName: 'Grok', piProvider: grokProvider(catalog),
    modelErrors: new Map(), configuredMaxTokens: new Map(), retryPolicy: resolveRetryPolicy(undefined, 'grok'),
    streamIdleTimeoutMs: 3000, maxRequestImageBytes: 1_000_000, maxRequestImages: 10, imageOffloadCountQuantum: 1,
    requestImageMaxBytes: 128_000, requestImagePixelBudget: 32_768,
  }]]);
  let profiles = buildProfiles();
  const ref = { attachmentId: 'fixture', width: 1, height: 1, bytes: 4, mediaType: 'image/png' };
  const data = Uint8Array.of(10, 11, 12, 13);
  let attachmentsAvailable = true;
  const adapter = new GrokAdapter(() => catalog, () => controller.signal, {
    profiles: () => profiles, resolveApiKey: async () => 'fixture',
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments: () => attachmentsAvailable ? ({ readImageRequest: async received => {
      assert.equal(received.attachmentId, ref.attachmentId);
      return { ...ref, data };
    } }) : undefined,
  });
  const [entry] = await adapter.listModels('grok');
  assert.deepEqual(entry.inputModalities, ['text', 'image']);
  assert.equal(entry.badge, undefined);
  assert.match(entry.description, /audio/);
  assert.match(entry.description, /128000（xAI models）/);
  assert.match(entry.description, /16384（插件回退值）/);
  assert.match(entry.description, /价格未知/);
  assert.match(entry.description, /图片输入 \$1.5/);
  assert.match(entry.description, /64000 token/);
  assert.match(entry.description, /未映射的推理档位 future/);
  const prepared = await adapter.prepareCall('grok', entry.id);
  assert.equal(prepared.model.description, entry.description);
  assert.equal(prepared.model.reasoning.defaultEffort, 'high');
  const oldBypass = process.env.NO_PROXY;
  process.env.NO_PROXY = 'api.x.ai';
  t.after(() => { if (oldBypass === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = oldBypass; });
  const wire = [];
  t.mock.method(globalThis, 'fetch', async request => {
    assert.equal(request.url, 'https://api.x.ai/v1/responses');
    wire.push(await request.json());
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"id":"fixture","status":"completed","output":[]}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const options = { provider: 'grok', model: entry.id, maxTokens: 256, temperature: 0.3, reasoningEffort: 'high',
    tools: [{ name: 'fixture', description: 'Fixture tool', parameters: { type: 'object', properties: {} } }], messages: [{ role: 'user', content: [
    { type: 'text', text: 'describe this image' }, { type: 'image', attachment: ref },
  ] }] };
  await Array.fromAsync(prepared.stream(options));
  assert.equal(wire.length, 1);
  assert.equal(wire[0].temperature, 0.3);
  assert.equal(wire[0].reasoning.effort, 'high');
  assert.equal(wire[0].tools[0].name, 'fixture');
  assert.equal(wire[0].max_output_tokens, 256);
  const blocks = wire[0].input.find(item => item.role === 'user').content;
  assert.equal(blocks.find(block => block.type === 'input_image').image_url, 'data:image/png;base64,CgsMDQ==');
  attachmentsAvailable = false;
  const [missing] = await adapter.listModels('grok');
  assert.deepEqual(missing.inputModalities, ['text']);
  assert.equal(missing.badge, undefined);
  assert.match(missing.description, /宿主附件服务不可用/);
  assert.deepEqual((await adapter.resolveModel('grok', entry.id)).inputModalities, ['text']);
  const withoutStore = await adapter.prepareCall('grok', entry.id);
  assert.deepEqual(withoutStore.model.inputModalities, ['text']);
  await assert.rejects(Array.fromAsync(prepared.stream(options)), { code: 'UNSUPPORTED_CONTENT' });
  await assert.rejects(Array.fromAsync(adapter.stream(options)), { code: 'UNSUPPORTED_CONTENT' });
  attachmentsAvailable = true;
  await assert.rejects(Array.fromAsync(withoutStore.stream(options)), { code: 'UNSUPPORTED_CONTENT' });
  assert.equal((await adapter.listModels('grok'))[0].badge, undefined);
  declaredInputs = undefined;
  catalog = await load();
  profiles = buildProfiles();
  const [refreshed] = await adapter.listModels('grok');
  assert.deepEqual(refreshed.inputModalities, ['text']);
  assert.match(refreshed.description, /未披露输入模态/);
  assert.equal(refreshed.badge, undefined);
  await assert.rejects(Array.fromAsync(adapter.stream(options)), { code: 'UNSUPPORTED_CONTENT' });
  assert.equal(wire.length, 1);
});

test('keeps prepared calls and model catalogs scoped to the selected account', async t => {
  const { GrokAdapter } = await import('../lib/index.js');
  const { grokProvider } = await import('../lib/catalog.js');
  const { InMemoryCredentialStore, defaultProviderAuthContext } = await import('@earendil-works/pi-ai');
  const { resolveRetryPolicy } = await import('@deepseek-ai/dsh-llm');
  const defaultRoute = 'grok';
  const workRoute = 'grok-account-234e4567-e89b-42d3-a456-426614174000';
  const signals = new Map([[defaultRoute, new AbortController()], [workRoute, new AbortController()]]);
  const catalogs = new Map();
  for (const [provider, controller] of signals) {
    const model = provider === defaultRoute ? 'personal-fixture' : 'work-fixture';
    catalogs.set(provider, await readCatalog('fixture', controller.signal, async url =>
      url.endsWith('/language-models')
        ? Response.json({ models: [{ id: model, input_modalities: ['text'], output_modalities: ['text'] }] })
        : Response.json({ data: [] })));
  }
  const profiles = new Map([...catalogs].map(([provider, catalog]) => [provider, {
    provider, displayName: provider, piProvider: grokProvider(catalog, provider),
    modelErrors: new Map(), configuredMaxTokens: new Map(), retryPolicy: resolveRetryPolicy(undefined, 'grok'),
    streamIdleTimeoutMs: 3000, maxRequestImageBytes: 1_000_000, maxRequestImages: 10, imageOffloadCountQuantum: 1,
    requestImageMaxBytes: 128_000, requestImagePixelBudget: 32_768,
  }]));
  const adapter = new GrokAdapter(provider => catalogs.get(provider) ?? [], provider => signals.get(provider).signal, {
    profiles: () => profiles,
    resolveApiKey: async provider => provider === defaultRoute ? 'personal-key' : 'work-key',
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
  });
  assert.deepEqual((await adapter.listModels(defaultRoute)).map(model => model.id), ['personal-fixture']);
  assert.deepEqual((await adapter.listModels(workRoute)).map(model => model.id), ['work-fixture']);
  await assert.rejects(adapter.prepareCall(workRoute, 'personal-fixture'), { code: 'UNKNOWN_MODEL' });
  const personal = await adapter.prepareCall(defaultRoute, 'personal-fixture');
  const work = await adapter.prepareCall(workRoute, 'work-fixture');
  signals.get(defaultRoute).abort();
  const oldBypass = process.env.NO_PROXY;
  process.env.NO_PROXY = 'api.x.ai';
  t.after(() => { if (oldBypass === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = oldBypass; });
  const requests = t.mock.method(globalThis, 'fetch', async request => {
    assert.equal(request.headers.get('authorization'), 'Bearer work-key');
    assert.equal((await request.json()).model, 'work-fixture');
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"id":"fixture","status":"completed","output":[]}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const options = { maxTokens: 256, messages: [{ role: 'user', content: [{ type: 'text', text: 'Fixture question' }] }] };
  await assert.rejects(Array.fromAsync(personal.stream({ ...options, provider: defaultRoute, model: 'personal-fixture' })),
    { name: 'AbortError' });
  await Array.fromAsync(work.stream({ ...options, provider: workRoute, model: 'work-fixture' }));
  assert.equal(requests.mock.callCount(), 1);
});
