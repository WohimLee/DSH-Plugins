import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';
test('echo tool preserves text, including Unicode and empty input', async () => {
  let tool;
  plugin.apply({ tools: { register(value) { tool = value; } } });
  assert.ok(tool);
  for (const text of ['', '你好 🌍']) {
    const result = await tool.execute({ text }, {});
    assert.equal(result, text);
    assert.deepEqual(tool.output.render({ text }, result), [{ type: 'text', text }]);
  }
  await assert.rejects(tool.execute({ text: 42 }, {}));
});
