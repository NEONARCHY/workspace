interface AssistantViewport {
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly headerBottom: number;
  readonly browserCompact: boolean;
}

/** Keep the launcher reachable above both the compact and expanded assistant. */
export function assistantPanelLayout(viewport: AssistantViewport, expanded: boolean) {
  const compact = viewport.browserCompact || viewport.width <= 600;
  const edge = compact || expanded ? 12 : 20;
  const panelTop = Math.max(viewport.top + edge, viewport.headerBottom + 8);
  const availableHeight = Math.max(0, viewport.height - (panelTop - viewport.top) - edge);
  return { compact, edge, panelTop,
    panelWidth: expanded || compact ? viewport.width - edge * 2 : Math.min(460, viewport.width - edge * 2),
    panelHeight: expanded || compact ? availableHeight : Math.min(750, availableHeight),
  };
}
