"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/game/Board";
import { GameSettings } from "@/components/game/GameSettings";
import { PlayerSeat } from "@/components/game/PlayerSeat";
import { TurnIndicator } from "@/components/game/TurnIndicator";
import { VictoryModal, type VictoryActions } from "@/components/game/VictoryModal";
import { getBoardLayout } from "@/lib/board-layouts";
import { playGameSound } from "@/lib/audio";
import { DEFAULT_PLAYER_PREFERENCES, type PlayerPreferences } from "@/lib/player-preferences";
import { usePiecePresentation } from "@/hooks/usePiecePresentation";
import { Badge } from "@/components/ui/badge";
import { ChatPanel } from "@/components/social/ChatPanel";
import { ReactionBar } from "@/components/social/ReactionBar";
import { SocialEffectsLayer } from "@/components/social/SocialEffectsLayer";
import type { ConnectionState } from "@/stores/gameStore";
import type { ServerEvent } from "@/types/protocol";
import type {
  ChatMessage,
  DiceIndex,
  GiftId,
  GameState,
  PlayerPlacement,
  PublicRoomState,
  ReactionId,
} from "@/types/game";

export type GameTableActions = VictoryActions & {
  sendRollDice: () => boolean | void;
  sendMovePiece: (pieceId: string, diceIndices: DiceIndex[]) => boolean | void;
  sendMoveBonusPiece: (pieceId: string) => boolean | void;
  sendChatMessage: (text: string) => boolean | void;
  sendReaction: (reactionId: ReactionId) => boolean | void;
  sendGift: (playerId: string, giftId: GiftId) => boolean | void;
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
  chatMessages?: readonly ChatMessage[];
  chatHistoryReady?: boolean;
  preferences?: PlayerPreferences;
  onPreferencesChange?: (preferences: PlayerPreferences) => void;
};

const CONNECTION_COPY: Record<ConnectionState, string> = {
  idle: "Preparando la mesa…",
  connecting: "Conectando con la mesa…",
  connected: "Mesa sincronizada",
  reconnecting: "Reconectando… Conservamos tu partida.",
  disconnected: "Sin conexión. Tus acciones están pausadas.",
  error: "La conexión necesita atención.",
};

