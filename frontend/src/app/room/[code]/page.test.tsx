import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "@/stores/gameStore";
import { RoomPageClient } from "./RoomPageClient";

const {
  readSessionMock,
  useGameSocketMock,
  routerPushMock,
  joinRoomMock,
  saveSessionMock,
} = vi.hoisted(() => ({
  readSessionMock: vi.fn(),
  useGameSocketMock: vi.fn(() => ({
    sendReady: vi.fn(),
    sendStartGame: vi.fn(),
  })),
  routerPushMock: vi.fn(),
  joinRoomMock: vi.fn(),
  saveSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPushMock }) }));
vi.mock("@/lib/session", () => ({
  readSession: readSessionMock,
  saveSession: saveSessionMock,
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, joinRoom: joinRoomMock };
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

  it("opens an invite without a saved session in join mode with its code prefilled", () => {
    readSessionMock.mockReturnValue(null);

    render(<RoomPageClient code="ab7k2" />);

    expect(
      screen.getByRole("button", { name: "Unirse a partida" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Código de sala")).toHaveValue("AB7K2");
    expect(useGameSocketMock).not.toHaveBeenCalled();
  });

  it("enters the lobby after joining from a first-time invitation", async () => {
    readSessionMock.mockReturnValue(null);
    joinRoomMock.mockResolvedValue(joinedCredentials);
    render(<RoomPageClient code="AB7K2" />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Ana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));

    expect(await screen.findByRole("heading", { name: "Preparando la mesa" })).toBeInTheDocument();
    expect(joinRoomMock).toHaveBeenCalledWith("AB7K2", { displayName: "Ana" });
    expect(saveSessionMock).toHaveBeenCalledWith(joinedCredentials);
    expect(useGameSocketMock).toHaveBeenCalledWith("AB7K2");
  });
});
