import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameTable } from "@/components/game/GameTable";
import { PlayerSeat } from "@/components/game/PlayerSeat";
import {
  gameRoomFixture,
  gameStateFixture,
  gameWithLegalOptions,
  pieceMoveEvent,
} from "@/test/game-fixtures";
import type { ServerEvent } from "@/types/protocol";
import { DEFAULT_PLAYER_PREFERENCES } from "@/lib/player-preferences";

const { playGameSoundMock } = vi.hoisted(() => ({ playGameSoundMock: vi.fn() }));
vi.mock("@/lib/audio", () => ({ playGameSound: playGameSoundMock }));

const makeActions = () => ({
  sendRollDice: vi.fn(),
  sendMovePiece: vi.fn(),
  sendMoveBonusPiece: vi.fn(),
  sendChatMessage: vi.fn(() => true),
  sendReaction: vi.fn(() => true),
  sendGift: vi.fn(() => true),
  sendReturnToLobby: vi.fn(),
  sendPlayAgain: vi.fn(),
});

describe("GameTable", () => {
  it("keeps the chat folded by default and adds social actions without replacing the board", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({ status: "playing", gameState: game });
    const actions = makeActions();
    const { container } = render(
      <GameTable room={room} game={game} currentPlayerId="p1" actions={actions} />,
    );
    const board = container.querySelector(".game-board-arena");

    expect(screen.getByRole("button", { name: "Abrir chat" })).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("#game-chat-panel")).toHaveAttribute("hidden");
    expect(screen.getAllByRole("button", { name: /^Enviar reacción:/ })).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "Enviar regalo a Felipe" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abrir chat" }));
    expect(screen.getByRole("region", { name: "Chat de la partida" })).not.toHaveAttribute("hidden");
    expect(container.querySelector(".game-board-arena")).toBe(board);

    fireEvent.click(screen.getByRole("button", { name: "Enviar regalo a Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Rosa" }));
    expect(actions.sendGift).toHaveBeenCalledWith("p2", "rose");
  });

  it("marks practice and identifies automated seats as bots", () => {
    const game = gameStateFixture();
    const players = gameRoomFixture().players.map((player) =>
      player.id === "p2" ? { ...player, isBot: true, isConnected: false } : player,
    );
    const room = gameRoomFixture({
      mode: "practice",
      status: "playing",
      players,
      gameState: game,
    });

    render(<GameTable room={room} game={game} currentPlayerId="p1" actions={makeActions()} />);

    expect(screen.getByText("Práctica")).toBeVisible();
    expect(screen.getByText("Ana").closest("li")).toHaveTextContent("Bot");
    expect(screen.getByText("Ana").closest("li")).not.toHaveTextContent("Automático");
  });

  it("shows local cosmetics immediately and synchronized cosmetics for other players", () => {
    const localPreferences = {
      ...DEFAULT_PLAYER_PREFERENCES,
      diceSkinId: "brass" as const,
      pieceSkinId: "glow" as const,
    };
    const players = gameRoomFixture().players.map((player) => player.id === "p2"
      ? { ...player, diceSkinId: "jade" as const, pieceSkinId: "walnut" as const }
      : player);
    const game = gameStateFixture({ currentPlayerId: "p2" });
    const room = gameRoomFixture({ players, status: "playing", gameState: game });

    render(
      <GameTable
        room={room}
        game={game}
        currentPlayerId="p1"
        actions={makeActions()}
        preferences={localPreferences}
        rollEvent={{
          type: "DICE_ROLLED", version: 1, roomCode: "AB7K2", stateVersion: room.stateVersion + 1,
          eventId: "roll-skin", serverTime: "2026-09-26T01:00:00Z",
          payload: { playerId: "p2", values: [2, 4], availableMoves: [] },
        }}
      />,
    );

    expect(document.querySelector("#parchis-piece-p1-piece-1 .parchis-piece-token")).toHaveAttribute("data-skin", "glow");
    expect(document.querySelector("#parchis-piece-p2-piece-1 .parchis-piece-token")).toHaveAttribute("data-skin", "walnut");
    expect(document.querySelector('[data-player-seat="p2"] .game-die-face')).toHaveAttribute("data-skin", "jade");
  });

  it.each([4, 5, 6] as const)("keeps the local player's seat at the lower edge of the %i-seat table", (seatCount) => {
    const extraPlayers = [
      { ...gameRoomFixture().players[0]!, id: "p5", displayName: "Sando", color: "purple" as const, seatIndex: 4 },
      { ...gameRoomFixture().players[0]!, id: "p6", displayName: "Oscar", color: "orange" as const, seatIndex: 5 },
    ];
    const players = [...gameRoomFixture().players, ...extraPlayers].slice(0, seatCount);
    const viewer = players[seatCount - 1]!;
    const game = gameStateFixture({ seatCount, currentPlayerId: viewer.id, playerOrder: players.map((player) => player.id) });
    const room = gameRoomFixture({ maxPlayers: seatCount, players, gameState: game, status: "playing" });
    render(<GameTable room={room} game={game} currentPlayerId={viewer.id} actions={makeActions()} />);

    const rows = screen.getAllByRole("list", { name: "Jugadores junto al tablero" });
    expect(rows[1]).toContainElement(screen.getByText(`${viewer.displayName} · Tú`).closest("li"));
  });

  it("test_reconnect_shows_last_roll_without_animation", () => {
    const game = gameStateFixture({
      currentPlayerId: "p3",
      turnPhase: "waiting_for_roll",
      lastRollsByPlayerId: {
        p1: { values: [1, 2], turnNumber: 1 },
        p2: { values: [3, 4], turnNumber: 2 },
      },
    });
    const room = gameRoomFixture({ status: "playing", gameState: game });
    render(<GameTable room={room} game={game} currentPlayerId="p1" actions={makeActions()} />);

    const firstSeat = document.querySelector('[data-player-seat="p1"]');
    const secondSeat = document.querySelector('[data-player-seat="p2"]');
    expect([...firstSeat!.querySelectorAll(".game-die-face")].map((die) => die.textContent)).toEqual(["1", "2"]);
    expect([...secondSeat!.querySelectorAll(".game-die-face")].map((die) => die.textContent)).toEqual(["3", "4"]);
    expect(firstSeat?.querySelector(".game-dice-trigger")).toHaveAttribute("data-rolling", "false");
    expect(secondSeat?.querySelector(".game-dice-trigger")).toHaveAttribute("data-rolling", "false");
  });

  it("test_six_player_table_renders_all_seats_and_controls", () => {
    const basePlayers = gameRoomFixture().players;
    const extraPlayers = [
      { ...basePlayers[0]!, id: "p5", displayName: "Sando", color: "purple" as const, seatIndex: 4 },
      { ...basePlayers[0]!, id: "p6", displayName: "Oscar con nombre largo", color: "orange" as const, seatIndex: 5 },
    ];
    const players = [...basePlayers, ...extraPlayers];
    const game = gameStateFixture({
      seatCount: 6,
      currentPlayerId: "p1",
      turnPhase: "waiting_for_roll",
      playerOrder: players.map((player) => player.id),
      lastRollsByPlayerId: Object.fromEntries(players.map((player, index) => [player.id, {
        values: [index + 1, 6 - index] as [number, number],
        turnNumber: index + 1,
      }])),
    });
    const room = gameRoomFixture({ maxPlayers: 6, players, gameState: game, status: "playing" });
    const { container } = render(<GameTable room={room} game={game} currentPlayerId="p1" actions={makeActions()} />);

    expect(container.querySelectorAll("li[data-player-seat]")).toHaveLength(6);
    expect(screen.getByText("Oscar con nombre largo")).toBeInTheDocument();
    expect(container.querySelectorAll(".game-dice-trigger")).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: /^Tirar dados$/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Enviar regalo a / })).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Tirar dados" })).toBeEnabled();
    expect([...container.querySelectorAll(".game-dice-trigger")].filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it("plays local cues only for fresh gameplay events", () => {
    playGameSoundMock.mockClear();
    const room = gameRoomFixture({ status: "playing", gameState: gameStateFixture() });
    const oldRoll: ServerEvent = {
      type: "DICE_ROLLED", version: 1, roomCode: "AB7K2", stateVersion: 4,
      eventId: "old-roll", serverTime: "2026-09-26T01:00:00Z",
      payload: { playerId: "p1", values: [2, 4], availableMoves: [] },
    };
    const newRoll: ServerEvent = { ...oldRoll, eventId: "new-roll", stateVersion: 5 };
    const capture: ServerEvent = {
      type: "PIECE_CAPTURED", version: 1, roomCode: "AB7K2", stateVersion: 6,
      eventId: "new-capture", serverTime: "2026-09-26T01:00:01Z",
      payload: { capturedPieceId: "p2-piece-1", byPieceId: "p1-piece-1", bonusSteps: 20 },
    };
    const { rerender } = render(
      <GameTable room={room} game={room.gameState!} currentPlayerId="p1" actions={makeActions()} events={[oldRoll]} />,
    );
    expect(playGameSoundMock).not.toHaveBeenCalled();

    rerender(
      <GameTable room={room} game={room.gameState!} currentPlayerId="p1" actions={makeActions()} events={[oldRoll, newRoll, capture]} />,
    );

    expect(playGameSoundMock).toHaveBeenNthCalledWith(1, "dice_roll", DEFAULT_PLAYER_PREFERENCES);
    expect(playGameSoundMock).toHaveBeenNthCalledWith(2, "capture", DEFAULT_PLAYER_PREFERENCES);
  });

  it.each([5, 6] as const)("keeps all %i player names around the radial board and the dice beside the active seat", (seatCount) => {
    const extraPlayers = [
      { ...gameRoomFixture().players[0]!, id: "p5", displayName: "Sando", color: "purple" as const, seatIndex: 4 },
      { ...gameRoomFixture().players[0]!, id: "p6", displayName: "Oscar", color: "orange" as const, seatIndex: 5 },
    ];
    const players = [...gameRoomFixture().players, ...extraPlayers].slice(0, seatCount);
    const game = gameStateFixture({ seatCount, currentPlayerId: "p5", playerOrder: players.map((player) => player.id) });
    const room = gameRoomFixture({ maxPlayers: seatCount, players, gameState: game, status: "playing" });

    render(<GameTable room={room} game={game} currentPlayerId="p2" actions={makeActions()} />);

    const rows = screen.getAllByRole("list", { name: "Jugadores junto al tablero" });
    expect(rows.flatMap((row) => within(row).getAllByRole("listitem"))).toHaveLength(seatCount);
    expect(screen.getByRole("button", { name: /tirar dados/i }).closest("li")).toHaveTextContent("Sando");
    expect(screen.getByRole("button", { name: /tirar dados/i })).toBeDisabled();
  });

  it("animates the server dice event on every client and announces its exact values", () => {
    vi.useFakeTimers();
    try {
      const game = gameStateFixture({ currentPlayerId: "p2", turnPhase: "waiting_for_roll" });
      const room = gameRoomFixture({ gameState: game, status: "playing", stateVersion: 4 });
      const { rerender, unmount } = render(
        <GameTable
          room={room}
          game={game}
          currentPlayerId="p1"
          actions={makeActions()}
          rollEvent={{
            type: "DICE_ROLLED", version: 1, roomCode: "AB7K2", stateVersion: 5,
            eventId: "roll-5", serverTime: "2026-09-26T01:00:00Z",
            payload: { playerId: "p2", values: [3, 5], availableMoves: [] },
          }}
        />,
      );
      expect(screen.getByText(/Ana está tirando los dados/)).toBeInTheDocument();
      const synchronized = gameStateFixture({ currentPlayerId: "p2", turnPhase: "waiting_for_move", diceValues: [3, 5] });
      rerender(
        <GameTable
          room={gameRoomFixture({ gameState: synchronized, status: "playing", stateVersion: 6 })}
          game={synchronized}
          currentPlayerId="p1"
          actions={makeActions()}
          rollEvent={{
            type: "DICE_ROLLED", version: 1, roomCode: "AB7K2", stateVersion: 5,
            eventId: "roll-5", serverTime: "2026-09-26T01:00:00Z",
            payload: { playerId: "p2", values: [3, 5], availableMoves: [] },
          }}
        />,
      );
      expect(screen.getByText(/Ana está tirando los dados/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getAllByText(/Ana sacó 3 y 5/)).toHaveLength(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes showing a no-move roll before moving the dice to the next player", () => {
    vi.useFakeTimers();
    try {
      const game = gameStateFixture({ currentPlayerId: "p2", turnPhase: "waiting_for_roll", diceValues: null });
      const event = {
        type: "DICE_ROLLED" as const, version: 1 as const, roomCode: "AB7K2", stateVersion: 7,
        eventId: "no-move-7", serverTime: "2026-09-26T01:00:00Z",
        payload: { playerId: "p2", values: [1, 2] as [number, number], availableMoves: [] },
      };
      const actions = makeActions();
      const { rerender, unmount } = render(
        <GameTable room={gameRoomFixture({ gameState: game, status: "playing", stateVersion: 6 })}
          game={game} currentPlayerId="p1" actions={actions} rollEvent={event} />,
      );
      const nextGame = gameStateFixture({ currentPlayerId: "p3", turnPhase: "waiting_for_roll", diceValues: null });
      rerender(
        <GameTable room={gameRoomFixture({ gameState: nextGame, status: "playing", stateVersion: 8 })}
          game={nextGame} currentPlayerId="p1" actions={actions} rollEvent={event} />,
      );
      expect(screen.getByRole("button", { name: /dados del turno/i }).closest("li")).toHaveTextContent("Ana");
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByText(/Ana sacó 1 y 2/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByRole("button", { name: /tirar dados/i }).closest("li")).toHaveTextContent("Pedro");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows the active player, authoritative dice, and roll availability", () => {
    const actions = makeActions();
    const game = gameStateFixture({
      turnPhase: "waiting_for_roll",
      currentPlayerId: "p1",
      diceValues: null,
    });

    const { container } = render(
      <GameTable
        room={gameRoomFixture()}
        game={game}
        currentPlayerId="p1"
        actions={actions}
      />,
    );

    const activeSeat = screen.getByText("Felipe · Tú").closest("li");
    expect(activeSeat).toHaveClass("game-seat-active");
    expect(activeSeat).toHaveAttribute("aria-current", "step");
    expect(container.querySelector(".game-turn-card")).toBeNull();
    const turnAnnouncement = container.querySelector(".game-turn-announcement");
    expect(turnAnnouncement).toHaveClass("sr-only");
    expect(turnAnnouncement).toHaveTextContent("Tu turno");
    expect(screen.getAllByText("En juego")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /tirar dados/i })).toBeEnabled();
    expect(screen.getAllByRole("list", { name: "Jugadores junto al tablero" })).toHaveLength(2);
    expect(screen.getByText("Felipe · Tú").closest("li")).toContainElement(screen.getByRole("button", { name: /tirar dados/i }));
    expect(screen.getAllByRole("button", { name: /tirar dados/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /tirar dados/i }));
    expect(actions.sendRollDice).toHaveBeenCalledOnce();
  });

  it("shows only legal pieces and routes a pending bonus through its own action", () => {
    const actions = makeActions();
    const legalGame = gameWithLegalOptions(["p1-piece-2"]);
    const game = gameStateFixture({
      turnPhase: "waiting_for_bonus",
      pendingBonuses: [{ playerId: "p1", steps: 20, reason: "capture" }],
      availableMoves: legalGame.availableMoves,
    });

    render(
      <GameTable
        room={gameRoomFixture()}
        game={game}
        currentPlayerId="p1"
        actions={actions}
      />,
    );

    const legalPiece = screen.getByRole("button", {
      name: /Felipe, ficha 2.*mover/i,
    });
    expect(legalPiece).toBeEnabled();
    expect(screen.getByRole("button", { name: "Felipe, ficha 1, en casa" })).toBeDisabled();
    expect(screen.getByText(/Bonus de 20 por captura/i)).toBeVisible();

    fireEvent.click(legalPiece);
    expect(actions.sendMoveBonusPiece).toHaveBeenCalledWith("p1-piece-2");
    expect(actions.sendMovePiece).not.toHaveBeenCalled();
  });

  it("returns a captured piece home only after the attacker's path arrives", () => {
    vi.useFakeTimers();
    try {
      const initial = gameStateFixture({
        pieces: gameStateFixture().pieces.map((piece) => {
          if (piece.id === "p1-piece-1") return { ...piece, state: "track" as const, trackPosition: 10 };
          if (piece.id === "p2-piece-1") return { ...piece, state: "track" as const, trackPosition: 11 };
          return piece;
        }),
      });
      const moved = {
        ...initial,
        pieces: initial.pieces.map((piece) => {
          if (piece.id === "p1-piece-1") return { ...piece, trackPosition: 12 };
          if (piece.id === "p2-piece-1") return { ...piece, state: "yard" as const, trackPosition: null };
          return piece;
        }),
      };
      const move = pieceMoveEvent({
        stateVersion: 5,
        eventId: "capture-attack-path",
        from: { state: "track", trackPosition: 10, finishProgress: null },
        to: { state: "track", trackPosition: 12, finishProgress: null },
        path: [
          { state: "track", trackPosition: 11, finishProgress: null },
          { state: "track", trackPosition: 12, finishProgress: null },
        ],
      });
      const capture: ServerEvent = {
        type: "PIECE_CAPTURED", version: 1, roomCode: "AB7K2", stateVersion: 5,
        eventId: "capture-victim-home", serverTime: "2026-09-26T01:00:00Z",
        payload: { capturedPieceId: "p2-piece-1", byPieceId: "p1-piece-1", bonusSteps: 20 },
      };
      const actions = makeActions();
      const baseRoom = gameRoomFixture({ status: "playing", stateVersion: 5, gameState: moved });
      const { rerender, unmount } = render(
        <GameTable room={baseRoom} game={moved} currentPlayerId="p1" actions={actions} />,
      );
      rerender(
        <GameTable room={baseRoom} game={moved} currentPlayerId="p1" actions={actions} events={[move, capture]} />,
      );

      expect(screen.getByRole("button", { name: "Ana, ficha 1, en casa" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(180));
      expect(screen.getByRole("button", { name: "Ana, ficha 1, en casa" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(90));
      expect(screen.getByRole("button", { name: /Ana, ficha 1, en el recorrido/i })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(90));
      expect(screen.getByRole("button", { name: "Ana, ficha 1, en casa" })).toBeInTheDocument();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables a local second move until its own animated path is complete", () => {
    vi.useFakeTimers();
    try {
      const legal = gameWithLegalOptions(["p1-piece-1"]);
      const moved = {
        ...legal,
        pieces: legal.pieces.map((piece) => piece.id === "p1-piece-1"
          ? { ...piece, state: "track" as const, trackPosition: 13 }
          : piece),
      };
      const event = pieceMoveEvent({
        stateVersion: 5,
        eventId: "own-animated-move",
        from: { state: "track", trackPosition: 10, finishProgress: null },
        to: { state: "track", trackPosition: 13, finishProgress: null },
        path: [
          { state: "track", trackPosition: 11, finishProgress: null },
          { state: "track", trackPosition: 12, finishProgress: null },
          { state: "track", trackPosition: 13, finishProgress: null },
        ],
      });
      const actions = makeActions();
      const room = gameRoomFixture({ status: "playing", stateVersion: 5, gameState: moved });
      const { rerender, unmount } = render(
        <GameTable room={room} game={moved} currentPlayerId="p1" actions={actions} />,
      );
      rerender(<GameTable room={room} game={moved} currentPlayerId="p1" actions={actions} events={[event]} />);

      const movingPiece = () => [...document.querySelectorAll<HTMLButtonElement>(".parchis-piece")]
        .find((piece) => piece.getAttribute("aria-label")?.startsWith("Felipe, ficha 1,"));
      expect(movingPiece()?.disabled).toBe(true);
      const disabledPiece = movingPiece();
      if (!disabledPiece) throw new Error("The moving piece should remain on the board.");
      fireEvent.click(disabledPiece);
      expect(actions.sendMovePiece).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(270));
      expect(movingPiece()?.disabled).toBe(false);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the final piece animation before opening the victory dialog", () => {
    vi.useFakeTimers();
    try {
      const finished = gameStateFixture({
        status: "finished", turnPhase: "finished", winnerId: "p1", finishOrder: ["p1", "p2"],
        pieces: gameStateFixture().pieces.map((piece) => piece.id === "p1-piece-1"
          ? { ...piece, state: "finished" as const }
          : piece),
      });
      const room = gameRoomFixture({ status: "finished", stateVersion: 5, gameState: finished });
      const actions = makeActions();
      const { rerender, unmount } = render(
        <GameTable room={room} game={finished} currentPlayerId="p1" actions={actions} />,
      );
      rerender(
        <GameTable
          room={room}
          game={finished}
          currentPlayerId="p1"
          actions={actions}
          events={[pieceMoveEvent({
            stateVersion: 5,
            eventId: "winning-move",
            from: { state: "track", trackPosition: 10, finishProgress: null },
            to: { state: "finished", trackPosition: null, finishProgress: null },
            path: [
              { state: "track", trackPosition: 11, finishProgress: null },
              { state: "track", trackPosition: 12, finishProgress: null },
              { state: "finished", trackPosition: null, finishProgress: null },
            ],
          })]}
        />,
      );

      expect(document.querySelector(".game-victory-dialog")).toBeNull();
      act(() => vi.advanceTimersByTime(270));
      expect(document.querySelector(".game-victory-dialog[open]")).not.toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("animates a bot's authoritative move for an observing friend", () => {
    vi.useFakeTimers();
    try {
      const base = gameStateFixture();
      const moved = {
        ...base,
        pieces: base.pieces.map((piece) => piece.id === "p2-piece-1"
          ? { ...piece, state: "track" as const, trackPosition: 13 }
          : piece),
      };
      const room = gameRoomFixture({
        mode: "practice", status: "playing", stateVersion: 5, gameState: moved,
        players: gameRoomFixture().players.map((player) => player.id === "p2"
          ? { ...player, isBot: true, isConnected: false }
          : player),
      });
      const actions = makeActions();
      const { rerender, unmount } = render(
        <GameTable room={room} game={moved} currentPlayerId="p1" actions={actions} />,
      );
      const botPieceLabel = () => [...document.querySelectorAll<HTMLButtonElement>(".parchis-piece")]
        .find((piece) => piece.getAttribute("aria-label")?.startsWith("Ana, ficha 1,"))
        ?.getAttribute("aria-label");
      rerender(
        <GameTable
          room={room}
          game={moved}
          currentPlayerId="p1"
          actions={actions}
          events={[pieceMoveEvent({
            stateVersion: 5,
            eventId: "bot-piece-move",
            pieceId: "p2-piece-1",
            from: { state: "track", trackPosition: 10, finishProgress: null },
            to: { state: "track", trackPosition: 13, finishProgress: null },
            path: [
              { state: "track", trackPosition: 11, finishProgress: null },
              { state: "track", trackPosition: 12, finishProgress: null },
              { state: "track", trackPosition: 13, finishProgress: null },
            ],
          })]}
        />,
      );

      expect(botPieceLabel()).toMatch(/en el recorrido, casilla/);
      act(() => vi.advanceTimersByTime(90));
      expect(botPieceLabel()).toBe("Ana, ficha 1, en el recorrido, casilla 16");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables manual actions while reconnecting or when the active player is offline", () => {
    const actions = makeActions();
    const game = gameStateFixture({ turnPhase: "waiting_for_roll" });
    const room = gameRoomFixture({
      players: gameRoomFixture().players.map((player) =>
        player.id === "p1" ? { ...player, isConnected: false } : player,
      ),
    });

    render(
      <GameTable
        room={room}
        game={game}
        currentPlayerId="p1"
        actions={actions}
        connectionState="reconnecting"
      />,
    );

    expect(screen.getByRole("button", { name: /tirar dados/i })).toBeDisabled();
    expect(screen.getByText("Automático")).toBeInTheDocument();
    expect(screen.queryByText(/Felipe no está conectado.*juego automático/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Felipe, ficha 2/i })).toBeDisabled();
  });

  it("shows complete standings and waits for the server after replay is requested", () => {
    const actions = makeActions();
    const game = gameStateFixture({
      status: "finished",
      turnPhase: "finished",
      winnerId: "p1",
      finishOrder: ["p1", "p2", "p3"],
    });

    render(
      <GameTable
        room={gameRoomFixture({ status: "finished" })}
        game={game}
        currentPlayerId="p1"
        actions={actions}
      />,
    );

    expect(screen.getByRole("heading", { name: /felipe ganó/i })).toBeVisible();
    const standings = screen.getByRole("list", { name: "Clasificación final" });
    expect(within(standings).getByText("4.º")).toBeVisible();
    expect(within(standings).getByText("Kale")).toBeVisible();
    expect(screen.getByRole("button", { name: /jugar de nuevo/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /volver al lobby/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /jugar de nuevo/i }));
    expect(actions.sendPlayAgain).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: /felipe ganó/i })).toBeVisible();
  });

  it("offers replay and home exit without a lobby action after a practice game", () => {
    const actions = makeActions();
    const game = gameStateFixture({
      status: "finished",
      turnPhase: "finished",
      winnerId: "p1",
      finishOrder: ["p1", "p2", "p3"],
    });
    const room = gameRoomFixture({ mode: "practice", status: "finished" });

    render(<GameTable room={room} game={game} currentPlayerId="p1" actions={actions} />);

    expect(screen.getByRole("button", { name: /jugar de nuevo/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /volver al lobby/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Salir" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: /jugar de nuevo/i }));
    expect(actions.sendPlayAgain).toHaveBeenCalledOnce();
    expect(actions.sendReturnToLobby).not.toHaveBeenCalled();
  });
});
