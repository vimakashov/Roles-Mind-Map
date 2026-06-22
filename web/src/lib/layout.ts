// Spacing applies to auto-layout only; stored posX/posY live in the original
// LAYOUT_BASELINE (3×) space and are scaled to display by POSITION_SCALE.
export const SPACING_FACTOR = 5;
export const LAYOUT_BASELINE = 3;
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE; // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;

// Connection-based scaling: a character's node grows with its number of
// relationships (degree). scale = 1 + SCALE_PER_EDGE·degree — uncapped, so a
// well-connected character keeps growing.
export const SCALE_PER_EDGE = 0.5;
export const BASE_NODE_SIZE = 46;
export const BASE_FONT_SIZE = 11;

export function scaleForDegree(degree: number): number {
  return 1 + SCALE_PER_EDGE * degree;
}

// Edge length grows far more gently than the avatar (EDGE_SCALE_PER_EDGE 0.1 vs
// SCALE_PER_EDGE 0.5), so a hub's lines don't stretch in step with its node.
export const EDGE_SCALE_PER_EDGE = 0.1;

export function edgeScaleForDegree(degree: number): number {
  return 1 + EDGE_SCALE_PER_EDGE * degree;
}

// Preferred cola edge length: base distance scaled by the average of the two
// endpoints' edge-scales (softer than max — keeps a hub's neighbourhood compact).
export function edgeLengthForScales(scaleA: number, scaleB: number): number {
  return (BASE_EDGE_LENGTH * SPACING_FACTOR * (scaleA + scaleB)) / 2;
}

// Extra clearance (px) added on top of both endpoints' node sizes so a big
// hub's avatar+label sits clear of its neighbours. cola's overlap avoidance
// (with nodeDimensionsIncludeLabels) is the hard no-overlap guarantee; this
// floor gives big nodes breathing room so they read as centred hubs.
export const EDGE_CLEARANCE = 120;

// Preferred cola edge length for an edge between two nodes. Small nodes keep
// the gentle edge-scale length; once a node grows, the geometric floor
// (both node sizes + clearance) takes over so its links stretch enough that
// neither its avatar nor its name overlaps the node at the other end.
export function edgeLengthForNodes(
  nodeScaleA: number,
  nodeScaleB: number,
  edgeScaleA: number,
  edgeScaleB: number,
): number {
  const gentle = edgeLengthForScales(edgeScaleA, edgeScaleB);
  const geometric = BASE_NODE_SIZE * (nodeScaleA + nodeScaleB) + EDGE_CLEARANCE;
  return Math.max(gentle, geometric);
}
