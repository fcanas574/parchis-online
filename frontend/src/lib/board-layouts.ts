import type { Piece } from "@/types/game";

export type Point = Readonly<{ x: number; y: number }>;
export type SeatCount = 4 | 5 | 6;
export type Polygon = readonly Point[];

export type BoardLayout = Readonly<{
  viewBox: "0 0 1000 1000";
  seatCount: SeatCount;
  trackCells: readonly Point[];
  trackCellPolygons: readonly Polygon[];
  trackCellLabels: readonly number[];
  trackCellAngles: readonly number[];
  trackCellWidth: number;
  trackCellDepth: number;
  numberFontSize: number;
  startCellIndicesBySeat: readonly number[];
  goalEntryCellIndicesBySeat: readonly number[];
  safeCellIndices: readonly number[];
  homeCentersBySeat: readonly Point[];
  homeSlotsBySeat: readonly (readonly Point[])[];
  finishPathsBySeat: readonly (readonly Point[])[];
  finishPathCellPolygonsBySeat: readonly (readonly Polygon[])[];
  finishLaneConnectorsBySeat: readonly Polygon[];
  shoulderLinesBySeat: readonly (readonly [Point, Point])[];
  goalWedgesBySeat: readonly Polygon[];
  goal: Point;
}>;

export type BoardOccupancy = Readonly<{
  pieces: readonly Piece[];
  seatByPlayerId: ReadonlyMap<string, number>;
}>;

const VIEW_BOX = "0 0 1000 1000" as const;
const CENTER: Point = { x: 500, y: 500 };
const TRACK_CELLS_PER_SEAT = 17;
const FINISH_PATH_LENGTH = 7;
const FINISHED_SLOTS_PER_PLAYER = 4;

function roundedPoint(x: number, y: number): Point {
  return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
}

type ArmGeometry = Readonly<{
  angle: number;
  innerRadius: number;
  outerRadius: number;
  innerHalfWidth: number;
  outerHalfWidth: number;
  goalRadius: number;
}>;

function makeArms(seatCount: SeatCount): readonly ArmGeometry[] {
  const profile =
    seatCount === 4
      ? { innerRadius: 160, outerRadius: 450, outerHalfWidth: 150, goalRadius: 110 }
      : seatCount === 5
        ? { innerRadius: 175, outerRadius: 455, outerHalfWidth: 134, goalRadius: 142 }
        : { innerRadius: 170, outerRadius: 455, outerHalfWidth: 124, goalRadius: 136 };

  return Array.from({ length: seatCount }, (_, seat) => ({
    angle: Math.PI / 2 - (seat * Math.PI * 2) / seatCount,
    ...profile,
    innerHalfWidth: seatCount === 4
      ? 150
      : profile.innerRadius * Math.tan(Math.PI / seatCount),
  }));
}

function pointOnArm(arm: ArmGeometry, radius: number, tangentOffset: number): Point {
  const along = { x: Math.cos(arm.angle), y: Math.sin(arm.angle) };
  const across = { x: Math.cos(arm.angle - Math.PI / 2), y: Math.sin(arm.angle - Math.PI / 2) };
  return roundedPoint(
    CENTER.x + along.x * radius + across.x * tangentOffset,
    CENTER.y + along.y * radius + across.y * tangentOffset,
  );
}

function edgePoint(arm: ArmGeometry, radius: number, laneEdge: number): Point {
  const ratio = (radius - arm.innerRadius) / (arm.outerRadius - arm.innerRadius);
  const halfWidth = arm.innerHalfWidth + (arm.outerHalfWidth - arm.innerHalfWidth) * ratio;
  return pointOnArm(arm, radius, (laneEdge / 1.5) * halfWidth);
}

function armCellPolygon(arm: ArmGeometry, row: number, column: -1 | 0 | 1): Polygon {
  const rowLength = (arm.outerRadius - arm.innerRadius) / 8;
  const outer = arm.outerRadius - row * rowLength;
  const inner = outer - rowLength;
  return [
    edgePoint(arm, outer, column - 0.5),
    edgePoint(arm, outer, column + 0.5),
    edgePoint(arm, inner, column + 0.5),
    edgePoint(arm, inner, column - 0.5),
  ];
}

function polygonCenter(polygon: Polygon): Point {
  return roundedPoint(
    polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  );
}

