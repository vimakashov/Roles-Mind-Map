import type { Gender } from "../types.js";
import { ageStage } from "./ageStage.js";

export type AvatarKey = `${Gender}-${ReturnType<typeof ageStage>}`;

export function avatarKey(gender: Gender, age: number | null | undefined): AvatarKey {
  return `${gender}-${ageStage(age)}` as AvatarKey;
}
