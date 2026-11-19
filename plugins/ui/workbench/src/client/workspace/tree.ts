export const defaultSection = 'section:projects';
export const ungrouped = 'workbench:ungrouped';

type Orders = Record<string, string[]>;
export interface Section { id: string; title: string }
export interface TreeState {
  sections: Section[];
  projects: Orders;
  sessions: Orders;
  sessionProjects: Record<string, string>;
  projectPins?: string[];
  unread?: string[];
}
export type Position = { id: string; after: boolean };
export interface ProjectInfo { id: string; sessionIds: readonly string[] }
export interface SessionInfo { id: string; updatedAt: number }

export function emptyTree(): TreeState {
  return { sections: [{ id: defaultSection, title: '' }], projects: {}, sessions: {}, sessionProjects: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function readOrders(value: unknown): Orders {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => {
    const [, ids] = entry;
    return Array.isArray(ids) && ids.every(id => typeof id === 'string');
  }));
}

function readIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : [];
}

export function readTree(value: unknown): TreeState {
  if (!isRecord(value)) return emptyTree();
  const sections = Array.isArray(value.sections)
    ? value.sections.filter((section): section is Section => isRecord(section)
      && typeof section.id === 'string' && section.id.startsWith('section:')
      && typeof section.title === 'string')
    : [];
  if (!sections.some(section => section.id === defaultSection)) sections.unshift(emptyTree().sections[0]);
  return {
    sections: [...new Map(sections.map(section => [section.id, section])).values()],
    projects: readOrders(value.projects),
    sessions: readOrders(value.sessions),
    projectPins: readIds(value.projectPins),
    unread: readIds(value.unread),
    sessionProjects: isRecord(value.sessionProjects)
      ? Object.fromEntries(Object.entries(value.sessionProjects).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {},
  };
}

export function insert(ids: readonly string[], id: string, position?: Position): string[] {
  if (position?.id === id) return [...ids];
  const next = ids.filter(item => item !== id);
  const anchor = position ? next.indexOf(position.id) : -1;
  next.splice(anchor < 0 ? next.length : anchor + Number(position?.after), 0, id);
  return next;
}

export function orderBySaved(ids: readonly string[], saved?: readonly string[]): string[] {
  const ordered = new Set<string>();
  const available = new Set(ids);
  for (const id of saved ?? []) if (available.has(id)) ordered.add(id);
  for (const id of ids) ordered.add(id);
  return [...ordered];
}

function places(orders: Orders): Map<string, string> {
  return new Map(Object.entries(orders).flatMap(([parent, ids]) => ids.map(id => [id, parent] as const)));
}

export function projectGroups(state: TreeState, ids: readonly string[]): Map<string, string[]> {
  const parents = places(state.projects);
  const valid = new Set([...state.sections.map(section => section.id), ...ids]);
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const parent = parents.get(id);
    const destination = parent && valid.has(parent) && canMoveProject(id, parent, parents) ? parent : defaultSection;
    const group = groups.get(destination) ?? [];
    group.push(id);
    groups.set(destination, group);
  }
  const pinned = new Set(state.projectPins);
  for (const [parent, group] of groups) {
    const ordered = orderBySaved(group, state.projects[parent]);
    groups.set(parent, [...ordered.filter(id => pinned.has(id)), ...ordered.filter(id => !pinned.has(id))]);
  }
  return groups;
}

function canMoveProject(id: string, parent: string, parents: Map<string, string>): boolean {
  const visited = new Set([id]);
  for (let current: string | undefined = parent; current; current = parents.get(current)) {
    if (visited.has(current)) return false;
    visited.add(current);
  }
  return true;
}

function relocate(orders: Orders, id: string, parent: string, order: string[]): Orders {
  const next = { ...orders };
  for (const key of Object.keys(orders)) {
    if (key !== parent && orders[key].includes(id)) next[key] = orders[key].filter(item => item !== id);
  }
  return { ...next, [parent]: order };
}

export function moveProject(state: TreeState, id: string, parent: string, ids: readonly string[], position?: Position): TreeState {
  if (!ids.includes(id) || ![...ids, ...state.sections.map(section => section.id)].includes(parent)
    || !canMoveProject(id, parent, places(state.projects))) return state;
  const order = insert(projectGroups(state, ids).get(parent) ?? [], id, position);
  return { ...state, projects: relocate(state.projects, id, parent, order) };
}

export function sessionGroups(state: TreeState, projects: readonly ProjectInfo[], sessions: readonly SessionInfo[],
  pins: ReadonlySet<string>): Map<string, string[]> {
  const projectsById = new Set(projects.map(project => project.id));
  const native = new Map<string, string>();
  for (const project of projects) for (const id of project.sessionIds) {
    if (!native.has(id)) native.set(id, project.id);
  }
  const groups = new Map<string, string[]>();
  for (const { id } of [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)) {
    const assigned = state.sessionProjects[id];
    const parent = assigned === ungrouped || projectsById.has(assigned) ? assigned : native.get(id) ?? ungrouped;
    const group = groups.get(parent) ?? [];
    group.push(id);
    groups.set(parent, group);
  }
  for (const [id, group] of groups) {
    const ordered = orderBySaved(group, state.sessions[id]);
    groups.set(id, [...ordered.filter(item => pins.has(item)), ...ordered.filter(item => !pins.has(item))]);
  }
  return groups;
}

export function placeSession(state: TreeState, id: string, project: string, ids: readonly string[],
  pins: ReadonlySet<string>, position?: Position, leading = false): TreeState {
  const pinned = pins.has(id);
  const group = ids.filter(item => item !== id && pins.has(item) === pinned);
  const anchor = leading && group[0] ? { id: group[0], after: false } : position;
  const changed = insert(group, id, anchor);
  const others = ids.filter(item => item !== id && pins.has(item) !== pinned);
  const order = pinned ? [...changed, ...others] : [...others, ...changed];
  return { ...state, sessions: relocate(state.sessions, id, project, order) };
}

export function moveSession(state: TreeState, id: string, project: string, ids: readonly string[],
  pins: ReadonlySet<string>, position?: Position): TreeState {
  if (position?.id === id) return state;
  return { ...placeSession(state, id, project, ids, pins, position), sessionProjects: { ...state.sessionProjects, [id]: project } };
}