type TrackGeometry = Readonly<{
  points: readonly Point[];
  polygons: readonly Polygon[];
  labels: readonly number[];
  angles: readonly number[];
}>;

function makeTrackGeometry(arms: readonly ArmGeometry[]): TrackGeometry {
  const trackLength = arms.length * TRACK_CELLS_PER_SEAT;
  const points: Point[] = Array.from({ length: trackLength }, () => CENTER);
  const polygons: Polygon[] = Array.from({ length: trackLength }, () => []);
  const labels: number[] = Array.from({ length: trackLength }, () => 0);
  const angles: number[] = Array.from({ length: trackLength }, () => 0);

  function place(label: number, polygon: Polygon, angle: number): void {
    const index = (label - 5 + trackLength) % trackLength;
    points[index] = polygonCenter(polygon);
    polygons[index] = polygon;
    labels[index] = label;
    angles[index] = Number(((angle * 180) / Math.PI).toFixed(3));
  }

  for (const [seat, arm] of arms.entries()) {
    const tip = seat * TRACK_CELLS_PER_SEAT;
    place(tip || trackLength, armCellPolygon(arm, 0, 0), arm.angle);

    for (let row = 0; row < 8; row += 1) {
      const outwardToInwardLabel = ((tip + row) % trackLength) + 1;
      const inwardToOutwardLabel = ((tip - row - 2 + trackLength * 2) % trackLength) + 1;
      place(outwardToInwardLabel, armCellPolygon(arm, row, 1), arm.angle);
      place(inwardToOutwardLabel, armCellPolygon(arm, row, -1), arm.angle);
    }
  }

  return { points, polygons, labels, angles };
}

function makeHomeCenters(arms: readonly ArmGeometry[]): readonly Point[] {
  const seatCount = arms.length;
  const distance = seatCount === 4 ? 470 : 390;
  return arms.map((arm) =>
    roundedPoint(
      CENTER.x + Math.cos(arm.angle - Math.PI / seatCount) * distance,
      CENTER.y + Math.sin(arm.angle - Math.PI / seatCount) * distance,
    ),
  );
}

function makeHomeSlots(
  homeCentersBySeat: readonly Point[],
  seatCount: SeatCount,
): readonly (readonly Point[])[] {
  return homeCentersBySeat.map((center) => {
    const radialLength = Math.hypot(center.x - CENTER.x, center.y - CENTER.y);
    const radial = { x: (center.x - CENTER.x) / radialLength, y: (center.y - CENTER.y) / radialLength };
    const tangent = { x: -radial.y, y: radial.x };

    if (seatCount === 5) {
      return [-48, -16, 16, 48].map((offset) =>
        roundedPoint(center.x + tangent.x * offset, center.y + tangent.y * offset),
      );
    }

    const spread = seatCount === 4 ? 43 : 30;
    return [-1, 1].flatMap((radialSide) =>
      [-1, 1].map((tangentSide) =>
        roundedPoint(
          center.x + radial.x * radialSide * spread + tangent.x * tangentSide * spread,
          center.y + radial.y * radialSide * spread + tangent.y * tangentSide * spread,
        ),
      ),
    );
  });
}

type FinishGeometry = Readonly<{
  centersBySeat: readonly (readonly Point[])[];
  cellsBySeat: readonly (readonly Polygon[])[];
  connectorsBySeat: readonly Polygon[];
  shoulderLinesBySeat: readonly (readonly [Point, Point])[];
  wedgesBySeat: readonly Polygon[];
}>;

function makeFinishGeometry(
  arms: readonly ArmGeometry[],
): FinishGeometry {
  const seatCount = arms.length;
  const centersBySeat: Point[][] = [];
  const cellsBySeat: Polygon[][] = [];
  const connectorsBySeat: Polygon[] = [];
  const shoulderLinesBySeat: [Point, Point][] = [];
  const wedgesBySeat: Polygon[] = [];

  for (const arm of arms) {
    const cells = Array.from({ length: FINISH_PATH_LENGTH }, (_, progress) =>
      armCellPolygon(arm, progress + 1, 0),
    );
    cellsBySeat.push(cells);
    centersBySeat.push(cells.map(polygonCenter));

    const goalHalfWidth = arm.goalRadius * Math.tan(Math.PI / seatCount);
    const connectorHalfWidth = seatCount === 4 ? arm.innerHalfWidth / 3 : goalHalfWidth / 3;
    const goalLeft = pointOnArm(arm, arm.goalRadius, -goalHalfWidth);
    const goalRight = pointOnArm(arm, arm.goalRadius, goalHalfWidth);
    connectorsBySeat.push([
      edgePoint(arm, arm.innerRadius, -0.5),
      edgePoint(arm, arm.innerRadius, 0.5),
      pointOnArm(arm, arm.goalRadius, connectorHalfWidth),
      pointOnArm(arm, arm.goalRadius, -connectorHalfWidth),
    ]);
    shoulderLinesBySeat.push(
      [edgePoint(arm, arm.innerRadius, -1.5), goalLeft],
      [edgePoint(arm, arm.innerRadius, 1.5), goalRight],
    );
    wedgesBySeat.push([CENTER, goalLeft, goalRight]);
  }

  return { centersBySeat, cellsBySeat, connectorsBySeat, shoulderLinesBySeat, wedgesBySeat };
}

