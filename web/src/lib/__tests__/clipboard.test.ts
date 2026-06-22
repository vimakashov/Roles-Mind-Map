import { afterEach, expect, test, vi } from "vitest";
import { copyToClipboard } from "../clipboard.js";

const originalClipboard = navigator.clipboard;
const originalExec = (document as { execCommand?: unknown }).execCommand;

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  Object.defineProperty(document, "execCommand", { value: originalExec, configurable: true });
});

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

function setExecCommand(fn: (cmd: string) => boolean) {
  // jsdom does not implement execCommand, so install our own to observe the fallback.
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
}

test("uses the async Clipboard API when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard({ writeText });
  const exec = vi.fn().mockReturnValue(true);
  setExecCommand(exec);

  await expect(copyToClipboard("hello")).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("hello");
  expect(exec).not.toHaveBeenCalled();
});

test("falls back to execCommand when the Clipboard API is missing (Safari/insecure context)", async () => {
  setClipboard(undefined);
  const exec = vi.fn().mockReturnValue(true);
  setExecCommand(exec);

  await expect(copyToClipboard("hello")).resolves.toBe(true);
  expect(exec).toHaveBeenCalledWith("copy");
});

test("falls back to execCommand when writeText rejects (Safari permission)", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
  setClipboard({ writeText });
  const exec = vi.fn().mockReturnValue(true);
  setExecCommand(exec);

  await expect(copyToClipboard("hello")).resolves.toBe(true);
  expect(writeText).toHaveBeenCalled();
  expect(exec).toHaveBeenCalledWith("copy");
});

test("returns false when no copy mechanism works", async () => {
  setClipboard(undefined);
  setExecCommand(() => false);

  await expect(copyToClipboard("hello")).resolves.toBe(false);
});
