// Spacing applies to auto-layout only; stored posX/posY live in the original
// LAYOUT_BASELINE (3×) space and are scaled to display by POSITION_SCALE.
export const SPACING_FACTOR = 5;
export const LAYOUT_BASELINE = 3;
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE; // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;
