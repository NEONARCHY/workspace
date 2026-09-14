import { createContext, useContext, useLayoutEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReOrderDotsVertical16Regular } from "@fluentui/react-icons";

const SortContext = createContext<Map<string, ReactNode> | null>(null);

/** Personal ordering only. Server-backed callers retain their save and conflict contract. */
export function SpatialSort({ ids, children, onMove }: { ids: string[]; children: ReactNode; onMove: (source: string, target: string) => void }) {
  const [records] = useState(() => new Map<string, ReactNode>());
  const [active, setActive] = useState<string>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <SortContext.Provider value={records}><DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragStart={({ active: item }) => setActive(String(item.id))} onDragCancel={() => setActive(undefined)}
    onDragEnd={({ active: item, over }) => { setActive(undefined); if (over && over.id !== item.id) onMove(String(item.id), String(over.id)); }}
    accessibility={{ screenReaderInstructions: { draggable: "Пробел — поднять. Стрелки вверх и вниз — выбрать место. Пробел — перенести. Escape — отменить." } }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    <DragOverlay dropAnimation={window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? null : { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }}>{active ? <div className="spatial-sort-preview" aria-hidden="true" inert>{records.get(active)}</div> : null}</DragOverlay>
  </DndContext></SortContext.Provider>;
}

export function SpatialSortItem({ id, label, disabled, children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { id: string; label: string; disabled: boolean }) {
  const records = useContext(SortContext);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  useLayoutEffect(() => { records?.set(id, children); return () => { records?.delete(id); }; }, [children, id, records]);
  return <div {...props} ref={setNodeRef} className={`${className} spatial-sort-item ${isDragging ? "is-lifted" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .3 : 1 }}>
    {children}
    {!disabled ? <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" className="spatial-sort-grip" aria-label={`Переставить: ${label}`}><ReOrderDotsVertical16Regular /></button> : null}
  </div>;
}
