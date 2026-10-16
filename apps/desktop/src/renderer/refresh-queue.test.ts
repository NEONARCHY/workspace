import { describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refresh-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("acknowledged message refresh races", () => {
  it("joins a slow refresh without extending it on every recovery timer tick", async () => {
    const first = deferred<number>();
    const load = vi.fn().mockReturnValue(first.promise);
    const apply = vi.fn();
    const refresh = createRefreshQueue(load, apply, () => "token");
    const pending = refresh("token");
    for (let tick = 0; tick < 50; tick++) void refresh("token", { trailing: false });
    first.resolve(1);
    await pending;
    expect(load).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(1);
  });

  it("cannot replace an acknowledged message with a response started before the acknowledgement", async () => {
    const old = deferred<string[]>(), fresh = deferred<string[]>();
    let messages = ["before"];
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const apply = vi.fn((value: string[]) => { messages = value; });
    const refresh = createRefreshQueue(load, apply, () => "token");
    const pending = refresh("token");
    messages.push("sent-and-acknowledged");
    refresh.invalidate("token");
    void refresh("token");
    old.resolve(["before"]);
    await Promise.resolve();
    expect(messages).toEqual(["before", "sent-and-acknowledged"]);
    expect(apply).not.toHaveBeenCalled();
    fresh.resolve(["before", "sent-and-acknowledged", "incoming"]);
    await pending;
    expect(messages).toEqual(["before", "sent-and-acknowledged", "incoming"]);
  });

  it("does not starve ordinary incoming updates during a continuous event burst", async () => {
    const first = deferred<number>(), second = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const apply = vi.fn();
    const refresh = createRefreshQueue(load, apply, () => "token");
    const pending = refresh("token");
    void refresh("token");
    first.resolve(1);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledWith(1);
    second.resolve(2);
    await pending;
    expect(apply.mock.calls).toEqual([[1], [2]]);
  });
});
