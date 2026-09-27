import { describe, expect, it } from "vitest";
import type { Piece } from "@/types/game";
import { getBoardLayout, getViewerTrackLabel, projectPiece } from "@/lib/board-layouts";

function isStrictlyInsideTriangle(
  point: { x: number; y: number },
  triangle: readonly { x: number; y: number }[],
): boolean {
  const [a, b, c] = triangle;
  if (!a || !b || !c) return false;
  const crosses = [
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x),
    (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x),
    (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x),
  ];
  return crosses.every((cross) => cross > 0.001) || crosses.every((cross) => cross < -0.001);
}

describe("board layout projection", () => {
  it.each([4, 5, 6] as const)("restarts numbering at 5 for every viewer seat on a %i-player board", (seatCount) => {
    const length = seatCount * 17;
    for (let seat = 0; seat < seatCount; seat += 1) {
      const start = seat * 17;
      expect(getViewerTrackLabel(start, seat, seatCount)).toBe(5);
      expect(getViewerTrackLabel((start - 4 + length) % length, seat, seatCount)).toBe(1);
      expect(getViewerTrackLabel((start - 1 + length) % length, seat, seatCount)).toBe(4);
      expect(new Set(Array.from({ length }, (_, index) => getViewerTrackLabel(index, seat, seatCount))).size).toBe(length);
    }
  });
  it.each([
    {
      seats: 4,
      length: 68,
      starts: [0, 17, 34, 51],
      entries: [63, 12, 29, 46],
      safe: [0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63],
    },
    {
      seats: 5,
      length: 85,
      starts: [0, 17, 34, 51, 68],
      entries: [80, 12, 29, 46, 63],
      safe: [0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63, 68, 75, 80],
    },
    {
      seats: 6,
      length: 102,
      starts: [0, 17, 34, 51, 68, 85],
      entries: [97, 12, 29, 46, 63, 80],
      safe: [0, 7, 12, 17, 24, 29, 34, 41, 46, 51, 58, 63, 68, 75, 80, 85, 92, 97],
    },
  ] as const)("maps the $seats-seat domain indices without collisions", ({ seats, length, starts, entries, safe }) => {
    const layout = getBoardLayout(seats);

    expect(layout.trackCells).toHaveLength(length);
    expect(new Set(layout.trackCells.map(({ x, y }) => `${x},${y}`)).size).toBe(length);
    expect(layout.trackCellPolygons).toHaveLength(length);
    expect(layout.trackCellPolygons.every((polygon) => polygon.length === 4)).toBe(true);
    expect(layout.trackCellLabels).toHaveLength(length);
    expect([...layout.trackCellLabels].sort((a, b) => a - b)).toEqual(
      Array.from({ length }, (_, index) => index + 1),
    );
    expect(layout.startCellIndicesBySeat).toEqual(starts);
    expect(layout.goalEntryCellIndicesBySeat).toEqual(entries);
    expect([...layout.safeCellIndices].sort((a, b) => a - b)).toEqual(safe);
    expect(layout.finishPathsBySeat).toHaveLength(seats);
    expect(layout.finishPathsBySeat.every((path) => path.length === 7)).toBe(true);
    expect(layout.finishPathCellPolygonsBySeat).toHaveLength(seats);
    expect(
      layout.finishPathCellPolygonsBySeat.every((path) =>
        path.length === 7 && path.every((cell) => cell.length === 4),
      ),
    ).toBe(true);
    expect(layout.goalWedgesBySeat).toHaveLength(seats);
    expect(layout.goalWedgesBySeat.every((wedge) => wedge.length === 3)).toBe(true);
    expect(layout.trackCellAngles).toHaveLength(length);
    expect(layout.homeCentersBySeat).toHaveLength(seats);
    expect(layout.homeSlotsBySeat).toHaveLength(seats);
    expect(layout.homeSlotsBySeat.every((slots) => slots.length === 4)).toBe(true);
    expect(
      [
        ...layout.trackCells,
        ...layout.trackCellPolygons.flat(),
        ...layout.homeCentersBySeat,
        ...layout.homeSlotsBySeat.flat(),
        ...layout.finishPathsBySeat.flat(),
        ...layout.finishPathCellPolygonsBySeat.flat(2),
        ...layout.goalWedgesBySeat.flat(),
        layout.goal,
      ]
        .every(({ x, y }) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000),
    ).toBe(true);
    for (const slots of layout.homeSlotsBySeat) {
      const center = slots.reduce(
        (sum, point) => ({ x: sum.x + point.x / slots.length, y: sum.y + point.y / slots.length }),
        { x: 0, y: 0 },
      );
      expect(center.x - 58).toBeGreaterThanOrEqual(26);
      expect(center.x + 58).toBeLessThanOrEqual(974);
      expect(center.y - 58).toBeGreaterThanOrEqual(26);
      expect(center.y + 58).toBeLessThanOrEqual(974);
    }
  });

  it("follows the photographed four-arm path from one flank through the tip and back", () => {
    const layout = getBoardLayout(4);

    expect([0, 7, 12, 17, 29, 34, 46, 51, 63].map((index) => layout.trackCellLabels[index]))
      .toEqual([5, 12, 17, 22, 34, 39, 51, 56, 68]);
    expect(layout.trackCells[0]?.x).toBeGreaterThan(500);
    expect(layout.trackCells[0]?.y).toBeGreaterThan(500);
    expect(layout.trackCells[3]?.y).toBeLessThan(layout.trackCells[0]?.y ?? 0);
    expect(layout.trackCells[11]?.x).toBeGreaterThan(layout.trackCells[4]?.x ?? 0);
    expect(layout.trackCells[12]?.y).toBeCloseTo(500, 1);
    expect(layout.trackCells[63]?.x).toBeCloseTo(500, 1);
    expect(layout.trackCells[63]?.y).toBeGreaterThan(500);
    expect(layout.homeCentersBySeat[0]?.x).toBeGreaterThan(500);
    expect(layout.homeCentersBySeat[0]?.y).toBeGreaterThan(500);
    expect(layout.homeCentersBySeat[1]?.x).toBeGreaterThan(500);
    expect(layout.homeCentersBySeat[1]?.y).toBeLessThan(500);
    expect(layout.homeCentersBySeat[2]?.x).toBeLessThan(500);
    expect(layout.homeCentersBySeat[2]?.y).toBeLessThan(500);
    expect(layout.homeCentersBySeat[3]?.x).toBeLessThan(500);
    expect(layout.homeCentersBySeat[3]?.y).toBeGreaterThan(500);
  });

  it("keeps the classic four-player finish lane straight until it meets the center", () => {
    const layout = getBoardLayout(4);

    for (const connector of layout.finishLaneConnectorsBySeat) {
      const [outerLeft, outerRight, innerRight, innerLeft] = connector;
      if (!outerLeft || !outerRight || !innerRight || !innerLeft) {
        throw new Error("The finish lane connector is incomplete");
      }
      expect(Math.hypot(outerRight.x - outerLeft.x, outerRight.y - outerLeft.y))
        .toBeCloseTo(Math.hypot(innerRight.x - innerLeft.x, innerRight.y - innerLeft.y), 1);
    }
  });

  it.each([5, 6] as const)(
    "makes the shared route climb one flank and descend the next across %i arms",
    (seats) => {
      const layout = getBoardLayout(seats);

      for (let seat = 0; seat < seats; seat += 1) {
        const section = layout.trackCells.slice(seat * 17, (seat + 1) * 17);
        const radius = (index: number) => Math.hypot(
          (section[index]?.x ?? 500) - 500,
          (section[index]?.y ?? 500) - 500,
        );
        expect(radius(3)).toBeLessThan(radius(0));
        expect(radius(11)).toBeGreaterThan(radius(4));
        expect(radius(12)).toBeGreaterThan(radius(4));
        expect(radius(13)).toBeGreaterThan(radius(16));
      }
    },
  );

  it.each([4, 5, 6] as const)(
    "builds contiguous rectangular arrival cells and triangular center zones for %i players",
    (seats) => {
      const layout = getBoardLayout(seats);

      for (let seat = 0; seat < seats; seat += 1) {
        const cells = layout.finishPathCellPolygonsBySeat[seat];
        const centers = layout.finishPathsBySeat[seat];
        const wedge = layout.goalWedgesBySeat[seat];
        if (!cells || !centers || !wedge) throw new Error("Seat geometry is incomplete");

        expect(cells).toHaveLength(7);
        expect(wedge).toContainEqual(layout.goal);
        expect(centers[0]).not.toEqual(layout.trackCells[layout.goalEntryCellIndicesBySeat[seat] ?? -1]);
        expect(Math.hypot(
          (centers[6]?.x ?? 0) - layout.goal.x,
          (centers[6]?.y ?? 0) - layout.goal.y,
        )).toBeGreaterThan(0);
      }
    },
  );

  it.each([4, 5, 6] as const)(
    "parks finished pieces in their own goal wedge, away from the center and home slots, on a %i-seat board",
    (seats) => {
      const layout = getBoardLayout(seats);

      for (let seat = 0; seat < seats; seat += 1) {
        const playerId = `p${seat + 1}`;
        const finishedPiece: Piece = {
          id: `${playerId}-piece-1`,
          playerId,
          state: "finished",
          trackPosition: null,
          finishProgress: null,
        };
        const projected = projectPiece(finishedPiece, layout, {
          pieces: [finishedPiece],
          seatByPlayerId: new Map([[playerId, seat]]),
        });
        const ownWedge = layout.goalWedgesBySeat[seat];
        if (!ownWedge) throw new Error(`Missing goal wedge for seat ${seat}`);

        expect(isStrictlyInsideTriangle(projected, ownWedge)).toBe(true);
        expect(projected).not.toEqual(layout.goal);
        expect(layout.homeSlotsBySeat.flat()).not.toContainEqual(projected);
        expect(
          layout.goalWedgesBySeat.some(
            (wedge, otherSeat) => otherSeat !== seat && isStrictlyInsideTriangle(projected, wedge),
          ),
        ).toBe(false);
      }
    },
  );

  it.each([4, 5, 6] as const)(
    "keeps all four finished pieces visibly spaced inside the %i-seat goal wedge",
    (seats) => {
      const layout = getBoardLayout(seats);
      const pieces = Array.from({ length: 4 }, (_, index): Piece => ({
        id: `p1-piece-${index + 1}`,
        playerId: "p1",
        state: "finished",
        trackPosition: null,
        finishProgress: null,
      }));
      const occupancy = { pieces, seatByPlayerId: new Map([["p1", 0]]) };
      const points = pieces.map((piece) => projectPiece(piece, layout, occupancy));
      const distances = points.flatMap((point, index) =>
        points.slice(index + 1).map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
      );

      expect(points.every((point) => isStrictlyInsideTriangle(point, layout.goalWedgesBySeat[0] ?? []))).toBe(true);
      expect(Math.min(...distances)).toBeGreaterThanOrEqual(46);
    },
  );

  it("keeps distinct finished-piece slots fixed by piece identity as more pieces finish", () => {
    const layout = getBoardLayout(4);
    const firstPiece: Piece = {
      id: "p1-piece-1",
      playerId: "p1",
      state: "finished",
      trackPosition: null,
      finishProgress: null,
    };
    const secondPiece: Piece = { ...firstPiece, id: "p1-piece-2" };
    const seatByPlayerId = new Map([["p1", 0]]);
    const firstAlone = projectPiece(firstPiece, layout, {
      pieces: [firstPiece],
      seatByPlayerId,
    });
    const secondAlone = projectPiece(secondPiece, layout, {
      pieces: [secondPiece],
      seatByPlayerId,
    });
    const bothPieces = [firstPiece, secondPiece];

    expect(firstAlone).not.toEqual(secondAlone);
    expect(projectPiece(firstPiece, layout, { pieces: bothPieces, seatByPlayerId })).toEqual(firstAlone);
    expect(projectPiece(secondPiece, layout, { pieces: bothPieces, seatByPlayerId })).toEqual(secondAlone);
    expect(
      projectPiece(firstPiece, layout, { pieces: [...bothPieces].reverse(), seatByPlayerId }),
    ).toEqual(firstAlone);
  });

  it("projects logical locations through the owning seat and fans out shared occupancy stably", () => {
    const layout = getBoardLayout(4);
    const trackPiece: Piece = {
      id: "p2-piece-1",
      playerId: "p2",
      state: "track",
      trackPosition: 17,
      finishProgress: null,
    };
    const occupancy = {
      pieces: [trackPiece],
      seatByPlayerId: new Map([["p2", 1]]),
    };

    expect(projectPiece(trackPiece, layout, occupancy)).toEqual(layout.trackCells[17]);

    const lanePiece: Piece = {
      ...trackPiece,
      id: "p2-piece-2",
      state: "finish_path",
      trackPosition: null,
      finishProgress: 4,
    };
    expect(projectPiece(lanePiece, layout, occupancy)).toEqual(layout.finishPathsBySeat[1][4]);

    const homePiece: Piece = {
      ...trackPiece,
      id: "p2-piece-3",
      state: "yard",
      trackPosition: null,
      finishProgress: null,
    };
    const withHome = {
      pieces: [homePiece],
      seatByPlayerId: occupancy.seatByPlayerId,
    };
    expect(projectPiece(homePiece, layout, withHome)).toEqual(layout.homeSlotsBySeat[1][0]);

    const anotherTrackPiece = { ...trackPiece, id: "p3-piece-1", playerId: "p3" };
    const sharedCell = {
      pieces: [trackPiece, anotherTrackPiece],
      seatByPlayerId: new Map([
        ["p2", 1],
        ["p3", 2],
      ]),
    };
    expect(projectPiece(trackPiece, layout, sharedCell)).not.toEqual(
      projectPiece(anotherTrackPiece, layout, sharedCell),
    );
    expect(projectPiece(trackPiece, layout, sharedCell)).toEqual(
      projectPiece(trackPiece, layout, sharedCell),
    );

    const finishedPiece: Piece = {
      ...trackPiece,
      state: "finished",
      trackPosition: null,
      finishProgress: null,
    };
    const projectedFinished = projectPiece(finishedPiece, layout, occupancy);
    expect(projectedFinished).not.toEqual(layout.goal);
    expect(isStrictlyInsideTriangle(projectedFinished, layout.goalWedgesBySeat[1] ?? [])).toBe(true);
  });
});
