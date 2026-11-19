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
export const inject = ['workspaceController', 'sessionController', 'agents'];
export async function apply(ctx, config) {
  const { workspace } = await ctx.workspaceController.create({ path: config.path });
  await ctx.workspaceController.create({ path: config.child });
  for (const suffix of [...Array.from({ length: 10 }, (_, index) => 'extra-' + index), 'alpha', 'beta']) {
    const sessionId = 'workbench-test-' + suffix;
    await ctx.sessionController.create({ workspaceId: workspace.workspaceId, sessionId });
    const session = ctx.agents.get(sessionId)?.session;
    if (session && !session.ownEvents().some(event => event.type === 'turn/start')) session.append([
      ['turn/start', { turn: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
    ]);
    await ctx.sessionController.rename({ sessionId, title: 'Workbench ' + suffix });
  }
  const recordActivity = () => {
    const { id, text } = JSON.parse(readFileSync(config.activity, 'utf8'));
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
