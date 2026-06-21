import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { avatarSvgMarkup, deceasedOverlaySvg } from "../lib/avatarSvg.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
  src?: string | null;
  deceased?: boolean;
}

export function Avatar({ gender, age, size = 56, src, deceased }: Props) {
  const inner = src ? (
    <img
      data-testid="avatar-img"
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <span
      data-testid="avatar"
      data-avatar={avatarKey(gender, age)}
      aria-label={avatarKey(gender, age)}
      style={{ display: "block", width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: avatarSvgMarkup(gender, age) }}
    />
  );

  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, lineHeight: 0 }}>
      {inner}
      {deceased && (
        <span
          data-testid="avatar-deceased"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, lineHeight: 0 }}
          dangerouslySetInnerHTML={{ __html: deceasedOverlaySvg() }}
        />
      )}
    </span>
  );
}
