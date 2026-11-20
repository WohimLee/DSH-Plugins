import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';

// An independent plugin exercises public Host services and Client slots. The
// history contains synthetic cancelled turns, never model-generated content.
export async function createProbe(temp, runtimeVersion) {
  const directory = join(temp, 'probe');
  await mkdir(join(directory, 'lib'), { recursive: true });
  const workspace = join(temp, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'workbench-fixture.md'), '# Workspace search and preview fixture\n');
  const child = join(workspace, 'child-project');
  await mkdir(child);
  const pkg = {
    name: 'dsh-workbench-probe', version: '0.0.0', private: true, type: 'module',
    engines: { dsh: runtimeVersion }, main: './lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    files: ['lib', 'cordis.patch.yml'],
    peerDependencies: { '@deepseek-ai/cordis': '4.1.0', react: '18.3.1' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-sidebar'] } },
  };
  await writeFile(join(directory, 'package.json'), JSON.stringify(pkg, null, 2));
  await writeFile(join(directory, 'cordis.patch.yml'), stringify([
    { id: 'workspace-controller', config: { documentsDirectory: join(temp, 'documents') } },
    { insert: [{ id: 'dsh-workbench-probe:main', name: pkg.name,
      config: { path: workspace, child, activity: join(temp, 'activity') } }] },
  ]));
  await writeFile(join(directory, 'lib/index.js'), `
import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { randomUUID } from 'node:crypto';
export const inject = ['workspaceController', 'sessionController', 'agents', 'sessions'];
export async function apply(ctx, config) {
  const { workspace } = await ctx.workspaceController.create({ path: config.path });
  await ctx.workspaceController.create({ path: config.child });
  for (const suffix of [...Array.from({ length: 10 }, (_, index) => 'extra-' + index), 'alpha', 'beta']) {
    const sessionId = 'workbench-test-' + suffix;
    await ctx.sessionController.create({ workspaceId: workspace.workspaceId, sessionId });
    const session = ctx.agents.get(sessionId)?.session;
    if (session && !session.ownEvents().some(event => event.type === 'turn/start')) session.append([
      ['turn/start', { turn: 1 }],
      ...(suffix === 'alpha' ? [
        ['step/start', { turn: 1, step: 1 }],
        ['assistant/message', { turn: 1, step: 1, usage: { inputTokens: 4, outputTokens: 2 }, stream: [], message: { id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text: 'Activity preview fixture' }], source: { kind: 'model', provider: 'fixture', model: 'Fixture model' } } }, { surfaceOp: 'append' }],
        ['step/end', { turn: 1, step: 1 }],
      ] : []),
      ['turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
    ]);
    await ctx.sessionController.rename({ sessionId, title: 'Workbench ' + suffix });
  }
  const recordSubagent = async () => {
    const result = await ctx.sessionController.resolveAgent('workbench-test-beta');
    if ('error' in result) throw new Error('Missing fixture parent');
    const parent = result.agent.session;
    if (parent && !parent.ownEvents().some(event => event.type === 'subagent/catalog')) {
      const id = 'workbench-child-record';
      const label = 'Inspect workbench fixture';
      const record = ctx.sessions.create(id, { meta: { parentSession: parent.id, origin: 'subagent', cwd: config.path } });
      record.append([
        ['subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label }],
        ['turn/start', { turn: 1 }],
        ['user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'Inspect the sample directory' }], source: { kind: 'user' } }, { surfaceOp: 'append' }],
        ['step/start', { turn: 1, step: 1 }],
        ['request/header', { header: { config: { provider: 'fixture', model: 'Fixture model', reasoningEffort: 'high' } }, reason: 'initial' }],
        ['assistant/message', { turn: 1, step: 1, usage: { inputTokens: 4, outputTokens: 2 }, stream: [], message: { id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text: '**Directory checked**' }], source: { kind: 'model', provider: 'fixture', model: 'Fixture model' } } }, { surfaceOp: 'append' }],
        ['step/end', { turn: 1, step: 1 }],
        ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ]);
      parent.append('subagent/catalog', { version: 1, childId: id, childCreatedAt: Date.now(), mode: 'one-shot', label });
    }
  };
  const recordActivity = () => {
    const { id, text } = JSON.parse(readFileSync(config.activity, 'utf8'));
    if (id === 'subagent-fixture') { recordSubagent(); return; }
    const session = ctx.agents.get(id)?.session;
    if (!session) return;
    const turn = (session.ownEvents().findLast(event => event.type === 'turn/start')?.data.turn ?? 0) + 1;
    session.append([
      ['turn/start', { turn }],
      ['user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' }],
      ['turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
    ]);
  };
  ctx.effect(() => {
    watchFile(config.activity, { interval: 100 }, (current, previous) => {
      if (current.isFile() && current.mtimeMs !== previous.mtimeMs) recordActivity();
    });
    return () => unwatchFile(config.activity);
  });
}
`);
  await writeFile(join(directory, 'lib/client.js'), `window.__ModuleLoader__.load({id:'dsh-workbench-probe',factory:require=>{
const React = require('react');
return {inject:['slots'],apply(ctx){
ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'workbench-probe'},()=>React.createElement('h1',{'data-workbench-probe':''},'Workbench extension probe')));
ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'workbench-probe',label:'Workbench probe',order:999},()=>React.createElement('span',null,'◇')));
}};}});`);
  return directory;
}
