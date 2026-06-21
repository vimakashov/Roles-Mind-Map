import { beforeEach, expect, test, vi } from "vitest";
import { register, unregister, __resetBackStack, type BackHandle } from "../backStack.js";

// reconcile() is queued via queueMicrotask; await a microtask to flush it.
const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));
const handle = (): BackHandle & { onClose: ReturnType<typeof vi.fn> } => ({ onClose: vi.fn() });

beforeEach(() => {
  __resetBackStack();
  vi.restoreAllMocks();
});

test("opening pushes one sentinel per overlay at the same URL", async () => {
  const push = vi.spyOn(window.history, "pushState");
  register(handle());
  register(handle());
  await flush();
  expect(push).toHaveBeenCalledTimes(2);
  // url arg omitted (undefined) → same URL
  expect(push.mock.calls[0][2]).toBeUndefined();
});

test("a real Back press closes only the top overlay, then the next", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(b.onClose).toHaveBeenCalledTimes(1);
  expect(a.onClose).not.toHaveBeenCalled();

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(a.onClose).toHaveBeenCalledTimes(1);
});

test("a programmatic close drops one sentinel and swallows its echo popstate", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  unregister(b);
  await flush();
  expect(go).toHaveBeenCalledWith(-1);

  // jsdom does not fire popstate from history.go; simulate the browser echo.
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(a.onClose).not.toHaveBeenCalled();
  expect(b.onClose).not.toHaveBeenCalled();
});

test("simultaneous closes batch into a single history.go(-n)", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  unregister(a);
  unregister(b);
  await flush();
  expect(go).toHaveBeenCalledTimes(1);
  expect(go).toHaveBeenCalledWith(-2);
});

test("unregister of an already-popped handle is a no-op", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  register(a);
  await flush();

  window.dispatchEvent(new PopStateEvent("popstate")); // pops `a` via Back
  unregister(a); // React cleanup runs afterwards — must do nothing
  await flush();
  expect(go).not.toHaveBeenCalled();
});
