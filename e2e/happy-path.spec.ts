import { test, expect } from "@playwright/test";

test("create book, add character, see node on canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /добавить книгу/i }).click();
  await page.getByLabel(/название/i).fill("Война и мир");
  await page.getByRole("button", { name: /^добавить$/i }).click();

  await page.getByText(/Война и мир/).click();

  await page.getByRole("button", { name: /добавить персонажа/i }).click();
  await page.getByLabel(/пол/i).click();
  await page.getByRole("option", { name: /мужчина/i }).click();
  await page.getByLabel(/имя/i).fill("Вася");
  await page.getByLabel(/фамилия/i).fill("Петров");
  await page.getByRole("button", { name: /^добавить$/i }).click();

  // Canvas appears (a <canvas> element rendered by cytoscape) and FAB is present.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByLabel(/добавить персонажа/i)).toBeVisible();
});
