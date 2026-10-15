import type { HTMLAttributes, ReactNode, Ref } from "react";
import { CheckmarkCircle20Regular, ErrorCircle20Regular, Info20Regular, Warning20Regular } from "@fluentui/react-icons";
import "./workspace-notice.css";

export type WorkspaceNoticeTone = "info" | "success" | "warning" | "error";
interface WorkspaceNoticeProps extends HTMLAttributes<HTMLDivElement> {
  readonly ref?: Ref<HTMLDivElement>;
  readonly tone?: WorkspaceNoticeTone;
  readonly actions?: ReactNode;
  readonly icon?: ReactNode;
}
const icons = { info: Info20Regular, success: CheckmarkCircle20Regular, warning: Warning20Regular, error: ErrorCircle20Regular };

/** Short contextual feedback; not a field error, loading screen or empty-state card. */
export function WorkspaceNotice({ tone = "info", actions, icon, className = "", children, role, ...rest }: WorkspaceNoticeProps) {
  const Icon = icons[tone];
  return <div {...rest} role={role ?? (tone === "error" ? "alert" : "status")}
    className={`workspace-notice ${className}`.trim()} data-tone={tone} data-has-actions={actions ? "true" : undefined}>
    {icon ? <span className="workspace-notice-icon" aria-hidden="true">{icon}</span> : <Icon className="workspace-notice-icon" aria-hidden="true" />}
    <div className="workspace-notice-content">{children}</div>
    {actions ? <div className="workspace-notice-actions">{actions}</div> : null}
  </div>;
}
