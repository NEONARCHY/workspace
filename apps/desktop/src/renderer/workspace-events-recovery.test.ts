import { afterEach, expect, it, vi } from "vitest";
import { subscribeToWorkspaceEvents } from "./workspace-api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  vi.useFakeTimers();
  class Socket extends EventTarget {
    static instances: Socket[] = [];
    send = vi.fn();
    close = vi.fn(() => this.dispatchEvent(new CloseEvent("close", { code: 1006 })));
    constructor() { super(); Socket.instances.push(this); }
    receive(type: string) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type }) })); }
  }
  vi.stubGlobal("WebSocket", Socket);
  const refresh = vi.fn(), error = vi.fn();
  const stop = subscribeToWorkspaceEvents("token", refresh, error);
  return { Socket, refresh, error, stop, socket: Socket.instances[0]! };
}
it("pings healthy connections without refreshing for pong and cleans up every timer", async () => {
  const { socket, refresh, stop } = setup();
  socket.receive("authenticated");
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(19_800);
  expect(socket.send).toHaveBeenCalledWith('{"type":"ping"}');
  socket.receive("pong");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(socket.close).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it("reconnects a silent half-open socket and refreshes after reauthentication", async () => {
  const { Socket, socket, refresh, stop } = setup();
  socket.receive("authenticated");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(socket.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(Socket.instances).toHaveLength(2);
  Socket.instances[1]!.receive("authenticated");
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(2);
  socket.receive("authenticated"); // a late event from the retired connection
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds an unanswered authentication handshake and never reconnects after disposal", async () => {
  const { socket, Socket, stop } = setup();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(socket.close).toHaveBeenCalledOnce();
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
});
it("does not retry a rejected session or leave heartbeat timers running", async () => {
  const { socket, Socket, stop } = setup();
  socket.receive("authenticated");
  socket.dispatchEvent(new CloseEvent("close", { code: 4401 }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(socket.send).not.toHaveBeenCalled();
  stop();
});
