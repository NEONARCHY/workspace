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
    readonly configureUpdates: (apiBaseUrl: string, accessToken: string) => Promise<{
      readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
      readonly version?: string;
      readonly percent?: number;
      readonly message?: string;
    }>;
    readonly checkForUpdates: () => Promise<{
      readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
      readonly version?: string;
      readonly percent?: number;
      readonly message?: string;
    }>;
    readonly installUpdate: () => Promise<void>;
    readonly onUpdateStatus: (listener: (status: {
      readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
      readonly version?: string;
      readonly percent?: number;
      readonly message?: string;
    }) => void) => () => void;
    readonly loadDraft: (key: string) => Promise<string | null>;
    readonly saveDraft: (key: string, text: string) => Promise<boolean>;
    readonly clearDraft: (key: string) => Promise<void>;
    readonly loadSession: () => Promise<string | null>;
    readonly saveSession: (refreshToken: string) => Promise<boolean>;
    readonly clearSession: () => Promise<void>;
  };
}
