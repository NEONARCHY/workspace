import {
  createContext,
  useContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

type OpenEmployeeProfile = (userId: string) => void;

const EmployeeProfileContext = createContext<OpenEmployeeProfile | undefined>(undefined);
const PrepareEmployeeProfileContext = createContext<OpenEmployeeProfile | undefined>(undefined);

export function useOpenEmployeeProfile() {
  return useContext(EmployeeProfileContext);
}

export function EmployeeProfileProvider({
  children,
  onOpenProfile,
  onPrepareProfile,
}: {
  readonly children: ReactNode;
  readonly onOpenProfile: OpenEmployeeProfile;
  readonly onPrepareProfile?: OpenEmployeeProfile;
}) {
  return <PrepareEmployeeProfileContext.Provider value={onPrepareProfile}><EmployeeProfileContext.Provider value={onOpenProfile}>{children}</EmployeeProfileContext.Provider></PrepareEmployeeProfileContext.Provider>;
}

export function EmployeeProfileLink({
  userId,
  personName,
  children,
  className = "",
  as: Component = "span",
}: {
  readonly userId?: string;
  readonly personName: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "span" | "div" | "li";
}) {
  const openProfile = useContext(EmployeeProfileContext);
  const prepareProfile = useContext(PrepareEmployeeProfileContext);
  const available = Boolean(userId && openProfile);

  const stopPointer = (event: PointerEvent<HTMLElement>) => {
    if (available) event.stopPropagation();
  };
  const activate = () => {
    if (userId && openProfile) openProfile(userId);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!available || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    activate();
  };

  return <Component
    className={`employee-profile-link${available ? " is-interactive" : ""}${className ? ` ${className}` : ""}`}
    role={available ? "button" : undefined}
    tabIndex={available ? 0 : undefined}
    aria-haspopup={available ? "dialog" : undefined}
    aria-label={available ? `Открыть профиль: ${personName}` : undefined}
    onPointerDown={stopPointer}
    onPointerEnter={() => { if (available && userId) prepareProfile?.(userId); }}
    onFocus={() => { if (available && userId) prepareProfile?.(userId); }}
    onClick={(event) => {
      if (!available) return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    }}
    onKeyDown={handleKeyDown}
  >{children}</Component>;
}
