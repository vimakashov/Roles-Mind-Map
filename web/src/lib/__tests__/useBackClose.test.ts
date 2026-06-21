import { beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBackClose } from "../useBackClose.js";
import { __resetBackStack } from "../backStack.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

beforeEach(() => {
  __resetBackStack();
  vi.restoreAllMocks();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
});

test("registers when open: a Back press fires onClose", async () => {
  const onClose = vi.fn();
  renderHook(() => useBackClose(true, onClose));
  await flush();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("does not register when closed", async () => {
  const onClose = vi.fn();
  renderHook(() => useBackClose(false, onClose));
  await flush();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onClose).not.toHaveBeenCalled();
});

test("calls the latest onClose after a re-render (no stale closure)", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHook(({ cb }) => useBackClose(true, cb), {
    initialProps: { cb: first },
  });
  await flush();
  rerender({ cb: second });
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("unregisters on unmount via a guarded history.go", async () => {
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const { unmount } = renderHook(() => useBackClose(true, vi.fn()));
  await flush();
  unmount();
  await flush();
  expect(go).toHaveBeenCalledWith(-1);
});
