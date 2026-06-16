import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { ageStage } from "../lib/ageStage.js";
import { GENDER_COLORS } from "../theme.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
}

export function Avatar({ gender, age, size = 56 }: Props) {
  const key = avatarKey(gender, age);
  const fill = GENDER_COLORS[gender];
  const light = gender === "male" ? "#eaf0f7" : "#fbeef3";
  // Slightly smaller head for child/teen for a schematic age cue.
  const stage = ageStage(age);
  const headR = stage === "child" ? 0.18 : stage === "teen" ? 0.2 : 0.22;

  return (
    <svg
      data-testid="avatar"
      data-avatar={key}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={key}
    >
      <circle cx="50" cy="50" r="48" fill={fill} />
      <circle cx="50" cy={50 - 6} r={headR * 100} fill={light} />
      <path d={`M30 ${78} a20 16 0 0 1 40 0 Z`} fill={light} />
    </svg>
  );
}
