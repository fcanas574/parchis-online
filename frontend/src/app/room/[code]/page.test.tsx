import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  gameRoomFixture,
  gameStateFixture,
  gameSyncEvent,
} from "@/test/game-fixtures";
import { useGameStore } from "@/stores/gameStore";
import { RoomPageClient } from "./RoomPageClient";

const {
  readSessionMock,
  useGameSocketMock,
  routerPushMock,
  joinRoomMock,
  getRoomMock,
  saveSessionMock,
} = vi.hoisted(() => ({
  readSessionMock: vi.fn(),
  useGameSocketMock: vi.fn(() => ({
    sendReady: vi.fn(),
    sendStartGame: vi.fn(),
    sendRollDice: vi.fn(),
    sendMovePiece: vi.fn(),
    sendMoveBonusPiece: vi.fn(),
    sendReturnToLobby: vi.fn(),
    sendPlayAgain: vi.fn(),
  })),
  routerPushMock: vi.fn(),
  joinRoomMock: vi.fn(),
  getRoomMock: vi.fn(),
  saveSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPushMock }) }));
vi.mock("@/lib/session", () => ({
  readSession: readSessionMock,
  saveSession: saveSessionMock,
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getRoom: getRoomMock, joinRoom: joinRoomMock };
});
vi.mock("@/hooks/useGameSocket", () => ({ useGameSocket: useGameSocketMock }));

const joinedCredentials = {
  roomCode: "AB7K2",
  playerId: "guest-1",
  playerToken: "guest-token",
  isHost: false,
  wsPath: "/api/ws/rooms/AB7K2",
};

describe("room route", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    readSessionMock.mockReset();
    useGameSocketMock.mockClear();
    joinRoomMock.mockReset();
    getRoomMock.mockReset();
    getRoomMock.mockResolvedValue(gameRoomFixture({ mode: "friends" }));
    saveSessionMock.mockReset();
  });

  it("starts the room socket from a stored session and reports reconnecting", () => {
    readSessionMock.mockReturnValue({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "token-1",
      isHost: true,
    });
    useGameStore.setState({ connectionState: "reconnecting" });

    render(<RoomPageClient code="ab7k2" />);

    expect(useGameSocketMock).toHaveBeenCalledWith("AB7K2");
    expect(screen.getByText("Reconectando… Conservamos tu asiento.")).toBeInTheDocument();
  });

  it("renders a storage-independent loading state before browser hydration", () => {
    readSessionMock.mockReturnValue({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "token-1",
      isHost: true,
    });

    const html = renderToString(<RoomPageClient code="AB7K2" />);

    expect(html).toContain("Preparando la sala");
    expect(readSessionMock).not.toHaveBeenCalled();
  });

  it("opens an invite without a saved session in join mode with its code prefilled", async () => {
    readSessionMock.mockReturnValue(null);

    render(<RoomPageClient code="ab7k2" />);

    expect(await screen.findByRole("button", { name: "Unirse a partida" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Código de sala")).toHaveValue("AB7K2");
    expect(useGameSocketMock).not.toHaveBeenCalled();
  });

  it("does not offer to join when the room lookup fails", async () => {
    readSessionMock.mockReturnValue(null);
    getRoomMock.mockRejectedValue(new Error("Room service unavailable"));

    render(<RoomPageClient code="AB7K2" />);

    expect(await screen.findByRole("heading", { name: "No pudimos verificar la sala" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Unirse a partida" })).not.toBeInTheDocument();
    expect(joinRoomMock).not.toHaveBeenCalled();
    expect(useGameSocketMock).not.toHaveBeenCalled();
  });

  it("does not offer the join form when an unsaved practice room is opened", async () => {
    readSessionMock.mockReturnValue(null);
    getRoomMock.mockResolvedValue(
      gameRoomFixture({ mode: "practice", status: "playing" }),
    );

    render(<RoomPageClient code="AB7K2" />);

    expect(await screen.findByRole("heading", { name: "Esta sala es de práctica" })).toBeVisible();
    expect(screen.getByText(/sesión guardada/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Unirse a partida" })).not.toBeInTheDocument();
    expect(useGameSocketMock).not.toHaveBeenCalled();
  });

  it("enters the lobby after joining from a first-time invitation", async () => {
    readSessionMock.mockReturnValue(null);
    joinRoomMock.mockResolvedValue(joinedCredentials);
    render(<RoomPageClient code="AB7K2" />);

    fireEvent.change(await screen.findByLabelText("Tu nombre"), {
      target: { value: "Ana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));

    expect(await screen.findByRole("heading", { name: "Preparando la mesa" })).toBeInTheDocument();
    expect(joinRoomMock).toHaveBeenCalledWith("AB7K2", { displayName: "Ana" });
    expect(saveSessionMock).toHaveBeenCalledWith(joinedCredentials);
    expect(useGameSocketMock).toHaveBeenCalledWith("AB7K2");
  });

  it("switches the room route from lobby to the game only after authoritative sync", async () => {
    readSessionMock.mockReturnValue({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "token-1",
      isHost: true,
    });
    render(<RoomPageClient code="AB7K2" />);

    act(() =>
      useGameStore.getState().applyEvent(
        gameSyncEvent({
          stateVersion: 9,
          room: gameRoomFixture({
            status: "playing",
            stateVersion: 9,
            gameState: gameStateFixture(),
          }),
        }),
      ),
    );

    expect(await screen.findByRole("heading", { name: /mesa de juego/i })).toBeInTheDocument();
  });
});
