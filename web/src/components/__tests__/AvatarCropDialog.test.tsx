import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AvatarCropDialog } from "../AvatarCropDialog.js";

// react-easy-crop needs layout APIs jsdom lacks; stub it to a noop.
vi.mock("react-easy-crop", () => ({ default: () => <div data-testid="cropper" /> }));

const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

test("renders the crop dialog and Cancel calls onCancel", async () => {
  const onCancel = vi.fn();
  render(<AvatarCropDialog open file={file} onCancel={onCancel} onSave={() => {}} />);
  expect(screen.getByTestId("cropper")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /отмена/i }));
  expect(onCancel).toHaveBeenCalled();
});

import { __resetBackStack } from "../../lib/backStack.js";

test("Back button cancels the crop dialog", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  const file = new File(["x"], "a.png", { type: "image/png" });
  render(<AvatarCropDialog open file={file} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
