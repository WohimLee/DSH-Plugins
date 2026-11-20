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
