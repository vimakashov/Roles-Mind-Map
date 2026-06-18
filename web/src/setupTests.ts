import "@testing-library/jest-dom/vitest";

// jsdom does not implement URL.createObjectURL / revokeObjectURL
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}
