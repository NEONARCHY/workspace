import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePolling } from "./visible-polling";

let hidden = false;
const cleanups: (() => void)[] = [];
beforeEach(() => { hidden = false; vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden); });
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Visible background reads", () => {
  it("coalesces manual and timer refreshes while a read is pending", async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>(() => new Promise<string>(done => { resolve = done; }));
    const apply = vi.fn(); const poll = startVisiblePolling(load, apply, vi.fn(), 1000); cleanups.push(poll);
    await vi.advanceTimersByTimeAsync(0); poll.refresh(); poll.refresh(); await vi.advanceTimersByTimeAsync(5000);
    expect(load).toHaveBeenCalledTimes(1);
    resolve("fresh"); await vi.advanceTimersByTimeAsync(0); expect(apply).toHaveBeenCalledWith("fresh");
    await vi.advanceTimersByTimeAsync(1000); expect(load).toHaveBeenCalledTimes(2);
  });
  it("aborts a hidden read and ignores its late result after resuming", async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue("new");
    const apply = vi.fn(); const poll = startVisiblePolling(load, apply, vi.fn(), 1000); cleanups.push(poll);
    await vi.advanceTimersByTimeAsync(0); const first = load.mock.calls[0]![0];
    hidden = true; document.dispatchEvent(new Event("visibilitychange")); expect(first.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(1);
    hidden = false; document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0);
    resolve("old"); await vi.advanceTimersByTimeAsync(0); expect(apply.mock.calls).toEqual([["new"]]);
  });
  it("invalidates reads before a save and cancels work on disposal", async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>(() => new Promise<string>(done => { resolve = done; }));
    const apply = vi.fn(); const poll = startVisiblePolling(load, apply, vi.fn(), 1000); cleanups.push(poll);
    await vi.advanceTimersByTimeAsync(0); poll.invalidate(); expect(load.mock.calls[0]![0].aborted).toBe(true);
    resolve("before-save"); await vi.advanceTimersByTimeAsync(0); expect(apply).not.toHaveBeenCalled();
    poll.refresh(); await vi.advanceTimersByTimeAsync(0); poll(); expect(load.mock.calls[1]![0].aborted).toBe(true);
    resolve("after-exit"); await vi.advanceTimersByTimeAsync(5000); expect(apply).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(2);
  });
  it("retains errors and resumes after a paused mutation", async () => {
    let paused = true;
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("recovered");
    const fail = vi.fn(), apply = vi.fn(); const poll = startVisiblePolling(load, apply, fail, 1000, () => paused); cleanups.push(poll);
    await vi.advanceTimersByTimeAsync(1000); expect(load).not.toHaveBeenCalled();
    paused = false; poll.refresh(); await vi.advanceTimersByTimeAsync(0); expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    await vi.advanceTimersByTimeAsync(1000); expect(apply).toHaveBeenCalledWith("recovered");
  });
});
