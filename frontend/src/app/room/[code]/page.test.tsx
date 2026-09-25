import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "@/stores/gameStore";
import { RoomPageClient } from "./RoomPageClient";

const { readSessionMock, useGameSocketMock } = vi.hoisted(() => ({
  readSessionMock: vi.fn(),
  useGameSocketMock: vi.fn(() => ({
    sendReady: vi.fn(),
    sendStartGame: vi.fn(),
  })),
}));

vi.mock("@/lib/session", () => ({ readSession: readSessionMock }));
vi.mock("@/hooks/useGameSocket", () => ({ useGameSocket: useGameSocketMock }));

describe("room route", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    readSessionMock.mockReset();
    useGameSocketMock.mockClear();
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

  it("offers a real home link and does not start a socket when the session is missing", () => {
    readSessionMock.mockReturnValue(null);

    render(<RoomPageClient code="AB7K2" />);

    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(useGameSocketMock).not.toHaveBeenCalled();
  });
});
