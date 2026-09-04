import { Dialog, type DialogProps } from "@fluentui/react-components";

/** Keep Fluent's presence/focus lifecycle, but never scale text during a transition. */
export function WorkspaceDialog(props: DialogProps) {
  return <Dialog
    surfaceMotion={{ outScale: 1, inScale: 1, duration: 240, exitDuration: 160,
      easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.4, 0, 1, 1)" }}
    {...props}
  />;
}
