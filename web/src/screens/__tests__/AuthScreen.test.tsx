import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { AuthScreen } from "../AuthScreen.js";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";

beforeEach(() => __resetBackStack());

test("register mode is the default and shows both register-mode buttons", () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  expect(screen.getByRole("button", { name: /^зарегистрироваться$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /уже есть аккаунт/i })).toBeInTheDocument();
});

test("«Уже есть аккаунт» switches to login mode keeping field values", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.click(screen.getByRole("button", { name: /уже есть аккаунт/i }));
  expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /забыли пароль/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/логин/i)).toHaveValue("tester");
});

test("«Забыли пароль?» opens the contact modal with the site link", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /уже есть аккаунт/i }));
  await userEvent.click(screen.getByRole("button", { name: /забыли пароль/i }));
  expect(screen.getByText(/обратитесь к администратору сайта/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /mkv\.qa/i })).toHaveAttribute("href", "https://mkv.qa/");
});

test("shows a validation error for a too-short nickname", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "ab");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(await screen.findByText(/минимум 3 символа/i)).toBeInTheDocument();
});

test("successful register calls onAuthenticated", async () => {
  const onAuthenticated = vi.fn();
  vi.spyOn(api, "register").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", name: "tester" });
});

test("a 409 from register shows the nickname-taken error", async () => {
  vi.spyOn(api, "register").mockRejectedValue(new Error("POST /api/auth/register -> 409"));
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(await screen.findByText(/никнейм занят/i)).toBeInTheDocument();
});
