"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Board } from "@/components/game/Board";
import { Dice } from "@/components/game/Dice";
import { TurnIndicator } from "@/components/game/TurnIndicator";
import { VictoryModal, type VictoryActions } from "@/components/game/VictoryModal";
import { getBoardLayout } from "@/lib/board-layouts";
import { usePiecePresentation } from "@/hooks/usePiecePresentation";
import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/stores/gameStore";
import type { ServerEvent } from "@/types/protocol";
import type {
  DiceIndex,
  GameState,
  PlayerPlacement,
  PublicPlayer,
  PublicRoomState,
} from "@/types/game";

export type GameTableActions = VictoryActions & {
  sendRollDice: () => boolean | void;
  sendMovePiece: (pieceId: string, diceIndices: DiceIndex[]) => boolean | void;
  sendMoveBonusPiece: (pieceId: string) => boolean | void;
};

type GameTableProps = {
  room: PublicRoomState;
  game: GameState;
  currentPlayerId: string;
  actions: GameTableActions;
  connectionState?: ConnectionState;
  authenticationFailed?: boolean;
  rollEvent?: Extract<ServerEvent, { type: "DICE_ROLLED" }>;
  events?: readonly ServerEvent[];
};

const CONNECTION_COPY: Record<ConnectionState, string> = {
  idle: "Preparando la mesa…",
  connecting: "Conectando con la mesa…",
  connected: "Mesa sincronizada",
  reconnecting: "Reconectando… Conservamos tu partida.",
  disconnected: "Sin conexión. Tus acciones están pausadas.",
  error: "La conexión necesita atención.",
};

function makePlacements(room: PublicRoomState, game: GameState): PlayerPlacement[] {
  if (game.result?.placements.length) {
    return [...game.result.placements].sort((left, right) => left.rank - right.rank);
  }

  if (game.status !== "finished") {
    return game.finishOrder.map((playerId, index) => ({
      playerId,
      rank: index + 1,
    }));
  }

  const placedIds = new Set(game.finishOrder);
  const remainingIds = [...room.players]
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => player.id)
    .filter((playerId) => !placedIds.has(playerId));

  return [...game.finishOrder, ...remainingIds].map((playerId, index) => ({
    playerId,
    rank: index + 1,
  }));
}

