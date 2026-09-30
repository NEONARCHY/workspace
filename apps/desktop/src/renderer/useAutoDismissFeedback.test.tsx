import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAutoDismissFeedback } from "./useAutoDismissFeedback";

afterEach(() => vi.useRealTimers());

function useFeedback(initial: string, isError: boolean) {
  const [message, setMessage] = useState(initial);
  useAutoDismissFeedback(message, isError, setMessage);
  return { message, setMessage };
}

describe("useAutoDismissFeedback", () => {
  it("removes a successful status after four seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback("Сохранено", false));
    act(() => vi.advanceTimersByTime(3_999));
    expect(result.current.message).toBe("Сохранено");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBe("");
  });

  it("keeps errors visible for retry", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback("Сервер недоступен", true));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.message).toBe("Сервер недоступен");
  });

  it("restarts the timeout when another status replaces the first", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback("Первое", false));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.setMessage("Второе"));
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.message).toBe("Второе");
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.message).toBe("");
  });
});