function buildLayout(seatCount: SeatCount): BoardLayout {
  const arms = makeArms(seatCount);
  const track = makeTrackGeometry(arms);
  const trackLength = TRACK_CELLS_PER_SEAT * seatCount;
  const startCellIndicesBySeat = Array.from(
    { length: seatCount },
    (_, seat) => seat * TRACK_CELLS_PER_SEAT,
  );
  const goalEntryCellIndicesBySeat = startCellIndicesBySeat.map(
    (startIndex) => (startIndex - 5 + trackLength) % trackLength,
  );
  const homeCentersBySeat = makeHomeCenters(arms);
  const finishGeometry = makeFinishGeometry(arms);

  return {
    viewBox: VIEW_BOX,
    seatCount,
    trackCells: track.points,
    trackCellPolygons: track.polygons,
    trackCellLabels: track.labels,
    trackCellAngles: track.angles,
    trackCellWidth: Number(((arms[0]?.innerHalfWidth ?? 150) * 2 / 3).toFixed(2)),
    trackCellDepth: Number((((arms[0]?.outerRadius ?? 450) - (arms[0]?.innerRadius ?? 160)) / 8).toFixed(2)),
    numberFontSize: 30,
    startCellIndicesBySeat,
    goalEntryCellIndicesBySeat,
    safeCellIndices: startCellIndicesBySeat.flatMap((startIndex) => [
      startIndex,
      (startIndex + 7) % trackLength,
      (startIndex - 5 + trackLength) % trackLength,
    ]),
    homeCentersBySeat,
    homeSlotsBySeat: makeHomeSlots(homeCentersBySeat, seatCount),
    finishPathsBySeat: finishGeometry.centersBySeat,
    finishPathCellPolygonsBySeat: finishGeometry.cellsBySeat,
    finishLaneConnectorsBySeat: finishGeometry.connectorsBySeat,
    shoulderLinesBySeat: finishGeometry.shoulderLinesBySeat,
    goalWedgesBySeat: finishGeometry.wedgesBySeat,
    goal: CENTER,
  };
}

export function buildCrossLayout(seatCount: 4): BoardLayout {
  return buildLayout(seatCount);
}

export function buildPolygonLayout(seatCount: 5 | 6): BoardLayout {
  return buildLayout(seatCount);
}
const BOARD_LAYOUTS: Readonly<Record<SeatCount, BoardLayout>> = {
  4: buildCrossLayout(4),
  5: buildPolygonLayout(5),
  6: buildPolygonLayout(6),
};

export function getBoardLayout(seatCount: SeatCount): BoardLayout {
  const layout = BOARD_LAYOUTS[seatCount];
  if (!layout) {
    throw new RangeError("seatCount must be 4, 5, or 6");
  }
  return layout;
}

/** Printed numbers are relative to the viewer; logical cell indices never change. */
export function getViewerTrackLabel(
  trackCellIndex: number,
  viewerSeatIndex: number,
  seatCount: SeatCount,
): number {
  const length = seatCount * TRACK_CELLS_PER_SEAT;
  return ((trackCellIndex - viewerSeatIndex * TRACK_CELLS_PER_SEAT + length + 4) % length) + 1;
}

