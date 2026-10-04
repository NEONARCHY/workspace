import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeRecognitionProfile, EfficiencyOverview } from "@yuksalish/contracts";
import { loadEmployeeRecognitionProfile, loadWorkspaceEfficiency } from "./workspace-api";
import { clearProfilePreload, getPreparedProfile, invalidatePreparedProfile, loadPreparedProfile, loadPreparedProfileEfficiency } from "./profile-preload";

vi.mock("./workspace-api", () => ({ loadEmployeeRecognitionProfile: vi.fn(), loadWorkspaceEfficiency: vi.fn() }));
const profile: EmployeeRecognitionProfile = {
  person: { id: "one", name: "Сотрудник", initials: "С", role: "employee", color: "#0091A8" }, departmentName: null, employmentDate: null,
  serviceYears: null, serviceMonths: null, serviceDays: null, activeTaskCount: 0,
  activeTaskCountVisible: true, achievements: [], rewards: [], rewardCatalog: [],
  canIssueReward: false, canManageSettings: false,
};
afterEach(() => { clearProfilePreload(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("profile preparation", () => {
  it("shares intent and opening requests, then serves a short-lived prepared value", async () => {
    let resolve!: (value: EmployeeRecognitionProfile) => void;
    vi.mocked(loadEmployeeRecognitionProfile).mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = loadPreparedProfile("token", "one");
    expect(loadPreparedProfile("token", "one")).toBe(pending);
    expect(getPreparedProfile("token", "one")).toBeUndefined();
    resolve(profile); await pending;
    expect(getPreparedProfile("token", "one")).toBe(profile);
    expect(await loadPreparedProfile("token", "one")).toBe(profile);
    expect(loadEmployeeRecognitionProfile).toHaveBeenCalledTimes(1);
  });
  it("expires and invalidates after issuing a reward", async () => {
    vi.useFakeTimers();
    vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(profile);
    await loadPreparedProfile("token", "one");
    vi.advanceTimersByTime(30_001);
    expect(getPreparedProfile("token", "one")).toBeUndefined();
    await loadPreparedProfile("token", "one");
    invalidatePreparedProfile("token", "one");
    await loadPreparedProfile("token", "one");
    expect(loadEmployeeRecognitionProfile).toHaveBeenCalledTimes(3);
  });
  it("does not retain failed requests or let an old session refill the cache", async () => {
    let resolve!: (value: EmployeeRecognitionProfile) => void;
    vi.mocked(loadEmployeeRecognitionProfile).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const old = loadPreparedProfile("old", "one");
    clearProfilePreload();
    vi.mocked(loadEmployeeRecognitionProfile).mockRejectedValueOnce(new Error("offline"));
    await expect(loadPreparedProfile("new", "one")).rejects.toThrow("offline");
    resolve(profile); await old;
    expect(getPreparedProfile("new", "one")).toBeUndefined();
    vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(profile);
    await loadPreparedProfile("new", "one");
    expect(getPreparedProfile("new", "one")).toBe(profile);
  });
  it("bounds prefetch memory and separates people", async () => {
    vi.mocked(loadEmployeeRecognitionProfile).mockResolvedValue(profile);
    for (let index = 0; index < 9; index++) await loadPreparedProfile("token", String(index));
    expect(getPreparedProfile("token", "0")).toBeUndefined();
    expect(getPreparedProfile("token", "8")).toBe(profile);
    expect(getPreparedProfile("token", "other")).toBeUndefined();
    expect(getPreparedProfile("different-token", "8")).toBeUndefined();
  });
  it("shares the efficiency request and allows an explicit retry", async () => {
    const overview: EfficiencyOverview = { period: "2026-10", timezone: "Asia/Tashkent", methodologyVersion: "1", trackingStartedAt: "2026-01-01", currentUserId: "one", employees: [] };
    vi.mocked(loadWorkspaceEfficiency).mockResolvedValue(overview);
    const pending = loadPreparedProfileEfficiency("token");
    expect(loadPreparedProfileEfficiency("token")).toBe(pending);
    await pending;
    await loadPreparedProfileEfficiency("token");
    await loadPreparedProfileEfficiency("token", true);
    expect(loadWorkspaceEfficiency).toHaveBeenCalledTimes(2);
  });
});
