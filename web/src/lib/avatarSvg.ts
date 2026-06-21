import type { Gender } from "../types.js";
import { avatarKey } from "./avatar.js";
import { ageStage } from "./ageStage.js";
import { GENDER_COLORS } from "../theme.js";

// Single source of truth for the schematic character silhouette.
// Returns a standalone SVG string usable both as React innerHTML and as a
// `data:image/svg+xml,` URI (hence the explicit xmlns).
//
// `sized` adds explicit pixel width/height matching the viewBox. Omit it for
// inline React use (the outer-svg `width`/`height` default to 100%, so the SVG
// fills its sized span). Set it for the `data:image/svg+xml,` background-image
// on the canvas: a viewBox-only SVG has no resolvable intrinsic size, so
// `background-fit: cover` mis-positions the silhouette on browsers that don't
// fall back to the viewBox (notably Chrome on Android) — explicit dimensions
// make the intrinsic size deterministic.
export function avatarSvgMarkup(
  gender: Gender,
  age: number | null | undefined,
  opts?: { sized?: boolean },
): string {
  const key = avatarKey(gender, age);
  const fill = GENDER_COLORS[gender];
  const light = gender === "male" ? "#eaf0f7" : "#fbeef3";
  // Slightly smaller head for child/teen for a schematic age cue.
  const stage = ageStage(age);
  const headR = stage === "child" ? 18 : stage === "teen" ? 20 : 22;
  const size = opts?.sized ? `width="100" height="100" ` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-avatar="${key}" ` +
    `${size}viewBox="0 0 100 100" role="img" aria-label="${key}">` +
    `<circle cx="50" cy="50" r="48" fill="${fill}"/>` +
    `<circle cx="50" cy="44" r="${headR}" fill="${light}"/>` +
    `<path d="M30 78 a20 16 0 0 1 40 0 Z" fill="${light}"/>` +
    `</svg>`
  );
}