const EMPTY_EVENTS: readonly ServerEvent[] = [];
const EMPTY_CHAT_MESSAGES: readonly ChatMessage[] = [];
const NOOP_PREFERENCES_CHANGE = () => undefined;

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
  events = EMPTY_EVENTS,
  chatMessages = EMPTY_CHAT_MESSAGES,
  chatHistoryReady = true,
  preferences = DEFAULT_PLAYER_PREFERENCES,
  onPreferencesChange = NOOP_PREFERENCES_CHANGE,
}: GameTableProps) {
  const presentationRoom = useMemo<PublicRoomState>(() => ({
    ...room,
    players: room.players.map((player) => player.id === currentPlayerId
      ? { ...player, diceSkinId: preferences.diceSkinId, pieceSkinId: preferences.pieceSkinId }
      : player),
  }), [room, currentPlayerId, preferences.diceSkinId, preferences.pieceSkinId]);
  const { visualPieces, isAnimating, isAnimatingOwnMove } = usePiecePresentation(
    game,
    presentationRoom.roomCode,
    presentationRoom.stateVersion,
    currentPlayerId,
    events,
    connectionState,
  );
  const activePlayer = presentationRoom.players.find(
    (player) => player.id === game.currentPlayerId,
  );
  const isConnected = connectionState === "connected";
  const activePlayerConnected = activePlayer?.isConnected === true;
  const canPlay = isConnected && activePlayerConnected;
  const canInteract = canPlay && !isAnimatingOwnMove;
  const canSendSocial = game.status === "playing" && isConnected;
  const placements = makePlacements(presentationRoom, game);
  const placementByPlayerId = new Map(
    placements.map((placement) => [placement.playerId, placement]),
  );
  const playerRows = playersAroundBoard(presentationRoom, game, currentPlayerId);
  const [heldRoll, setHeldRoll] = useState<GameTableProps["rollEvent"]>();
  const [chatOpen, setChatOpen] = useState(false);
  const [giftMenuOpenFor, setGiftMenuOpenFor] = useState<string | null>(null);
  const seenSoundEventIdsRef = useRef(new Set(events.map((event) => event.eventId)));
  useEffect(() => {
    if (!rollEvent || rollEvent.stateVersion < room.stateVersion - 1) return;
    setHeldRoll(rollEvent);
    const timer = window.setTimeout(() => setHeldRoll(undefined), 1350);
    return () => window.clearTimeout(timer);
    // A later sync must not restart the brief presentation of this event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent?.eventId]);
  useEffect(() => {
    for (const event of events) {
      if (seenSoundEventIdsRef.current.has(event.eventId)) continue;
      seenSoundEventIdsRef.current.add(event.eventId);
      if (event.type === "DICE_ROLLED") {
        playGameSound("dice_roll", preferences);
      } else if (event.type === "PIECE_MOVED") {
        playGameSound(event.payload.to.state === "finished" ? "goal" : "piece_move", preferences);
      } else if (event.type === "PIECE_CAPTURED") {
        playGameSound("capture", preferences);
      }
    }
  }, [events, preferences]);
  const matchingDice = rollEvent && game.diceValues &&
    game.diceValues[0] === rollEvent.payload.values[0] &&
    game.diceValues[1] === rollEvent.payload.values[1];
  const currentRoll = rollEvent && rollEvent.payload.playerId === game.currentPlayerId &&
    (rollEvent.stateVersion >= room.stateVersion || (rollEvent.stateVersion >= room.stateVersion - 1 && matchingDice))
    ? rollEvent
    : undefined;
  const visibleRoll = heldRoll ?? currentRoll;

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

  const renderPlayer = (player: (typeof presentationRoom.players)[number]) => (
    <PlayerSeat
      key={player.id}
      player={player}
      currentPlayerId={currentPlayerId}
      game={game}
      connectionState={connectionState}
      lastRoll={game.lastRollsByPlayerId[player.id] ?? null}
      isActive={player.id === game.currentPlayerId}
      canRoll={
        canInteract &&
        player.id === game.currentPlayerId &&
        game.currentPlayerId === currentPlayerId &&
        game.status === "playing" &&
        game.turnPhase === "waiting_for_roll"
      }
      diceSkinId={player.id === currentPlayerId ? preferences.diceSkinId : player.diceSkinId}
      rollEvent={visibleRoll}
      placement={placementByPlayerId.get(player.id)?.rank}
      onRoll={actions.sendRollDice}
      onOpenGiftMenu={setGiftMenuOpenFor}
      onSendGift={actions.sendGift}
      canSendGift={canSendSocial}
      giftMenuOpen={giftMenuOpenFor === player.id}
      onCloseGiftMenu={() => setGiftMenuOpenFor(null)}
    />
  );

  return (
    <main className="app-shell game-shell">
      <header className="game-header">
        <div>
          <p className="eyebrow">Parchís Online · partida privada</p>
          <h1>Mesa de juego</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <GameSettings
            preferences={preferences}
            onChange={onPreferencesChange}
            cosmeticsDisabled={game.status === "finished"}
          />
          <ChatPanel
            messages={chatMessages}
            isOpen={chatOpen}
            onToggle={() => setChatOpen((open) => !open)}
            onSendMessage={actions.sendChatMessage}
            disabled={!canSendSocial}
            historyReady={chatHistoryReady}
          />
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
              room={presentationRoom}
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
          <ReactionBar onSendReaction={actions.sendReaction} disabled={!canSendSocial} />
      </section>

      <SocialEffectsLayer players={presentationRoom.players} events={events} preferences={preferences} />

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
