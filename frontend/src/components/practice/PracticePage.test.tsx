import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomCredentials } from "@/types/game";
import { PracticePage } from "./PracticePage";

const { createPracticeRoomMock, pushMock, saveSessionMock } = vi.hoisted(() => ({
  createPracticeRoomMock: vi.fn(),
  pushMock: vi.fn(),
  saveSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createPracticeRoom: createPracticeRoomMock };
});

vi.mock("@/lib/session", () => ({ saveSession: saveSessionMock }));

const credentials: RoomCredentials = {
  roomCode: "AB7K2",
  playerId: "practice-host",
  playerToken: "practice-token",
  isHost: true,
  wsPath: "/api/ws/rooms/AB7K2",
};

describe("PracticePage", () => {
  beforeEach(() => {
    createPracticeRoomMock.mockReset();
    pushMock.mockReset();
    saveSessionMock.mockReset();
  });

  it("creates a practice, saves its credentials, and opens the game", async () => {
    createPracticeRoomMock.mockResolvedValue(credentials);
    render(<PracticePage />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Felipe" },
    });
    fireEvent.click(screen.getByLabelText("5 jugadores"));
    fireEvent.click(screen.getByLabelText("Morado"));
    fireEvent.click(screen.getByRole("button", { name: "Empezar práctica" }));

    await waitFor(() => {
      expect(createPracticeRoomMock).toHaveBeenCalledWith({
        displayName: "Felipe",
        playerCount: 5,
        color: "purple",
      });
    });
    expect(saveSessionMock).toHaveBeenCalledWith(credentials);
    expect(pushMock).toHaveBeenCalledWith("/room/AB7K2");
  });

  it("shows a disabled-practice error without saving or navigating", async () => {
    createPracticeRoomMock.mockRejectedValue({
      code: "PRACTICE_DISABLED",
      message: "Practice mode is disabled on this server.",
    });
    render(<PracticePage />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Ana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Empezar práctica" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PRACTICE_DISABLED: Practice mode is disabled on this server.",
    );
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
