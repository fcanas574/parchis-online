import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Board } from "@/components/game/Board";
import { getBoardLayout } from "@/lib/board-layouts";
import { gameRoomFixture, gameStateFixture, gameWithLegalOptions } from "@/test/game-fixtures";
import type { MoveOption } from "@/types/game";

describe("Board", () => {
  it.each([4, 5, 6] as const)(
    "marks normal safe cells with stars and colors each %i-player start and home lane",
    (seatCount) => {
      const colors = ["green", "red", "blue", "yellow", "purple", "orange"] as const;
      const game = { ...gameWithLegalOptions([]), seatCount };
      const fixtureRoom = gameRoomFixture({ status: "playing", gameState: game });
      const players = Array.from({ length: seatCount }, (_, seatIndex) => {
        const existing = fixtureRoom.players[seatIndex % fixtureRoom.players.length];
        if (!existing) throw new Error("Fixture player is missing");
        return {
          ...existing,
          id: `p${seatIndex + 1}`,
          displayName: `Jugador ${seatIndex + 1}`,
          color: colors[seatIndex] ?? "green",
          seatIndex,
        };
      });
      const room = gameRoomFixture({
        status: "playing",
        gameState: game,
        maxPlayers: seatCount,
        players,
      });
      const layout = getBoardLayout(seatCount);

      const { container } = render(
        <Board
          room={room}
          game={game}
          currentPlayerId="p1"
          onSelectPiece={vi.fn()}
        />,
      );

      const stars = [...container.querySelectorAll("[data-safe-cell-star]")];
      const starts = [...container.querySelectorAll("[data-start-cell-seat]")];
      const finishCells = [...container.querySelectorAll("[data-finish-cell-seat]")];
      const centerWedges = [...container.querySelectorAll("[data-goal-wedge-seat]")];

      const safeStarLabels = {
        4: [12, 17, 29, 34, 46, 51, 63, 68],
        5: [12, 17, 29, 34, 46, 51, 63, 68, 80, 85],
        6: [12, 17, 29, 34, 46, 51, 63, 68, 80, 85, 97, 102],
      }[seatCount];
      expect(stars.map((star) => layout.trackCellLabels[Number(star.getAttribute("data-safe-cell-star"))])
        .sort((a, b) => a - b)).toEqual(safeStarLabels);
      expect(starts).toHaveLength(seatCount);
      expect(starts.every((start) => start.tagName.toLowerCase() === "polygon")).toBe(true);
      expect(finishCells).toHaveLength(seatCount * 7);
      expect(centerWedges).toHaveLength(seatCount);
      expect(container.querySelector("[data-board-paper]")).toHaveAttribute("fill", "var(--color-board-paper)");

      for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
        const expectedFill = `var(--color-piece-${colors[seatIndex]})`;
        expect(container.querySelector(`[data-start-cell-seat="${seatIndex}"]`)).toHaveAttribute("fill", expectedFill);
        expect(container.querySelector(`[data-finish-cell-seat="${seatIndex}"]`)).toHaveAttribute("fill", expectedFill);
        expect(container.querySelector(`[data-goal-wedge-seat="${seatIndex}"]`)).toHaveAttribute("fill", expectedFill);
      }
    },
  );

  it.each([4, 5, 6] as const)(
    "shows every numbered track cell for a %i-player game in the responsive board",
    (seatCount) => {
      const game = { ...gameWithLegalOptions([]), seatCount };
      const room = gameRoomFixture({ status: "playing", gameState: game });

      const { container } = render(
        <Board
          room={room}
          game={game}
          currentPlayerId="p1"
          onSelectPiece={vi.fn()}
        />,
      );

      const stage = screen.getByRole("group", { name: /tablero de parchís/i });
      const labels = [...container.querySelectorAll("svg [data-track-cell-number]")];

      expect(stage).toHaveStyle({ width: "min(100%, 48rem)", aspectRatio: "1" });
      expect(labels).toHaveLength(getBoardLayout(seatCount).trackCells.length);
      expect(labels[0]?.textContent).toBe("5");
      expect(labels[12]?.textContent).toBe("17");
      expect(labels[seatCount * 17 - 5]?.textContent).toBe(String(seatCount * 17));
      expect([...new Set(labels.map((label) => label.textContent))].length).toBe(seatCount * 17);
      expect(labels.every((label) => Number(label.getAttribute("font-size")) >= 30)).toBe(true);
    },
  );

  it("renders only server-authorized movable pieces as selectable", () => {
    const onSelect = vi.fn();
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const room = gameRoomFixture({ status: "playing", gameState: game });

    render(
      <Board
        room={room}
        game={game}
        currentPlayerId="p1"
        onSelectPiece={onSelect}
      />,
    );

    const selectable = screen.getByRole("button", {
      name: /Felipe.*ficha 2.*mover/i,
    });
    expect(selectable).toBeEnabled();
    expect(screen.getByRole("button", { name: "Felipe, ficha 1, en casa" })).toBeDisabled();
    expect(screen.getByRole("group", { name: /tablero de parchís/i })).toBeInTheDocument();

    fireEvent.click(selectable);
    expect(onSelect).toHaveBeenCalledWith("p1-piece-2", [0]);
  });

  it.each([4, 5, 6] as const)("rotates the %i-player board toward the local seat without changing logical piece positions", (seatCount) => {
    const game = { ...gameWithLegalOptions(["p2-piece-2"]), seatCount, currentPlayerId: "p2" };
    const room = gameRoomFixture({ status: "playing", gameState: game });
    const { container } = render(
      <Board room={room} game={game} currentPlayerId="p2" onSelectPiece={vi.fn()} />,
    );
    const rotor = container.querySelector(".parchis-board-rotor");
    expect(rotor).toHaveStyle({ transform: `rotate(${360 / seatCount}deg)` });
    expect(container.querySelector('[data-track-cell="17"]')?.parentElement?.querySelector('[data-track-cell-number]')).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: /Ana, ficha 2.*mover/i })).toBeEnabled();
  });

  it("keeps the piece number upright and announces its viewer-relative track cell", () => {
    const base = gameStateFixture();
    const game = gameStateFixture({
      currentPlayerId: "p2",
      pieces: base.pieces.map((piece) => piece.id === "p2-piece-2"
        ? { ...piece, state: "track" as const, trackPosition: 17 }
        : piece),
    });
    const room = gameRoomFixture({ status: "playing", gameState: game });
    render(<Board room={room} game={game} currentPlayerId="p2" onSelectPiece={vi.fn()} />);

    const piece = screen.getByRole("button", { name: /Ana, ficha 2, en el recorrido, casilla 5/i });
    expect(piece.querySelector(".parchis-piece-token")).toHaveStyle({ transform: "rotate(-90deg)" });
  });

  it("renders a server-confirmed visual position while keeping legality authoritative", () => {
    const game = gameStateFixture({
      pieces: gameStateFixture().pieces.map((piece) => piece.id === "p1-piece-2"
        ? { ...piece, state: "track" as const, trackPosition: 12 }
        : piece),
    });
    const visualPieces = game.pieces.map((piece) => piece.id === "p1-piece-2"
      ? { ...piece, trackPosition: 11 }
      : piece);
    const room = gameRoomFixture({ status: "playing", gameState: game });

    render(
      <Board
        room={room}
        game={game}
        visualPieces={visualPieces}
        currentPlayerId="p1"
        onSelectPiece={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Felipe, ficha 2, en el recorrido, casilla 16/i })).toBeInTheDocument();
  });

  it("projects the same logical movement path for viewers seated at different orientations", () => {
    const baseGame = gameStateFixture();
    const path = [13, 14, 15];
    const logicalPositionsByViewer = new Map<string, string[]>();

    for (const viewerId of ["p1", "p2"]) {
      const projectedPath: string[] = [];
      const { container, rerender, unmount } = render(
        <Board
          room={gameRoomFixture({ status: "playing", gameState: baseGame })}
          game={baseGame}
          currentPlayerId={viewerId}
          onSelectPiece={vi.fn()}
        />,
      );

      for (const trackPosition of path) {
        const visualPieces = baseGame.pieces.map((piece) =>
          piece.id === "p1-piece-2"
            ? { ...piece, state: "track" as const, trackPosition }
            : piece,
        );
        rerender(
          <Board
            room={gameRoomFixture({ status: "playing", gameState: baseGame })}
            game={baseGame}
            visualPieces={visualPieces}
            currentPlayerId={viewerId}
            onSelectPiece={vi.fn()}
          />,
        );
        const piece = screen.getByRole("button", { name: /Felipe, ficha 2, en el recorrido/i });
        projectedPath.push(`${piece.style.left},${piece.style.top}`);
      }

      logicalPositionsByViewer.set(viewerId, projectedPath);
      const rotor = container.querySelector(".parchis-board-rotor");
      expect(rotor).toHaveStyle({ transform: viewerId === "p1" ? "rotate(0deg)" : "rotate(90deg)" });
      unmount();
    }

    expect(logicalPositionsByViewer.get("p1")).toEqual(logicalPositionsByViewer.get("p2"));
    expect(logicalPositionsByViewer.get("p1")).toHaveLength(path.length);
  });

  it("briefly accents a piece when its visual position reaches the goal", () => {
    vi.useFakeTimers();
    try {
      const game = gameStateFixture();
      const room = gameRoomFixture({ status: "playing", gameState: game });
      const atFinishPath = game.pieces.map((piece) => piece.id === "p1-piece-1"
        ? { ...piece, state: "finish_path" as const, finishProgress: 6 }
        : piece);
      const atGoal = atFinishPath.map((piece) => piece.id === "p1-piece-1"
        ? { ...piece, state: "finished" as const, trackPosition: null, finishProgress: null }
        : piece);
      const props = { room, game, currentPlayerId: "p1", onSelectPiece: vi.fn() };
      const { rerender, unmount } = render(<Board {...props} visualPieces={atFinishPath} />);
      const goalPiece = () => screen.getByRole("button", { name: /Felipe, ficha 1/i });
      expect(goalPiece()).not.toHaveClass("parchis-piece-goal-arrival");

      rerender(<Board {...props} visualPieces={atGoal} />);

      expect(goalPiece()).toHaveClass("parchis-piece-goal-arrival");
      expect(goalPiece().querySelector(".parchis-piece-token")).toHaveStyle({
        width: "clamp(12px, 1.8vw, 20px)",
        height: "clamp(12px, 1.8vw, 20px)",
      });
      act(() => vi.advanceTimersByTime(850));
      expect(goalPiece()).not.toHaveClass("parchis-piece-goal-arrival");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives colored start numbers a light outline for contrast", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({ status: "playing", gameState: game });
    const { container } = render(<Board room={room} game={game} currentPlayerId="p1" onSelectPiece={vi.fn()} />);
    const start = container.querySelector('[data-start-cell-seat="1"]')?.parentElement;
    expect(start?.querySelector('[data-track-cell-number]')).toHaveAttribute("stroke", "var(--color-board-paper)");
  });

  it("shows only the rolled values in a floating chooser anchored to the piece", () => {
    const onSelect = vi.fn();
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const [baseOption] = game.availableMoves;
    if (!baseOption) throw new Error("Fixture must include a legal move");
    const makeOption = (
      diceIndices: MoveOption["diceIndices"],
      steps: number,
    ): MoveOption => ({ ...baseOption, diceIndices, steps });
    const options = [makeOption([0], 5), makeOption([1], 2)];
    const gameWithChoices = { ...game, availableMoves: options };
    const room = gameRoomFixture({ status: "playing", gameState: gameWithChoices });

    render(
      <Board
        room={room}
        game={gameWithChoices}
        currentPlayerId="p1"
        onSelectPiece={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Felipe, ficha 2/i }));

    expect(onSelect).not.toHaveBeenCalled();
    const choices = screen.getByRole("group", {
      name: /opciones de movimiento para Felipe, ficha 2/i,
    });
    const stage = screen.getByRole("group", { name: /tablero de parchís/i });
    expect(stage).toContainElement(choices);
    expect(choices).toHaveStyle({ position: "absolute" });
    expect(choices.style.left).not.toBe("");
    expect(choices.style.top).not.toBe("");
    expect(choices).not.toHaveTextContent("Elige cómo mover la ficha");
    const moveWithSecondDie = within(choices).getByRole("button", {
      name: "Mover 2 casillas con dado 2",
    });
    expect(within(choices).getAllByRole("button")).toHaveLength(2);
    expect(within(choices).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "5",
      "2",
    ]);
    fireEvent.pointerDown(moveWithSecondDie);
    expect(screen.getByRole("group", { name: /opciones de movimiento/i })).toBeInTheDocument();
    fireEvent.click(moveWithSecondDie);

    expect(onSelect).toHaveBeenCalledWith("p1-piece-2", [1]);
  });

  it("closes the numeric chooser with Escape and restores focus to its piece", () => {
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const [baseOption] = game.availableMoves;
    if (!baseOption) throw new Error("Fixture must include a legal move");
    const makeOption = (
      diceIndices: MoveOption["diceIndices"],
      steps: number,
    ): MoveOption => ({ ...baseOption, diceIndices, steps });
    const gameWithChoices = {
      ...game,
      availableMoves: [
        makeOption([0], 5),
        makeOption([1], 2),
      ],
    };
    const room = gameRoomFixture({ status: "playing", gameState: gameWithChoices });

    render(
      <Board
        room={room}
        game={gameWithChoices}
        currentPlayerId="p1"
        onSelectPiece={vi.fn()}
      />,
    );

    const piece = screen.getByRole("button", { name: /Felipe, ficha 2/i });
    piece.focus();
    fireEvent.click(piece);
    const choice = screen.getByRole("button", { name: "Mover 2 casillas con dado 2" });
    choice.focus();
    fireEvent.keyDown(choice, { key: "Escape" });

    expect(screen.queryByRole("group", { name: /opciones de movimiento/i })).not.toBeInTheDocument();
    expect(piece).toHaveFocus();
  });

  it("moves focus into the numeric chooser when it opens", () => {
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const [baseOption] = game.availableMoves;
    if (!baseOption) throw new Error("Fixture must include a legal move");
    const gameWithChoices = {
      ...game,
      availableMoves: [
        { ...baseOption, diceIndices: [0] as MoveOption["diceIndices"], steps: 5 },
        { ...baseOption, diceIndices: [1] as MoveOption["diceIndices"], steps: 2 },
      ],
    };
    const room = gameRoomFixture({ status: "playing", gameState: gameWithChoices });

    render(
      <Board
        room={room}
        game={gameWithChoices}
        currentPlayerId="p1"
        onSelectPiece={vi.fn()}
      />,
    );

    const piece = screen.getByRole("button", { name: /Felipe, ficha 2/i });
    piece.focus();
    fireEvent.click(piece);

    expect(screen.getByRole("button", { name: "Mover 5 casillas con dado 1" })).toHaveFocus();
  });

  it("dismisses the numeric chooser when the board outside the piece is tapped", () => {
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const [baseOption] = game.availableMoves;
    if (!baseOption) throw new Error("Fixture must include a legal move");
    const gameWithChoices = {
      ...game,
      availableMoves: [
        { ...baseOption, diceIndices: [0] as MoveOption["diceIndices"], steps: 5 },
        { ...baseOption, diceIndices: [1] as MoveOption["diceIndices"], steps: 2 },
      ],
    };
    const room = gameRoomFixture({ status: "playing", gameState: gameWithChoices });

    render(
      <Board
        room={room}
        game={gameWithChoices}
        currentPlayerId="p1"
        onSelectPiece={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Felipe, ficha 2/i }));
    const stage = screen.getByRole("group", { name: /tablero de parchís/i });
    fireEvent.pointerDown(stage);

    expect(screen.queryByRole("group", { name: /opciones de movimiento/i })).not.toBeInTheDocument();
  });

  it("does not enable a legal piece while it belongs to another player's turn", () => {
    const game = {
      ...gameWithLegalOptions(["p1-piece-2"]),
      currentPlayerId: "p2",
    };
    const room = gameRoomFixture({ status: "playing", gameState: game });

    render(
      <Board
        room={room}
        game={game}
        currentPlayerId="p1"
        onSelectPiece={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Felipe, ficha 2.*movimiento posible/ })).toBeDisabled();
  });

  it("disables legal piece controls while the room socket is not ready", () => {
    const game = gameWithLegalOptions(["p1-piece-2"]);
    const room = gameRoomFixture({ status: "playing", gameState: game });

    render(
      <Board
        room={room}
        game={game}
        currentPlayerId="p1"
        interactionEnabled={false}
        onSelectPiece={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Felipe, ficha 2.*movimiento posible/i })).toBeDisabled();
  });
});
