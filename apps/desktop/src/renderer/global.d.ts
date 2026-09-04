interface Window {
  readonly yuksalish?: {
    readonly platform: string;
    readonly version: string;
    readonly reportDiagnostic?: (payload: { category: string; name: string; frames: string }) => Promise<void>;
    readonly showNotification: (payload: {
      readonly id: string;
      readonly title: string;
      readonly body: string;
      readonly section: string;
      readonly entityId?: string;
    }) => Promise<boolean>;
    readonly onNotificationOpen: (listener: (payload: {
      readonly id: string;
      readonly section: string;
      readonly entityId?: string;
    }) => void) => () => void;
  };
}
