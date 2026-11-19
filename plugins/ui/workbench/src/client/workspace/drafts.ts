import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';

export type Draft = { kind: 'section' | 'project' | 'session'; parent: string; chooseProject?: boolean };
export type Drafts = HostObservable<Draft | undefined> & { begin(draft: Draft): void; end(draft: Draft): void };

export function createDrafts(): Drafts {
  let current: Draft | undefined;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(draft) { current = draft; publish(); },
    end(draft) { if (current === draft) { current = undefined; publish(); } },
  };
}
