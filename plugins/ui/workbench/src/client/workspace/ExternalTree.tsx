import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ExternalSession, ExternalSnapshot, SessionSources } from '../integration/sessionSources.js';
import type { WorkspaceTreeProps } from './WorkspaceTree.js';

interface Folder { path: string; sessions: ExternalSession[] }
interface Project { id: string | null; name: string; folders: Map<string, Folder> }

function group(snapshot: ExternalSnapshot): Project[] {
  const projects = new Map<string | null, Project>(snapshot.projects.map(({ id, name, roots }) => [id, {
    id, name, folders: new Map(roots.map(path => [path, { path, sessions: [] }])),
  }]));
  for (const session of [...snapshot.sessions].sort((left, right) => right.updatedAt - left.updatedAt)) {
    let project = projects.get(session.projectId);
    if (!project) {
      project = projects.get(null) ?? { id: null, name: '', folders: new Map() };
      projects.set(null, project);
    }
    const folder = project.folders.get(session.cwd) ?? { path: session.cwd, sessions: [] };
    folder.sessions.push(session);
    project.folders.set(session.cwd, folder);
  }
  return [...projects.values()];
}

function Branch({ title, detail, depth, children, kind }: {
  title: string; detail?: string; depth: number; children: ReactNode; kind: 'project' | 'workspace';
}) {
  const [expanded, setExpanded] = useState(true);
  return <div data-external-branch={kind}>
    <div className="wb-tree-row" style={{ '--wb-depth': depth } as CSSProperties}>
      <button type="button" className="wb-tree-label" title={detail || title} aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}><span aria-hidden="true">{expanded ? '⌄' : '›'}</span><span>{title}</span></button>
    </div>
    {expanded && children}
  </div>;
}

function FolderRows({ folder, t, open }: {
  folder: Folder; t: WorkspaceTreeProps['t']; open: (id: string) => Promise<void>;
}) {
  const [visible, setVisible] = useState(10);
  const name = folder.path.split(/[/\\]/).filter(Boolean).at(-1) || folder.path || t('unknownDirectory');
  return <Branch title={name} detail={folder.path} depth={1} kind="workspace">
    {folder.sessions.slice(0, visible).map(item => <div key={item.id} className="wb-tree-row" data-external-session={item.id}
      style={{ '--wb-depth': 1 } as CSSProperties}>
      <button type="button" className="wb-tree-label" title={item.title} onClick={() => { void open(item.id); }}>
        <span>{item.title}</span>{item.archived && <small>{t('externalArchived')}</small>}
      </button>
    </div>)}
    {visible < folder.sessions.length && <button type="button" className="wb-tree-show-more" style={{ '--wb-depth': 2 } as CSSProperties}
      onClick={() => setVisible(visible + 20)}>{t('showMore')}</button>}
  </Branch>;
}

export function ExternalTree({ source, wide, expandSidebar, useSectionScroller, t }: Pick<WorkspaceTreeProps,
  'wide' | 'expandSidebar' | 'useSectionScroller' | 't'> & { source: NonNullable<SessionSources['codex']> }) {
  const { bindScrollerRef } = useSectionScroller();
  const [error, setError] = useState(false);
  const projects = useMemo(() => group(source.snapshot), [source.snapshot]);
  const open = async (id: string) => { setError(false); setError(!await source.open(id)); };
  if (!wide) return <button type="button" className="wb-tree-action wb-tree-compact" aria-label={t('projects')}
    title={t('projects')} onClick={expandSidebar}>▤</button>;
  return <div ref={bindScrollerRef} className="wb-tree" data-workbench-external-tree aria-label={t('codexProjects')}>
    {error && <p className="wb-tree-error" role="alert">{t('externalOpenFailed')}</p>}
    {!projects.length && <p className="wb-tree-error">{t('externalEmpty')}</p>}
    {projects.map(project => <Branch key={project.id ?? 'unassigned'} title={project.name || t('unassignedCodex')}
      depth={0} kind="project">
      {[...project.folders.values()].map(folder => <FolderRows key={folder.path} folder={folder} t={t} open={open} />)}
    </Branch>)}
  </div>;
}
