import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "docker compose up --build",
    url: "http://localhost:3000/api/books",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
