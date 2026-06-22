// Spacing applies to auto-layout only; stored posX/posY live in the original
// LAYOUT_BASELINE (3×) space and are scaled to display by POSITION_SCALE.
export const SPACING_FACTOR = 5;
export const LAYOUT_BASELINE = 3;
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE; // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;

// Connection-based scaling: a character's node grows with its number of
// relationships (degree). scale = 1 + 0.5·degree, capped at MAX_SCALE.
export const SCALE_PER_EDGE = 0.5;
export const MAX_SCALE = 3.0;
export const BASE_NODE_SIZE = 46;
export const BASE_FONT_SIZE = 11;

export function scaleForDegree(degree: number): number {
  return Math.min(1 + SCALE_PER_EDGE * degree, MAX_SCALE);
}

// Preferred cola edge length: base distance scaled by the average of the two
// endpoints' scales (softer than max — keeps a hub's neighbourhood compact).
export function edgeLengthForScales(scaleA: number, scaleB: number): number {
  return (BASE_EDGE_LENGTH * SPACING_FACTOR * (scaleA + scaleB)) / 2;
}
