import type { DesktopUpdatePolicy } from "@yuksalish/contracts";

export interface DesktopUpdateStatus {
  readonly phase: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
}

export function compareDesktopVersions(left: string, right: string): number {
  const valid = /^\d+\.\d+\.\d+$/;
  if (!valid.test(left) || !valid.test(right)) return 0;
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export function requiresDesktopUpdate(policy: DesktopUpdatePolicy | undefined, currentVersion: string | undefined): boolean {
  return Boolean(
    policy?.mandatory && policy.minimumVersion && currentVersion
    && compareDesktopVersions(currentVersion, policy.minimumVersion) < 0,
  );
}