function comparePieceIds(left: Piece, right: Piece): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function finishedSlotIndex(pieceId: string): number {
  const pieceNumber = /-piece-(\d+)$/.exec(pieceId)?.[1];
  if (pieceNumber) {
    const index = Number(pieceNumber) - 1;
    if (Number.isInteger(index) && index >= 0 && index < FINISHED_SLOTS_PER_PLAYER) return index;
  }

  let hash = 2166136261;
  for (let index = 0; index < pieceId.length; index += 1) {
    hash = Math.imul(hash ^ pieceId.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % FINISHED_SLOTS_PER_PLAYER;
}

function finishedPieceSlot(
  wedge: Polygon,
  slotIndex: number,
  seatCount: SeatCount,
): Point {
  const [center, left, right] = wedge;
  if (!center || !left || !right) throw new RangeError("Finished piece does not have a valid goal wedge");

  const depthsBySeatCount: Readonly<Record<SeatCount, readonly [number, number]>> = {
    4: [0.48, 0.96],
    5: [0.5, 0.95],
    6: [0.6, 0.99],
  };
  const depth = depthsBySeatCount[seatCount][slotIndex < 2 ? 0 : 1];
  const side = slotIndex % 2 === 0 ? -1 : 1;
  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  const halfWidthX = (right.x - left.x) / 2;
  const halfWidthY = (right.y - left.y) / 2;
  const lateralOffset = depth * side * 0.5;

  return roundedPoint(
    center.x + (midX - center.x) * depth + halfWidthX * lateralOffset,
    center.y + (midY - center.y) * depth + halfWidthY * lateralOffset,
  );
}

function sameLogicalCell(piece: Piece, other: Piece): boolean {
  if (piece.state !== other.state) return false;
  if (piece.state === "yard") return piece.playerId === other.playerId;
  if (piece.state === "track") {
    return piece.trackPosition === other.trackPosition;
  }
  if (piece.state === "finish_path") {
    return (
      piece.playerId === other.playerId &&
      piece.finishProgress === other.finishProgress
    );
  }
  return true;
}

function spreadPoint(
  point: Point,
  piece: Piece,
  occupancy: BoardOccupancy,
): Point {
  const occupants = occupancy.pieces
    .filter((other) => sameLogicalCell(piece, other))
    .sort(comparePieceIds);
  if (occupants.length < 2) return point;

  const index = occupants.findIndex((other) => other.id === piece.id);
  if (index < 0) return point;

  const radius = Math.min(18, 6 + occupants.length * 1.5);
  const angle = -Math.PI / 2 + (index / occupants.length) * Math.PI * 2;
  return roundedPoint(
    point.x + Math.cos(angle) * radius,
    point.y + Math.sin(angle) * radius,
  );
}

export function projectPiece(
  piece: Piece,
  layout: BoardLayout,
  occupancy: BoardOccupancy,
): Point {
  const seatIndex = occupancy.seatByPlayerId.get(piece.playerId);

  if (seatIndex === undefined) {
    throw new RangeError(`No board seat is assigned to player ${piece.playerId}`);
  }

  switch (piece.state) {
    case "yard": {
      const seat = seatIndex as number;
      const homePieces = occupancy.pieces
        .filter((other) => other.playerId === piece.playerId && other.state === "yard")
        .sort(comparePieceIds);
      const homeIndex = homePieces.findIndex((other) => other.id === piece.id);
      const homePoint = layout.homeSlotsBySeat[seat]?.[homeIndex];
      if (!homePoint) throw new RangeError("Piece does not have a valid home slot");
      return homePoint;
    }
    case "track": {
      if (
        piece.trackPosition === null ||
        !Number.isInteger(piece.trackPosition) ||
        piece.trackPosition < 0 ||
        piece.trackPosition >= layout.trackCells.length
      ) {
        throw new RangeError("Track piece does not have a valid track position");
      }
      return spreadPoint(layout.trackCells[piece.trackPosition], piece, occupancy);
    }
    case "finish_path": {
      if (
        piece.finishProgress === null ||
        !Number.isInteger(piece.finishProgress) ||
        piece.finishProgress < 0 ||
        piece.finishProgress >= FINISH_PATH_LENGTH
      ) {
        throw new RangeError("Finish-path piece does not have a valid progress value");
      }
      return spreadPoint(
        layout.finishPathsBySeat[seatIndex as number][piece.finishProgress],
        piece,
        occupancy,
      );
    }
    case "finished": {
      const goalWedge = layout.goalWedgesBySeat[seatIndex];
      if (!goalWedge) throw new RangeError("Finished piece does not have a valid goal wedge");
      return finishedPieceSlot(goalWedge, finishedSlotIndex(piece.id), layout.seatCount);
    }
  }
}
