"use client";

import { MotionConfig } from "framer-motion";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  DiceIndex,
  GameState,
  MoveOption,
  Piece as PieceState,
  PlayerColor,
  PublicPlayer,
  PublicRoomState,
} from "@/types/game";
import { getBoardLayout, getViewerTrackLabel, projectPiece, type Point } from "@/lib/board-layouts";
import { Piece } from "@/components/game/Piece";
import { Button } from "@/components/ui/button";

const PLAYER_COLORS: Record<PlayerColor, string> = {
  green: "var(--color-piece-green)",
  red: "var(--color-piece-red)",
  blue: "var(--color-piece-blue)",
  yellow: "var(--color-piece-yellow)",
  purple: "var(--color-piece-purple)",
  orange: "var(--color-piece-orange)",
};

type BoardProps = {
  room: PublicRoomState;
  game: GameState;
  visualPieces?: readonly PieceState[];
  currentPlayerId: string;
  interactionEnabled?: boolean;
  onSelectPiece: (pieceId: string, diceIndices: DiceIndex[]) => void;
};

function polygonPoints(points: readonly Point[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function starPoints(center: Point, outerRadius: number, innerRadius: number): string {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return `${(center.x + Math.cos(angle) * radius).toFixed(3)},${(center.y + Math.sin(angle) * radius).toFixed(3)}`;
  }).join(" ");
}

function rosettePoints(center: Point, outerRadius: number, innerRadius: number): string {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 8;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return `${(center.x + Math.cos(angle) * radius).toFixed(3)},${(center.y + Math.sin(angle) * radius).toFixed(3)}`;
  }).join(" ");
}

function pieceMoveOptions(game: GameState): ReadonlyMap<string, MoveOption[]> {
  const optionsByPiece = new Map<string, MoveOption[]>();
  for (const option of game.availableMoves) {
    const options = optionsByPiece.get(option.pieceId) ?? [];
    options.push(option);
    optionsByPiece.set(option.pieceId, options);
  }
  return optionsByPiece;
}

function getPieceNumbers(pieces: readonly PieceState[]): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  const playerIds = [...new Set(pieces.map((piece) => piece.playerId))];
  for (const playerId of playerIds) {
    pieces
      .filter((piece) => piece.playerId === playerId)
      .forEach((piece, index) => numbers.set(piece.id, index + 1));
  }
  return numbers;
}

function seatPlayer(
  playersBySeat: ReadonlyMap<number, PublicPlayer>,
  seatIndex: number,
): PublicPlayer | undefined {
  return playersBySeat.get(seatIndex);
}

function rotateBoardPoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const x = point.x - 500;
  const y = point.y - 500;
  return {
    x: 500 + x * Math.cos(radians) - y * Math.sin(radians),
    y: 500 + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

export function Board({
  room,
  game,
  visualPieces,
  currentPlayerId,
  interactionEnabled = true,
  onSelectPiece,
}: BoardProps) {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const layout = getBoardLayout(game.seatCount);
  const playersBySeat = new Map(room.players.map((player) => [player.seatIndex, player]));
  const viewerSeat = room.players.find((player) => player.id === currentPlayerId)?.seatIndex ?? 0;
  const rotation = (viewerSeat * 360) / game.seatCount;
  const playersById = new Map(room.players.map((player) => [player.id, player]));
  const renderedPieces = visualPieces ?? game.pieces;
  const occupancy = {
    pieces: renderedPieces,
    seatByPlayerId: new Map(room.players.map((player) => [player.id, player.seatIndex])),
  };
  const movesByPiece = useMemo(
    () => pieceMoveOptions(game),
    [game.availableMoves],
  );
  const pieceNumbers = getPieceNumbers(game.pieces);
  const canPlayThisTurn = game.currentPlayerId === currentPlayerId;
  const selectedPiece = game.pieces.find((piece) => piece.id === selectedPieceId);
  const selectedPlayer = selectedPiece
    ? playersById.get(selectedPiece.playerId)
    : undefined;
  const selectedPieceNumber = selectedPiece
    ? pieceNumbers.get(selectedPiece.id)
    : undefined;
  const selectedOptions =
    interactionEnabled && canPlayThisTurn && selectedPiece?.playerId === currentPlayerId
      ? (movesByPiece.get(selectedPiece.id) ?? [])
      : [];
  const selectedVisualPiece = selectedPiece
    ? renderedPieces.find((piece) => piece.id === selectedPiece.id)
    : undefined;
  const chooserAnchor = selectedVisualPiece
    ? rotateBoardPoint(projectPiece(selectedVisualPiece, layout, occupancy), rotation)
    : undefined;

  useEffect(() => {
    if (
      selectedPieceId !== null &&
      (!interactionEnabled ||
        !canPlayThisTurn ||
        (movesByPiece.get(selectedPieceId)?.length ?? 0) < 2)
    ) {
      setSelectedPieceId(null);
    }
  }, [canPlayThisTurn, interactionEnabled, movesByPiece, selectedPieceId]);

  useEffect(() => {
    if (selectedPieceId === null) return;
    document
      .getElementById(`move-options-for-${selectedPieceId}`)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [selectedPieceId]);

  useEffect(() => {
    if (selectedPieceId === null || selectedOptions.length < 2) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const chooser = document.getElementById(`move-options-for-${selectedPieceId}`);
      const trigger = document.getElementById(`parchis-piece-${selectedPieceId}`);
      if (chooser?.contains(event.target) || trigger?.contains(event.target)) return;
      setSelectedPieceId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      document.getElementById(`parchis-piece-${selectedPieceId}`)?.focus();
      setSelectedPieceId(null);
    };
    const closeOnScroll = () => setSelectedPieceId(null);

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [selectedOptions.length, selectedPieceId]);

  const handlePieceSelect = (pieceId: string) => {
    const options = movesByPiece.get(pieceId) ?? [];
    if (options.length === 1) {
      setSelectedPieceId(null);
      const [option] = options;
      if (option) onSelectPiece(pieceId, [...option.diceIndices]);
      return;
    }
    setSelectedPieceId((selected) => (selected === pieceId ? null : pieceId));
  };

  const chooseMove = (option: MoveOption) => {
    if (!selectedPiece) return;
    document.getElementById(`parchis-piece-${selectedPiece.id}`)?.focus();
    setSelectedPieceId(null);
    onSelectPiece(selectedPiece.id, [...option.diceIndices]);
  };

  const boardStyle = {
    position: "relative",
    width: "min(100%, 48rem)",
    aspectRatio: "1",
    marginInline: "auto",
    containerType: "inline-size",
  } satisfies CSSProperties;

  return (
    <>
    <div
      role="group"
      aria-label={`Tablero de Parchís para ${game.seatCount} jugadores`}
      className="parchis-board-stage"
      style={boardStyle}
    >
      <div className="parchis-board-rotor" style={{ transform: `rotate(${rotation}deg)` }}>
      <svg
        viewBox={layout.viewBox}
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <filter id="board-soft-shadow" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="var(--color-room-night)" floodOpacity="0.34" />
          </filter>
        </defs>

        <rect
          x="26"
          y="26"
          width="948"
          height="948"
          rx="10"
          fill="var(--color-board-walnut)"
          stroke="var(--color-board-edge)"
          strokeWidth="3"
          filter="url(#board-soft-shadow)"
        />
        <rect
          data-board-paper
          x="42"
          y="42"
          width="916"
          height="916"
          rx="2"
          fill="var(--color-board-paper)"
          stroke="var(--color-board-line)"
          strokeWidth="2"
        />

        {layout.homeSlotsBySeat.map((slots, seatIndex) => {
          const player = seatPlayer(playersBySeat, seatIndex);
          const center = layout.homeCentersBySeat[seatIndex];
          if (!center) return null;
          const color = player ? PLAYER_COLORS[player.color] : "var(--color-brass)";
          return (
            <g key={`home-${seatIndex}`}>
              {game.seatCount !== 5 ? (
                <>
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={game.seatCount === 4 ? 108 : 74}
                    fill={color}
                    stroke="var(--color-board-line)"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={game.seatCount === 4 ? 76 : 52}
                    fill="none"
                    stroke="var(--color-board-paper)"
                    strokeWidth="3"
                  />
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={game.seatCount === 4 ? 31 : 24}
                    fill="var(--color-board-paper)"
                    stroke="var(--color-board-line)"
                    strokeWidth="1.5"
                  />
                  <polygon
                    points={rosettePoints(center, game.seatCount === 4 ? 25 : 19, 7)}
                    fill={color}
                    stroke="var(--color-board-line)"
                    strokeWidth="0.8"
                  />
                </>
              ) : null}
              {game.seatCount === 5 ? slots.map((slot, slotIndex) => (
                <circle
                  key={`home-slot-${seatIndex}-${slotIndex}`}
                  cx={slot.x}
                  cy={slot.y}
                  r="16"
                  fill="var(--color-board-paper)"
                  stroke={color}
                  strokeWidth="2.2"
                />
              )) : null}
            </g>
          );
        })}

        {layout.trackCellPolygons.map((polygon, index) => {
          const point = layout.trackCells[index];
          if (!point) return null;
          const safe = layout.safeCellIndices.includes(index);
          const ownerSeat = layout.startCellIndicesBySeat.indexOf(index);
          const owner = ownerSeat >= 0 ? seatPlayer(playersBySeat, ownerSeat) : undefined;
          const normalSafe = safe && ownerSeat < 0;
          const safeSeat = layout.startCellIndicesBySeat.findIndex(
            (startIndex, seatIndex) =>
              index === (startIndex + 7) % layout.trackCells.length ||
              index === layout.goalEntryCellIndicesBySeat[seatIndex],
          );
          const safePlayer = safeSeat >= 0 ? seatPlayer(playersBySeat, safeSeat) : undefined;
          const angle = layout.trackCellAngles[index] ?? 90;
          const tangentAngle = ((angle - 90) * Math.PI) / 180;
          const shift = Math.min(23, layout.trackCellWidth / 3.2);
          const textPoint = {
            x: point.x - Math.cos(tangentAngle) * (normalSafe || owner ? shift : 0),
            y: point.y - Math.sin(tangentAngle) * (normalSafe || owner ? shift : 0),
          };
          const markPoint = {
            x: point.x + Math.cos(tangentAngle) * shift,
            y: point.y + Math.sin(tangentAngle) * shift,
          };
          const label = String(getViewerTrackLabel(index, viewerSeat, game.seatCount));
          const labelLength = Math.min(
            layout.trackCellDepth - 5,
            label.length * layout.numberFontSize * 0.58,
          );
          return (
            <g key={`track-${index}`}>
              <polygon
                data-track-cell={index}
                data-start-cell-seat={ownerSeat >= 0 ? ownerSeat : undefined}
                points={polygonPoints(polygon)}
                fill={owner ? PLAYER_COLORS[owner.color] : safe ? "var(--color-board-safe)" : "var(--color-board-cell)"}
                stroke="var(--color-board-line)"
                strokeWidth="1.5"
              />
              {normalSafe ? (
                <polygon
                  data-safe-cell-star={index}
                  points={starPoints(markPoint, 10, 4.5)}
                  fill={safePlayer ? PLAYER_COLORS[safePlayer.color] : "var(--color-board-line)"}
                  stroke="var(--color-board-line)"
                  strokeLinejoin="round"
                  strokeWidth="0.7"
                  pointerEvents="none"
                />
              ) : null}
              {owner ? (
                <g data-start-cell-marker={ownerSeat} pointerEvents="none">
                  <circle cx={markPoint.x} cy={markPoint.y} r="12" fill="var(--color-board-paper)" />
                  <polygon
                    points={`${markPoint.x},${markPoint.y - 6} ${markPoint.x - 5},${markPoint.y + 4} ${markPoint.x + 5},${markPoint.y + 4}`}
                    transform={`rotate(${angle - 90} ${markPoint.x} ${markPoint.y})`}
                    fill={PLAYER_COLORS[owner.color]}
                  />
                </g>
              ) : null}
              <text
                data-track-cell-number
                x={textPoint.x}
                y={textPoint.y}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${angle - 90} ${textPoint.x} ${textPoint.y})`}
                fontSize={layout.numberFontSize}
                fontWeight="700"
                fill="var(--color-board-number)"
                stroke={owner ? "var(--color-board-paper)" : undefined}
                strokeWidth={owner ? 5 : undefined}
                paintOrder={owner ? "stroke" : undefined}
                textLength={labelLength}
                lengthAdjust="spacingAndGlyphs"
                pointerEvents="none"
              >
                {label}
              </text>
            </g>
          );
        })}
        {layout.finishPathCellPolygonsBySeat.map((cells, seatIndex) => {
          const player = seatPlayer(playersBySeat, seatIndex);
          const color = player ? PLAYER_COLORS[player.color] : "var(--color-brass)";
          const connector = layout.finishLaneConnectorsBySeat[seatIndex];
          return (
            <g key={`finish-lane-${seatIndex}`}>
              {connector ? (
                <polygon
                  points={polygonPoints(connector)}
                  fill={color}
                  stroke="var(--color-board-line)"
                  strokeWidth="1.5"
                />
              ) : null}
              {cells.map((cell, progress) => (
                <polygon
                  key={`finish-${seatIndex}-${progress}`}
                  data-finish-cell-seat={seatIndex}
                  points={polygonPoints(cell)}
                  fill={color}
                  stroke="var(--color-board-line)"
                  strokeWidth="1.4"
                />
              ))}
            </g>
          );
        })}

        {layout.goalWedgesBySeat.map((wedge, seatIndex) => {
          const player = seatPlayer(playersBySeat, seatIndex);
          const color = player ? PLAYER_COLORS[player.color] : "var(--color-brass)";
          return (
            <polygon
              key={`goal-wedge-${seatIndex}`}
              data-goal-wedge-seat={seatIndex}
              points={polygonPoints(wedge)}
              fill={color}
              stroke="var(--color-board-line)"
              strokeWidth="2"
            />
          );
        })}

        {layout.shoulderLinesBySeat.map(([from, to], index) => (
          <line
            key={`shoulder-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--color-board-line)"
            strokeWidth="1.5"
          />
        ))}

        {game.seatCount === 6 ? (
          <g aria-hidden="true">
            <circle cx="500" cy="500" r="39" fill="var(--color-board-paper)" stroke="var(--color-board-line)" strokeWidth="2" />
            <polygon points={rosettePoints(layout.goal, 31, 9)} fill="var(--color-board-line)" fillOpacity="0.2" />
          </g>
        ) : null}
      </svg>

      <MotionConfig reducedMotion="user">
        {renderedPieces.map((piece) => {
          const player = playersById.get(piece.playerId);
          if (!player) return null;

          const point = projectPiece(piece, layout, occupancy);
          const options = movesByPiece.get(piece.id) ?? [];
          const legalMove = options.length > 0;
          const selectable =
            interactionEnabled &&
            canPlayThisTurn &&
            piece.playerId === currentPlayerId &&
            legalMove;
          const style: CSSProperties = {
            position: "absolute",
            left: `${point.x / 10}%`,
            top: `${point.y / 10}%`,
            translate: "-50% -50%",
          };

          return (
            <Piece
              key={piece.id}
              piece={piece}
              goalArrival={piece.state === "finished"}
              player={player}
              pieceNumber={pieceNumbers.get(piece.id) ?? 1}
              legalMove={legalMove}
              selectable={selectable}
              diceIndices={options.length === 1 ? options[0]?.diceIndices ?? [] : []}
              optionCount={options.length}
              selectionExpanded={selectedPieceId === piece.id && options.length > 1}
              trackCellLabel={piece.state === "track" && piece.trackPosition !== null
                ? getViewerTrackLabel(piece.trackPosition, viewerSeat, game.seatCount)
                : undefined}
              viewRotationDegrees={rotation}
              style={style}
              onSelect={handlePieceSelect}
            />
          );
        })}
      </MotionConfig>
      </div>
      {selectedPiece && selectedPlayer && selectedPieceNumber && selectedOptions.length > 1 ? (
        <div
          id={`move-options-for-${selectedPiece.id}`}
          role="group"
          aria-label={`Opciones de movimiento para ${selectedPlayer.displayName}, ficha ${selectedPieceNumber}`}
          data-move-chooser
          className="parchis-move-chooser"
          style={{
            position: "absolute",
            left: `${(chooserAnchor?.x ?? 500) / 10}%`,
            top: `${(chooserAnchor?.y ?? 500) / 10}%`,
            transform: "translate(-50%, calc(-100% - 0.45rem))",
            zIndex: "var(--z-popover)",
          }}
        >
          {selectedOptions.map((option, index) => {
            const diceValues = option.diceIndices.map((diceIndex) => game.diceValues?.[diceIndex]);
            const visibleValue = diceValues.every((value) => value !== undefined)
              ? diceValues.join("+")
              : String(option.steps);
            const diceLabel = option.diceIndices
              .map((diceIndex) => `dado ${diceIndex + 1}`)
              .join(" y ");
            return (
              <Button
                key={`${option.diceIndices.join("-")}-${option.steps}-${index}`}
                type="button"
                variant="secondary"
                className="parchis-move-option"
                aria-label={`Mover ${option.steps} casillas con ${diceLabel}`}
                onClick={() => chooseMove(option)}
              >
                {visibleValue}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
    </>
  );
}
