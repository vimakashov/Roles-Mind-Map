import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { AuthScreen } from "../AuthScreen.js";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";

beforeEach(() => __resetBackStack());

test("shows only login + forgot-password buttons, no registration UI", () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /забыли пароль/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /зарегистрироваться/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /уже есть аккаунт/i })).not.toBeInTheDocument();
});

test("«Забыли пароль?» opens the contact modal with the site link", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /забыли пароль/i }));
  expect(screen.getByText(/обратитесь к администратору сайта/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /mkv\.qa/i })).toHaveAttribute("href", "https://mkv.qa/");
});

test("shows a validation error for a too-short nickname", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "ab");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(await screen.findByText(/минимум 3 символа/i)).toBeInTheDocument();
});

test("successful login calls onAuthenticated", async () => {
  const onAuthenticated = vi.fn();
  vi.spyOn(api, "login").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", name: "tester" });
});

test("a 401 from login shows the invalid-credentials error", async () => {
  vi.spyOn(api, "login").mockRejectedValue(new Error("POST /api/auth/login -> 401"));
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(await screen.findByText(/неверный логин или пароль/i)).toBeInTheDocument();
});
