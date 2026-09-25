import { navigationKeys, type NavigationKey, type PersonalPreferences } from "@yuksalish/contracts";

export const defaultPersonalPreferences: PersonalPreferences = {
  pinnedChatIds: [], archivedChatIds: [], navigationOrder: navigationKeys, locale: "ru", revision: 0,
};

export function normalizeNavigation(order: readonly NavigationKey[]): NavigationKey[] {
  const known = [...new Set(order.filter((key) => navigationKeys.includes(key)))];
  const missing = navigationKeys.filter((key) => !known.includes(key));
  if (known.includes("projects")) {
    for (const key of (["project_hub", "project_funding"] as const)) {
      const missingIndex = missing.indexOf(key);
      if (missingIndex >= 0) {
        const anchor = key === "project_hub" ? "projects" : "project_hub";
        known.splice(known.indexOf(anchor) + 1, 0, key);
        missing.splice(missingIndex, 1);
      }
    }
  }
  return [...known, ...missing];
}

/** Move only known identities. Unknown or same-item drops are no-ops. */
export function moveBefore<T extends string>(order: readonly T[], source: T, target: T): T[] {
  const from = order.indexOf(source), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const result = [...order];
  result.splice(from, 1);
  result.splice(to, 0, source);
  return result;
}

export function latestPreferences(current: PersonalPreferences, received: PersonalPreferences): PersonalPreferences {
  return received.revision >= current.revision ? received : current;
}
