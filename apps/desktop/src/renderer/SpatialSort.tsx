import type { HTMLAttributes, ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReOrderDotsVertical16Regular } from "@fluentui/react-icons";

/** Personal ordering only. Server-backed callers retain their save and conflict contract. */
export function SpatialSort({ ids, children, onMove, verticalIntent = false }: { ids: string[]; children: ReactNode; onMove: (source: string, target: string) => void; verticalIntent?: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: verticalIntent ? { distance: { y: 10 }, tolerance: { x: 8 } } : { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragEnd={({ active: item, over }) => { if (over && over.id !== item.id) onMove(String(item.id), String(over.id)); }}
    accessibility={{ screenReaderInstructions: { draggable: "Пробел — поднять. Стрелки вверх и вниз — выбрать место. Пробел — перенести. Escape — отменить." } }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

export function SpatialSortItem({ id, label, disabled, activation = "grip", children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { id: string; label: string; disabled: boolean; activation?: "grip" | "item" }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const verticalTransform = transform ? { ...transform, x: 0 } : null;
  return <div {...(activation === "item" && !disabled ? { ...attributes, ...listeners, tabIndex: 0, "aria-label": `Переставить: ${label}` } : {})} {...props} ref={setNodeRef} className={`${className} spatial-sort-item ${isDragging ? "is-lifted" : ""}`} style={{ transform: CSS.Transform.toString(verticalTransform), transition, zIndex: isDragging ? 2 : undefined }}>
    {children}
    {!disabled && activation === "grip" ? <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" className="spatial-sort-grip" aria-label={`Переставить: ${label}`}><ReOrderDotsVertical16Regular /></button> : null}
  </div>;
}
