import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomCredentials } from "@/types/game";
import { LandingPage } from "./LandingPage";

const { createRoomMock, joinRoomMock, pushMock, saveSessionMock } = vi.hoisted(() => ({
  createRoomMock: vi.fn(),
  joinRoomMock: vi.fn(),
  pushMock: vi.fn(),
  saveSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createRoom: createRoomMock, joinRoom: joinRoomMock };
});

vi.mock("@/lib/session", () => ({ saveSession: saveSessionMock }));

const credentials: RoomCredentials = {
  roomCode: "AB7K2",
  playerId: "player-1",
  playerToken: "token-1",
  isHost: true,
  wsPath: "/api/ws/rooms/AB7K2",
};

describe("LandingPage", () => {
  beforeEach(() => {
    createRoomMock.mockReset();
    joinRoomMock.mockReset();
    pushMock.mockReset();
    saveSessionMock.mockReset();
  });

  it("creates a room with the selected name, player count, and color", async () => {
    createRoomMock.mockResolvedValue(credentials);
    render(<LandingPage />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Felipe" },
    });
    fireEvent.click(screen.getByLabelText("5 jugadores"));
    fireEvent.click(screen.getByLabelText("Morado"));
    fireEvent.click(screen.getByRole("button", { name: "Crear sala" }));

    await waitFor(() => {
      expect(createRoomMock).toHaveBeenCalledWith({
        displayName: "Felipe",
        playerCount: 5,
        color: "purple",
      });
    });
    expect(saveSessionMock).toHaveBeenCalledWith(credentials);
    expect(pushMock).toHaveBeenCalledWith("/room/AB7K2");
  });

  it("opens the discreet practice route only on the fifth quick emblem activation", () => {
    render(<LandingPage />);

    const emblem = screen.getByRole("button", { name: /práctica.*cinco toques/i });
    expect(emblem.tagName).toBe("BUTTON");
    for (let activation = 0; activation < 4; activation += 1) {
      fireEvent.click(emblem);
    }
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(emblem);
    expect(pushMock).toHaveBeenCalledExactlyOnceWith("/practice");
  });

  it("resets the hidden practice sequence after two seconds", () => {
    vi.useFakeTimers();
    try {
      render(<LandingPage />);
      const emblem = screen.getByRole("button", { name: /práctica.*cinco toques/i });

      for (let activation = 0; activation < 4; activation += 1) {
        fireEvent.click(emblem);
      }
      act(() => vi.advanceTimersByTime(2_001));
      fireEvent.click(emblem);
      expect(pushMock).not.toHaveBeenCalled();

      for (let activation = 0; activation < 4; activation += 1) {
        fireEvent.click(emblem);
      }
      expect(pushMock).toHaveBeenCalledExactlyOnceWith("/practice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates once in Strict Mode and leaves the friend-room controls visible", () => {
    render(
      <StrictMode>
        <LandingPage />
      </StrictMode>,
    );

    expect(screen.getByRole("button", { name: "Crear partida" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Unirse a partida" })).toBeVisible();
    const emblem = screen.getByRole("button", { name: /práctica.*cinco toques/i });
    for (let activation = 0; activation < 6; activation += 1) {
      fireEvent.click(emblem);
    }
    expect(pushMock).toHaveBeenCalledExactlyOnceWith("/practice");
  });

  it("normalizes a join code to uppercase before joining", async () => {
    joinRoomMock.mockResolvedValue({ ...credentials, isHost: false });
    render(<LandingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Unirse a partida" }));
    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText("Código de sala"), {
      target: { value: "ab7k2" },
    });
    fireEvent.click(screen.getByLabelText("Azul"));
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));

    await waitFor(() => {
      expect(joinRoomMock).toHaveBeenCalledWith("AB7K2", {
        displayName: "Ana",
        color: "blue",
      });
    });
    expect(saveSessionMock).toHaveBeenCalledWith({ ...credentials, isHost: false });
    expect(pushMock).toHaveBeenCalledWith("/room/AB7K2");
  });

  it("preserves create values and stores no session after an API error", async () => {
    createRoomMock.mockRejectedValue({
      code: "COLOR_UNAVAILABLE",
      message: "That color is already taken.",
    });
    render(<LandingPage />);

    const name = screen.getByLabelText<HTMLInputElement>("Tu nombre");
    fireEvent.change(name, { target: { value: "Lucía" } });
    fireEvent.click(screen.getByLabelText("6 jugadores"));
    fireEvent.click(screen.getByLabelText("Naranja"));
    fireEvent.click(screen.getByRole("button", { name: "Crear sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "COLOR_UNAVAILABLE: That color is already taken.",
    );
    expect(name).toHaveValue("Lucía");
    expect(screen.getByLabelText("6 jugadores")).toBeChecked();
    expect(screen.getByLabelText("Naranja")).toBeChecked();
    expect(screen.getByRole("button", { name: "Crear sala" })).toBeEnabled();
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("associates an invalid create name with its inline validation error", () => {
    render(<LandingPage />);

    const name = screen.getByLabelText<HTMLInputElement>("Tu nombre");
    fireEvent.change(name, { target: { value: "F" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala" }));

    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", "create-name-error");
    expect(document.getElementById("create-name-error")).toHaveTextContent(
      "El nombre debe tener entre 2 y 20 caracteres.",
    );
  });

  it("associates an invalid join code with its inline validation error", () => {
    render(<LandingPage initialMode="join" initialRoomCode="BAD" />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Ana" },
    });
    const code = screen.getByLabelText<HTMLInputElement>("Código de sala");
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));

    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "room-code-error");
    expect(document.getElementById("room-code-error")).toHaveTextContent(
      "El código debe tener 5 letras o números.",
    );
  });

  it("blocks duplicate room creation while the first request is pending", async () => {
    let resolveRequest!: (value: RoomCredentials) => void;
    createRoomMock.mockReturnValue(
      new Promise<RoomCredentials>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(<LandingPage />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "María" },
    });
    const submit = screen.getByRole("button", { name: "Crear sala" });
    fireEvent.click(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    fireEvent.click(submit);
    expect(createRoomMock).toHaveBeenCalledTimes(1);

    resolveRequest(credentials);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/room/AB7K2"));
  });

  it("clears pending state and shows API errors under React Strict Mode", async () => {
    createRoomMock.mockRejectedValue({
      code: "ROOM_UNAVAILABLE",
      message: "Try again.",
    });
    render(
      <StrictMode>
        <LandingPage />
      </StrictMode>,
    );

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Felipe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ROOM_UNAVAILABLE: Try again.",
    );
    expect(screen.getByRole("button", { name: "Crear sala" })).toBeEnabled();
  });

  it("ignores a successful room response after the form unmounts", async () => {
    let resolveRequest!: (value: RoomCredentials) => void;
    createRoomMock.mockReturnValue(
      new Promise<RoomCredentials>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { unmount } = render(<LandingPage />);

    fireEvent.change(screen.getByLabelText("Tu nombre"), {
      target: { value: "Felipe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala" }));
    unmount();

    await act(async () => resolveRequest(credentials));

    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
