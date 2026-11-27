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
  const deletionPath = join(temp, 'deletion-workspace');
  await mkdir(deletionPath);
  await writeFile(join(workspace, 'workbench-fixture.md'), '# Workspace search and preview fixture\n');
  const child = join(workspace, 'child-project');
  await mkdir(child);
  const pkg = {
    name: 'dsh-workbench-probe', version: '0.0.0', private: true, type: 'module',
    engines: { dsh: runtimeVersion }, main: './lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    files: ['lib', 'cordis.patch.yml'],
    peerDependencies: { '@deepseek-ai/cordis': '4.1.0', react: '18.3.1' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar-right'] } },
  };
  await writeFile(join(directory, 'package.json'), JSON.stringify(pkg, null, 2));
  await writeFile(join(directory, 'cordis.patch.yml'), stringify([
    { id: 'workspace-controller', config: { documentsDirectory: join(temp, 'documents') } },
    { insert: [{ id: 'dsh-workbench-probe:main', name: pkg.name,
      config: { path: workspace, activity: join(temp, 'activity'), deletionPath, deletionLocations: join(temp, 'deletion-locations.json') } }] },
  ]));
  const assistantMarkdown = [
    'Activity preview fixture',
    '',
    '校准示例：`main` 里的项目与会话。',
    '',
    '```',
    'workspace/',
    '├── README.md  # 仓库入口',
    '└── src/       # 源代码',
    '```',
    '',
    '```javascript',
    'const sample = "项目与会话";',
    '```',
  ].join('\n');
  await writeFile(join(directory, 'lib/index.js'), `
import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const inject = ['workspaceController', 'sessionController', 'agents', 'sessions', 'sessionPersistence', 'attachments', 'schedule', 'userQuestions'];
export async function apply(ctx, config) {
  const { workspace } = await ctx.workspaceController.create({ path: config.path });
  const image = await ctx.attachments.saveImage({
    data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAAAAAC8b2d3AAABmklEQVR4nO3QIQEAIBAAMTIRm5REQEzw4hZh6wy3h1u/g15+B70UiApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQFQgKhAViApEBaICUYGoQHQBKT9yRhuTXu0AAAAASUVORK5CYII=', 'base64'),
    mediaType: 'image/png', name: 'workbench-image.png',
  });
  const imageContent = { type: 'image', attachment: image };
  const activityCalls = ['read', 'fixture_lookup', 'bash', 'edit'].map(name => ({
    type: 'tool-call', id: randomUUID(), name, arguments: '{}',
  }));
  for (const suffix of [...Array.from({ length: 10 }, (_, index) => 'extra-' + index), 'alpha', 'beta']) {
    const sessionId = 'workbench-test-' + suffix;
    await ctx.sessionController.create({ workspaceId: workspace.workspaceId, sessionId });
    const session = ctx.agents.get(sessionId)?.session;
    if (session && !session.ownEvents().some(event => event.type === 'turn/start')) session.append([
      ['turn/start', { turn: 1 }],
      ...(suffix === 'alpha' ? [
        ['user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'Review the edited files' }, imageContent], source: { kind: 'user' } }, { surfaceOp: 'append' }],
        ['step/start', { turn: 1, step: 1 }],
        ['assistant/message', { turn: 1, step: 1, usage: { inputTokens: 4, outputTokens: 2 }, stream: [], message: { id: randomUUID(), role: 'assistant',
          content: activityCalls, source: { kind: 'model', provider: 'fixture', model: 'Fixture model' } } }, { surfaceOp: 'append' }],
        ...activityCalls.flatMap(({ id: callId, name, arguments: args }) => [
          ['tool/call', { turn: 1, step: 1, callId, name, arguments: args }],
          ['tool/result', { turn: 1, step: 1, message: { id: randomUUID(), role: 'tool', toolCallId: callId,
            content: [{ type: 'text', text: 'Tool result fixture' }], source: { kind: 'tool', callId }, isError: false } }, { surfaceOp: 'append' }],
        ]),
        ['step/end', { turn: 1, step: 1 }],
        ['step/start', { turn: 1, step: 2 }],
        ['assistant/message', { turn: 1, step: 2, usage: { inputTokens: 4, outputTokens: 2 }, stream: [], message: { id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text: ${JSON.stringify(assistantMarkdown)} }, imageContent], source: { kind: 'model', provider: 'fixture', model: 'Fixture model' } } }, { surfaceOp: 'append' }],
        ['step/end', { turn: 1, step: 2 }],
        ['workspace/changes', { turn: 1 }],
      ] : []),
      ['turn/end', { turn: 1, reason: suffix === 'alpha' ? { kind: 'completed' } : { kind: 'aborted', reason: { kind: 'user' } } }],
    ]);
    await ctx.sessionController.rename({ sessionId, title: 'Workbench ' + suffix });
  }
  const recordSubagent = async (stage) => {
    const id = 'workbench-child-record';
    if (stage === 'done') {
      const agent = ctx.agents.get(id);
      agent.session.append([
        ['step/end', { turn: 1, step: 1 }],
        ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
      ]);
      delete agent.status;
      ctx.emit('agent/status', { agent, status: agent.status });
      return;
    }
    const result = await ctx.sessionController.resolveAgent('workbench-test-beta');
    if ('error' in result) throw new Error('Missing fixture parent');
    const parent = result.agent.session;
    if (parent && !parent.ownEvents().some(event => event.type === 'subagent/catalog')) {
      const label = 'Inspect workbench fixture';
      const { agent } = await ctx.agents.create({ sessionId: id, meta: { parentSession: parent.id, origin: 'subagent', cwd: config.path } });
      const record = agent.session;
      record.append([
        ['session/title', { title: label, source: { kind: 'fallback' }, messageSeqs: [] }],
        ['subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label }],
        ['turn/start', { turn: 1 }],
        ['user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'Inspect the sample directory' }], source: { kind: 'user' } }, { surfaceOp: 'append' }],
        ['step/start', { turn: 1, step: 1 }],
        ['request/header', { header: { config: { provider: 'fixture', model: 'Fixture model', reasoningEffort: 'high' } }, reason: 'initial' }],
        ['assistant/message', { turn: 1, step: 1, usage: { inputTokens: 4, outputTokens: 2 }, stream: [], message: { id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text: '**Directory checked**' }], source: { kind: 'model', provider: 'fixture', model: 'Fixture model' } } }, { surfaceOp: 'append' }],
      ]);
      parent.append('subagent/catalog', { version: 1, childId: id, childCreatedAt: Date.now(), mode: 'one-shot', label });
      Object.defineProperty(agent, 'status', { configurable: true, value: 'running' });
      ctx.emit('agent/status', { agent, status: agent.status });
    }
  };
  let scheduledFixture;
  async function updateScheduledFixture(action) {
    if (action === 'create') {
      scheduledFixture = await ctx.schedule.create({
        title: 'Session clock fixture', prompt: 'Future test task.',
        timing: { kind: 'at', at: new Date(Date.now() + 24 * 60 * 60_000).toISOString() },
        target: { kind: 'session', sessionId: 'workbench-test-alpha' },
      });
    } else if (scheduledFixture && action.startsWith('target:')) {
      const sessionId = action.slice('target:'.length);
      const target = sessionId === 'new' ? { kind: 'new' } : { kind: 'session', sessionId };
      await ctx.schedule.edit({ id: scheduledFixture.id, action: 'update', patch: { target } });
    } else if (scheduledFixture) {
      await ctx.schedule.edit(action === 'delete'
        ? { id: scheduledFixture.id, action: 'delete' }
        : { id: scheduledFixture.id, action: 'update', patch: { active: action === 'resume' } });
    }
  }
  const recordActivity = () => {
    const { id, text } = JSON.parse(readFileSync(config.activity, 'utf8'));
    if (id === 'schedule-clock-fixture') {
      void updateScheduledFixture(text).catch(error => ctx.logger.warn('Scheduled clock fixture failed: %s', error));
      return;
    }
    if (id === 'question-card-fixture') {
      const agent = ctx.agents.get('workbench-test-alpha');
      const options = [
        { label: 'Personal', description: 'Use the personal account.' },
        { label: 'Work', description: 'Use the work account.' },
      ];
      const questions = [{ id: 'account', header: '账号', question: '选择用于本次操作的账号', options }];
      if (text === 'batch') questions.push({ id: 'backup', question: 'Choose backup accounts', multiSelect: true, options });
      void ctx.userQuestions.ask({ agent, questions })
        .then(answer => writeFile(config.activity + '.answer', JSON.stringify(answer)))
        .catch(error => ctx.logger.warn('Question card fixture failed: %s', error));
      return;
    }
    if (id === 'running-fixture') {
      const agent = ctx.agents.get('workbench-test-beta');
      if (!agent) return;
      // Publish a controlled status transition without contacting a model.
      if (text === 'running') Object.defineProperty(agent, 'status', { configurable: true, value: 'running' });
      else delete agent.status;
      ctx.emit('agent/status', { agent, status: agent.status });
      return;
    }
    if (id === 'subagent-fixture') { void recordSubagent(text).catch(error => ctx.logger.warn('Subagent fixture failed: %s', error)); return; }
    if (id === 'session-deletion-fixture') {
      void (async () => {
        const locations = {};
        for (const mode of ['cold', 'live']) {
          const sessionId = 'workbench-delete-' + mode;
          const handle = await ctx.agents.create({ sessionId, meta: { cwd: config.deletionPath } });
          const session = handle.agent.session;
          session.append([
            ['turn/start', { turn: 1 }],
            ['turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
          ]);
          await ctx.sessionController.rename({ sessionId, title: 'Delete fixture ' + mode });
          await ctx.sessions.flush(session);
          if (mode === 'cold') await handle.dispose();
          locations[mode] = (await ctx.sessionPersistence.stat(sessionId)).location.path;
        }
        await writeFile(config.deletionLocations, JSON.stringify(locations));
      })().catch(error => ctx.logger.warn('Deletion fixture failed: %s', error));
      return;
    }
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
return {inject:['slots','sidebarRightTabs'],apply(ctx){
 // Register on demand so tests cover both absent and available providers.
 let disposeForge;
 ctx.effect(()=>{
   const configure = event => {
     disposeForge?.();
     disposeForge = undefined;
     if (!event.detail) return;
     const paths = event.detail;
     const release = ctx.provide('remote.forgePanel', {
       follow(sessionId, signal) {
         const stopped = Promise.withResolvers();
         signal.addEventListener('abort', stopped.resolve, { once: true });
         return {
           async *[Symbol.asyncIterator]() {
             const root = paths[sessionId];
             yield root ? { checkout:{state:'ready',checkout:{root}}, local:{files:[{additions:12,deletions:3}]} }
               : { checkout:{state:'none'}, local:null };
             if (!signal.aborted) await stopped.promise;
           },
           dispose() { signal.removeEventListener('abort', stopped.resolve); stopped.resolve(); },
         };
       },
     });
     const unregister = ctx.sidebarRightTabs.register({id:'workbench-probe-forge',kind:'forge-changes',patterns:['dsh-resource://forge-changes/**'],title:()=> 'Fixture Git diff'});
     disposeForge = () => { unregister(); release(); };
   };
   window.addEventListener('workbench-probe-forge',configure);
   return () => { window.removeEventListener('workbench-probe-forge',configure); disposeForge?.(); };
 });
 ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:'workbench-probe-forge'},()=>React.createElement('div',null,'Fixture Git diff body')));
ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'workbench-probe'},()=>React.createElement('h1',{'data-workbench-probe':''},'Workbench extension probe')));
ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'workbench-probe',label:'Workbench probe',order:999},()=>React.createElement('span',null,'◇')));
// Only the Model Picker panel contract is needed here. Its actual UI is tested by that plugin.
function ModelsFixture() {
  const [selected, select] = React.useState(false);
  return React.createElement('main', {className:'dsh-model-management','data-workbench-models-fixture':'',style:{height:'100%',minHeight:0}},
    React.createElement('div', {className:'dsh-model-management-body',style:{height:'100%',boxSizing:'border-box',overflow:'auto'}},
      React.createElement('button', {type:'button','aria-pressed':selected,onClick:()=>select(value=>!value)},'Fixture provider'),
      React.createElement('div', {style:{height:'120vh'},'aria-hidden':true})));
}
ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'dsh-model-picker'},ModelsFixture));
ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'dsh-model-picker',label:'Model management fixture',order:998},()=>React.createElement('span',null,'◇')));
}};}});`);
  return directory;
}
