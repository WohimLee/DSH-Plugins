import { useRef, useState } from 'react';
import type { DragEvent, HTMLAttributes } from 'react';

export type Item = { kind: 'section' | 'project' | 'session'; id: string; parent: string };
type Placement = 'before' | 'inside' | 'after';

export function useTreeDrag(move: (source: Item, target: Item, placement: Placement) => void) {
  const source = useRef<Item | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; placement: Placement }>();
  const clear = () => {
    source.current = null;
    setHighlight(undefined);
  };

  function row(target: Item, draggable = true, appendSection = false): HTMLAttributes<HTMLDivElement> {
    function placement(event: DragEvent<HTMLDivElement>): Placement | undefined {
      const current = source.current;
      if (!current || current.id === target.id) return;
      if (appendSection) return current.kind === 'section' ? 'after' : undefined;
      const bounds = event.currentTarget.getBoundingClientRect();
      const fraction = (event.clientY - bounds.top) / bounds.height;
      if (current.kind === 'project' && target.kind === 'section') return 'inside';
      if (current.kind === 'session' && target.kind === 'project') return 'inside';
      if (current.kind !== target.kind) return;
      if (target.kind === 'project' && fraction > 0.25 && fraction < 0.75) return 'inside';
      return fraction < 0.5 ? 'before' : 'after';
    }
    return {
      draggable,
      onDragStart(event) {
        if (!draggable) return;
        source.current = target;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-dsh-workbench-row', target.kind);
        event.stopPropagation();
      },
      onDragEnd: clear,
      onDragOver(event) {
        const at = placement(event);
        if (!at) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setHighlight(current => current?.id === target.id && current.placement === at
          ? current : { id: target.id, placement: at });
      },
      onDragLeave(event) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setHighlight(current => current?.id === target.id ? undefined : current);
      },
      onDrop(event) {
        const at = placement(event);
        const current = source.current;
        if (!at || !current) return;
        event.preventDefault();
        clear();
        move(current, target, at);
      },
    };
  }

  return { row, highlight, sectionDrag: () => source.current?.kind === 'section' };
}
