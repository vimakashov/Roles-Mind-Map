import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { avatarSvgMarkup } from "../lib/avatarSvg.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
}

export function Avatar({ gender, age, size = 56 }: Props) {
  return (
    <span
      data-testid="avatar"
      data-avatar={avatarKey(gender, age)}
      aria-label={avatarKey(gender, age)}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: avatarSvgMarkup(gender, age) }}
    />
  );
}
