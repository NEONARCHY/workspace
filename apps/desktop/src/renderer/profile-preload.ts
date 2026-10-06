import type { EmployeeRecognitionProfile, EfficiencyOverview } from "@yuksalish/contracts";
import { loadEmployeeRecognitionProfile, loadWorkspaceEfficiency } from "./workspace-api";

// Memory only, scoped to one authenticated session. Intent prefetch is bounded;
// opening a profile reuses the same request rather than starting a second one.
const ttl = 30_000;
const limit = 8;
interface Entry<T> { pending?: Promise<T>; value?: T; expires: number }
let sessionToken: string | undefined;
const profiles = new Map<string, Entry<EmployeeRecognitionProfile>>();
let efficiency: Entry<EfficiencyOverview> | undefined;

export function clearProfilePreload() {
  sessionToken = undefined;
  profiles.clear();
  efficiency = undefined;
}

export function isProfilePreloadSession(token: string) {
  return sessionToken === token;
}

function scope(token: string) {
  if (sessionToken !== token) { clearProfilePreload(); sessionToken = token; }
}

export function getPreparedProfile(token: string, userId?: string) {
  scope(token);
  const entry = userId ? profiles.get(userId) : undefined;
  return entry && entry.expires > Date.now() ? entry.value : undefined;
}

export function invalidatePreparedProfile(token: string, userId: string) {
  scope(token);
  profiles.delete(userId);
}

export function loadPreparedProfile(token: string, userId: string): Promise<EmployeeRecognitionProfile> {
  scope(token);
  const existing = profiles.get(userId);
  if (existing?.pending) return existing.pending;
  if (existing?.value && existing.expires > Date.now()) return Promise.resolve(existing.value);
  const entry: Entry<EmployeeRecognitionProfile> = { expires: 0 };
  if (profiles.size >= limit && !profiles.has(userId)) profiles.delete(profiles.keys().next().value!);
  profiles.set(userId, entry);
  entry.pending = loadEmployeeRecognitionProfile(token, userId).then((value) => {
    if (sessionToken === token && profiles.get(userId) === entry) {
      entry.value = value; entry.expires = Date.now() + ttl; entry.pending = undefined;
    }
    return value;
  }, (error: unknown) => {
    if (sessionToken === token && profiles.get(userId) === entry) profiles.delete(userId);
    throw error;
  });
  return entry.pending;
}

export function loadPreparedProfileEfficiency(token: string, force = false): Promise<EfficiencyOverview> {
  scope(token);
  if (efficiency?.pending) return efficiency.pending;
  if (!force && efficiency?.value && efficiency.expires > Date.now()) return Promise.resolve(efficiency.value);
  const entry: Entry<EfficiencyOverview> = { expires: 0 };
  efficiency = entry;
  entry.pending = loadWorkspaceEfficiency(token).then((value) => {
    if (sessionToken === token && efficiency === entry) {
      entry.value = value; entry.expires = Date.now() + ttl; entry.pending = undefined;
    }
    return value;
  }, (error: unknown) => {
    if (sessionToken === token && efficiency === entry) efficiency = undefined;
    throw error;
  });
  return entry.pending;
}