function playersAroundBoard(room: PublicRoomState, game: GameState, viewerId: string) {
  const viewerSeat = room.players.find((player) => player.id === viewerId)?.seatIndex ?? 0;
  const angle = (viewerSeat * Math.PI * 2) / game.seatCount;
  const layout = getBoardLayout(game.seatCount);
  const positioned = room.players.map((player) => {
    const home = layout.homeCentersBySeat[player.seatIndex];
    if (!home) return { player, x: 0, y: 0 };
    const dx = home.x - 500;
    const dy = home.y - 500;
    return {
      player,
      x: dx * Math.cos(angle) - dy * Math.sin(angle),
      y: dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  });
  const sortByX = (left: (typeof positioned)[number], right: (typeof positioned)[number]) => left.x - right.x;
  return {
    top: positioned.filter(({ y }) => y < 0).sort(sortByX).map(({ player }) => player),
    bottom: positioned.filter(({ y }) => y >= 0).sort(sortByX).map(({ player }) => player),
  };
}

export function GameTable({
  room,
  game,
  currentPlayerId,
  actions,
  connectionState = "connected",
  authenticationFailed = false,
  rollEvent,
  events = [],
}: GameTableProps) {
  const { visualPieces, isAnimating, isAnimatingOwnMove } = usePiecePresentation(
    game,
    room.roomCode,
    room.stateVersion,
    currentPlayerId,
    events,
    connectionState,
  );
  const activePlayer = room.players.find(
    (player) => player.id === game.currentPlayerId,
  );
  const isConnected = connectionState === "connected";
  const activePlayerConnected = activePlayer?.isConnected === true;
  const canPlay = isConnected && activePlayerConnected;
  const canInteract = canPlay && !isAnimatingOwnMove;
  const placements = makePlacements(room, game);
  const placementByPlayerId = new Map(
    placements.map((placement) => [placement.playerId, placement]),
  );
  const playerRows = playersAroundBoard(room, game, currentPlayerId);
  const [heldRoll, setHeldRoll] = useState<GameTableProps["rollEvent"]>();
  useEffect(() => {
    if (!rollEvent || rollEvent.stateVersion < room.stateVersion - 1) return;
    setHeldRoll(rollEvent);
    const timer = window.setTimeout(() => setHeldRoll(undefined), 1350);
    return () => window.clearTimeout(timer);
    // A later sync must not restart the brief presentation of this event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent?.eventId]);
  const matchingDice = rollEvent && game.diceValues &&
    game.diceValues[0] === rollEvent.payload.values[0] &&
    game.diceValues[1] === rollEvent.payload.values[1];
  const currentRoll = rollEvent && rollEvent.payload.playerId === game.currentPlayerId &&
    (rollEvent.stateVersion >= room.stateVersion || (rollEvent.stateVersion >= room.stateVersion - 1 && matchingDice))
    ? rollEvent
    : undefined;
  const visibleRoll = heldRoll ?? currentRoll;
  const diceOwnerId = visibleRoll?.payload.playerId ?? game.currentPlayerId;

  const handleSelectPiece = (pieceId: string, diceIndices: DiceIndex[]) => {
    if (!canInteract || game.currentPlayerId !== currentPlayerId) return;
    if (game.turnPhase === "waiting_for_bonus") {
      actions.sendMoveBonusPiece(pieceId);
    } else {
      actions.sendMovePiece(pieceId, diceIndices);
    }
  };

  const connectionMessage = authenticationFailed
    ? "No pudimos autenticar esta sesión. Vuelve al inicio para entrar de nuevo."
    : CONNECTION_COPY[connectionState];

  const renderPlayer = (player: PublicPlayer) => {
    const isActive = player.id === game.currentPlayerId;
    const placement = placementByPlayerId.get(player.id);
    return (
      <li
        key={player.id}
        className={`game-seat${isActive ? " game-seat-active" : ""}`}
        style={{ "--player-color": `var(--color-piece-${player.color})` } as CSSProperties}
        aria-current={isActive ? "step" : undefined}
      >
        <span className="game-seat-avatar" aria-hidden="true">{player.displayName.slice(0, 1).toUpperCase()}</span>
        <span className="game-seat-copy">
          <span className="game-player-name">{player.displayName}{player.id === currentPlayerId ? " · Tú" : ""}</span>
          <span className="game-seat-status">
            {placement
              ? `${placement.rank}.º`
              : player.isBot
                ? "Bot"
                : player.isConnected
                  ? "En juego"
                  : "Automático"}
          </span>
        </span>
        {player.id === diceOwnerId ? (
          <Dice
            game={game}
            currentPlayerId={currentPlayerId}
            activePlayer={player}
            connectionState={connectionState}
            onRoll={actions.sendRollDice}
            rollEvent={visibleRoll}
          />
        ) : null}
      </li>
    );
  };

  return (
    <main className="app-shell game-shell">
      <header className="game-header">
        <div>
          <p className="eyebrow">Parchís Online · partida privada</p>
          <h1>Mesa de juego</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {room.mode === "practice" ? <Badge tone="info">Práctica</Badge> : null}
          <Badge tone={isConnected ? "success" : "warning"}>Sala {room.roomCode}</Badge>
        </div>
      </header>

      <div
        className={`game-connection-banner${isConnected ? " game-connection-success" : " game-connection-warning"}`}
        role={authenticationFailed ? "alert" : "status"}
      >
        <span className="connection-dot" aria-hidden="true" />
        <span>{connectionMessage}</span>
        {authenticationFailed ? (
          <Link href="/" className="inline-link">
            Volver al inicio
          </Link>
        ) : null}
      </div>

      <section className="game-table-main" aria-label="Partida">
          <TurnIndicator
            room={room}
            game={game}
            currentPlayerId={currentPlayerId}
          />
          <div className="game-board-arena" data-seat-count={game.seatCount}>
            <ol className="game-seat-row" aria-label="Jugadores junto al tablero">
              {playerRows.top.map(renderPlayer)}
            </ol>
            <Board
              room={room}
              game={game}
              currentPlayerId={currentPlayerId}
              interactionEnabled={canInteract}
              visualPieces={visualPieces}
              onSelectPiece={handleSelectPiece}
            />
            <ol className="game-seat-row" aria-label="Jugadores junto al tablero">
              {playerRows.bottom.map(renderPlayer)}
            </ol>
          </div>
      </section>

      {game.status === "finished" && !isAnimating ? (
        <VictoryModal
          room={room}
          game={game}
          placements={placements}
          actions={actions}
          actionsEnabled={isConnected}
        />
      ) : null}
    </main>
  );
}
