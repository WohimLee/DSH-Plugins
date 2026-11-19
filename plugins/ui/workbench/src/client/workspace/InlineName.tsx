import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export function InlineName({ label, depth = 0, initial = '', controls, cancel, confirm }: {
  label: string; depth?: number; initial?: string; controls?: ReactNode;
  cancel: () => void; confirm: (name: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <form className="wb-tree-row wb-inline-name" data-workbench-draft style={{ '--wb-depth': depth } as CSSProperties}
    onBlur={event => { if (!name.trim() && !event.currentTarget.contains(event.relatedTarget)) cancel(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    }} onSubmit={event => {
      event.preventDefault();
      const title = name.trim();
      if (title) confirm(title);
    }}>
    <input ref={input} value={name} aria-label={label} placeholder={label} maxLength={80}
      onChange={event => setName(event.target.value)} />
    {controls}
  </form>;
}
