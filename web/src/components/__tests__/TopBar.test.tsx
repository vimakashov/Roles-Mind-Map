import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TopBar } from "../TopBar.js";

describe("TopBar", () => {
  it("shows the provided title", () => {
    render(<TopBar title="Война и мир" />);
    expect(screen.getByText("Война и мир")).toBeInTheDocument();
  });

  it("falls back to the app name when title is absent", () => {
    render(<TopBar />);
    expect(screen.getByText("Roles Mind Map")).toBeInTheDocument();
  });

  it("falls back to the app name when title is empty", () => {
    render(<TopBar title="" />);
    expect(screen.getByText("Roles Mind Map")).toBeInTheDocument();
  });
});
