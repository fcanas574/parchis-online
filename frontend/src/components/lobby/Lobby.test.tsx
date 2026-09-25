import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "@/stores/gameStore";
import type { PublicPlayer, PublicRoomState } from "@/types/game";
import { Lobby } from "./Lobby";

const { sendReadyMock, sendStartGameMock } = vi.hoisted(() => ({
  sendReadyMock: vi.fn(),
  sendStartGameMock: vi.fn(),
}));

vi.mock("@/hooks/useGameSocket", () => ({
  useGameSocket: vi.fn(() => ({
    sendReady: sendReadyMock,
    sendStartGame: sendStartGameMock,
  })),
}));

const players: PublicPlayer[] = [
  {
    id: "p1",
    displayName: "Felipe",
    color: "green",
    seatIndex: 0,
    isHost: true,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
  },
  {
    id: "p2",
    displayName: "Ana",
    color: "blue",
    seatIndex: 1,
    isHost: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
  },
  {
    id: "p3",
    displayName: "Luis",
    color: "red",
    seatIndex: 2,
    isHost: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
  },
  {
    id: "p4",
    displayName: "Marta",
    color: "yellow",
    seatIndex: 3,
    isHost: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
  },
];

const room = (overrides: Partial<PublicRoomState> = {}): PublicRoomState => ({
  roomCode: "AB7K2",
  status: "lobby",
  maxPlayers: 4,
  hostPlayerId: "p1",
  players,
  stateVersion: 7,
  ...overrides,
});

const setRoomState = (
  roomState: PublicRoomState,
  playerId = "p1",
  connectionState: "connected" | "reconnecting" = "connected",
) => {
  useGameStore.setState({
    room: roomState,
    session: {
      roomCode: "AB7K2",
      playerId,
      playerToken: `token-${playerId}`,
      isHost: playerId === "p1",
    },
    connectionState,
    lastError: null,
    lastStateVersion: roomState.stateVersion,
  });
};

describe("Lobby", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    sendReadyMock.mockReset();
    sendStartGameMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the lobby players, connection status, ready action, and invitation copy", async () => {
    setRoomState(room());
    render(<Lobby roomCode="AB7K2" />);

    expect(screen.getByText("Sala sincronizada")).toBeInTheDocument();
    expect(screen.getByText("Felipe")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ya no estoy listo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar invitación" }));
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });

  it("keeps Copiado visible for two seconds", async () => {
    vi.useFakeTimers();
    setRoomState(room());
    render(<Lobby roomCode="AB7K2" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar invitación" }));
      await Promise.resolve();
    });
    expect(screen.getByText("Copiado")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByText("Copiado")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Copiado")).not.toBeInTheDocument();
  });

  it("shows a readable manual-copy fallback when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    setRoomState(room());
    render(<Lobby roomCode="AB7K2" />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar invitación" }));

    expect(
      await screen.findByText("No se pudo copiar. Selecciona el enlace y cópialo manualmente."),
    ).toBeInTheDocument();
  });

  it("shows the host start action but disables it until the room is full and ready", () => {
    setRoomState(room({ players: players.slice(0, 3) }));
    render(<Lobby roomCode="AB7K2" />);

    expect(screen.getByRole("button", { name: "Iniciar partida" })).toBeDisabled();
    expect(screen.getByText(/Falta 1 jugador/)).toBeInTheDocument();
  });

  it("enables the host start action when every seat is connected and ready", () => {
    setRoomState(room());
    render(<Lobby roomCode="AB7K2" />);

    const start = screen.getByRole("button", { name: "Iniciar partida" });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(sendStartGameMock).toHaveBeenCalledTimes(1);
  });

  it("does not show the start action to a non-host", () => {
    setRoomState(room(), "p2");
    render(<Lobby roomCode="AB7K2" />);

    expect(screen.queryByRole("button", { name: "Iniciar partida" })).not.toBeInTheDocument();
  });

  it("sends the inverse of the current player's authoritative ready state", () => {
    setRoomState(room());
    render(<Lobby roomCode="AB7K2" />);

    fireEvent.click(screen.getByRole("button", { name: "Ya no estoy listo" }));
    expect(sendReadyMock).toHaveBeenCalledWith(false);
  });

  it("replaces lobby controls with the Phase 2 notice after play starts", () => {
    setRoomState(room({ status: "playing" }));
    render(<Lobby roomCode="AB7K2" />);

    expect(
      screen.getByText("Partida iniciada; el tablero se incorporará en la siguiente fase"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar partida" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar invitación" })).not.toBeInTheDocument();
  });
});
