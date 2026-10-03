import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@fluentui/react-components";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { ProfileAvatar } from "./ProfileAvatar";

let closeActiveParticipantPopover: (() => void) | undefined;

export function TaskParticipantAvatar({ person, role, token }: {
  readonly person?: WorkspacePerson;
  readonly role: "Постановщик" | "Исполнитель" | "Соисполнитель" | "Наблюдатель";
  readonly token?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [pointerOpened, setPointerOpened] = useState(false);
  const [origin, setOrigin] = useState("50% 100%");
  const reduceMotion = useReducedMotion();
  const cursorX = useMotionValue(0);
  const cursorTilt = useMotionValue(0);
  const springX = useSpring(cursorX, { stiffness: 130, damping: 16 });
  const springTilt = useSpring(cursorTilt, { stiffness: 130, damping: 16 });
  const pointerFrame = useRef<number | undefined>(undefined);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const closeSelf = useRef(() => setOpen(false));
  const suppressFocus = useRef(false);
  const name = person?.name ?? "Сотрудник";
  const show = (fromPointer: boolean) => {
    if (suppressFocus.current) return;
    window.clearTimeout(closeTimer.current);
    if (closeActiveParticipantPopover !== closeSelf.current) closeActiveParticipantPopover?.();
    closeActiveParticipantPopover = closeSelf.current;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 220;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const top = rect.top >= 74 ? rect.top - 55 : rect.bottom + 9;
    cursorX.set(0);
    cursorTilt.set(0);
    setPointerOpened(fromPointer);
    setOrigin(rect.top >= 74 ? "50% 100%" : "50% 0%");
    setPosition({ left, top });
    setOpen(true);
  };
  const followPointer = (clientX: number) => {
    if (reduceMotion) return;
    window.cancelAnimationFrame(pointerFrame.current ?? 0);
    pointerFrame.current = window.requestAnimationFrame(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const offset = Math.max(-1, Math.min(1, (clientX - rect.left - rect.width / 2) / (rect.width / 2)));
      cursorX.set(offset * 9);
      cursorTilt.set(offset * 6);
    });
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      if (closeActiveParticipantPopover === closeSelf.current) closeActiveParticipantPopover = undefined;
    }, 140);
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      suppressFocus.current = true;
      anchorRef.current?.querySelector<HTMLElement>(".employee-profile-link")?.focus();
      suppressFocus.current = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!anchorRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useEffect(() => () => {
    window.clearTimeout(closeTimer.current);
    window.cancelAnimationFrame(pointerFrame.current ?? 0);
    if (closeActiveParticipantPopover === closeSelf.current) closeActiveParticipantPopover = undefined;
  }, []);
  const avatar = () => person && token
    ? <ProfileAvatar person={person} token={token} size={28} />
    : <Avatar name={name} size={28} color="colorful" />;

  return <>
    <span ref={anchorRef} className={`task-participant-anchor task-participant-${role === "Исполнитель" ? "primary" : role === "Соисполнитель" ? "co" : role === "Наблюдатель" ? "observer" : "author"}`}
      onPointerEnter={(event) => { show(true); followPointer(event.clientX); }} onPointerMove={(event) => followPointer(event.clientX)}
      onPointerLeave={hideSoon} onFocus={() => show(false)} onBlur={hideSoon} onClickCapture={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" || !open) return;
        event.preventDefault();
        popoverRef.current?.querySelector<HTMLElement>(".employee-profile-link")?.focus();
      }}>
      <EmployeeProfileLink userId={person?.id} personName={name} className="task-participant-avatar">
        {avatar()}
      </EmployeeProfileLink>
    </span>
    {open ? createPortal(<motion.div ref={popoverRef} className="task-participant-popover" role="dialog" aria-label={`${role}: ${name}`}
      initial={reduceMotion || !pointerOpened ? false : { opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 360, damping: 29 }}
      style={{ ...position, x: springX, rotate: springTilt, transformOrigin: origin }}
      onPointerEnter={() => { window.clearTimeout(closeTimer.current); cursorX.set(0); cursorTilt.set(0); }} onPointerLeave={hideSoon}
      onFocus={() => window.clearTimeout(closeTimer.current)} onBlur={hideSoon} onClickCapture={() => setOpen(false)}>
      <EmployeeProfileLink userId={person?.id} personName={name} className="task-participant-profile">
        <small>{role}</small><strong>{name}</strong>
      </EmployeeProfileLink>
    </motion.div>, document.body) : null}
  </>;
}
