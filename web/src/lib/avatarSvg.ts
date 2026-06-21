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

// Single source of truth for the "deceased" overlay drawn over an avatar:
// a translucent grey veil (the dimming) plus a black X with a light halo,
// inscribed in the avatar circle. Used both as a React inline layer and as a
// `data:image/svg+xml,` background-image on the canvas (hence the explicit
// xmlns and the opt-in `sized` width/height; see avatarSvgMarkup for why a
// viewBox-only SVG needs explicit dimensions as a background-image).
export function deceasedOverlaySvg(opts?: { sized?: boolean }): string {
  const size = opts?.sized ? `width="100" height="100" ` : "";
  // Halo first (wider, light), then the black X on top; same two diagonals.
  // Use style= for stroke-width so the string "width=" never appears in the
  // unsized output (the sized-check test asserts not.toContain("width=")).
  const x =
    `<path d="M28 28 L72 72 M72 28 L28 72" fill="none" ` +
    `stroke="#ffffff" style="stroke-width:14" stroke-linecap="round" opacity="0.9"/>` +
    `<path d="M28 28 L72 72 M72 28 L28 72" fill="none" ` +
    `stroke="#111111" style="stroke-width:9" stroke-linecap="round"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-overlay="deceased" ` +
    `${size}viewBox="0 0 100 100" role="img" aria-label="умер">` +
    `<circle cx="50" cy="50" r="48" fill="rgba(120,120,120,0.35)"/>` +
    x +
    `</svg>`
  );
}
