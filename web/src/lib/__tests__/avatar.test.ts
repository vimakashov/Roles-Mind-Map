import { describe, expect, test } from "vitest";
import { ageStage } from "../ageStage.js";
import { avatarKey } from "../avatar.js";

describe("ageStage", () => {
  test("buckets", () => {
    expect(ageStage(5)).toBe("child");
    expect(ageStage(10)).toBe("child");
    expect(ageStage(11)).toBe("teen");
    expect(ageStage(17)).toBe("teen");
    expect(ageStage(18)).toBe("adult");
    expect(ageStage(50)).toBe("adult");
    expect(ageStage(51)).toBe("old");
    expect(ageStage(99)).toBe("old");
  });
  test("missing age defaults to adult", () => {
    expect(ageStage(null)).toBe("adult");
    expect(ageStage(undefined)).toBe("adult");
  });
});

describe("avatarKey", () => {
  test("combines gender and stage", () => {
    expect(avatarKey("male", 8)).toBe("male-child");
    expect(avatarKey("female", null)).toBe("female-adult");
    expect(avatarKey("female", 70)).toBe("female-old");
  });
});
