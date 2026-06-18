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
