import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/social/ChatPanel";
import type { ChatMessage } from "@/types/game";

const message = (index: number): ChatMessage => ({
  messageId: `message-${index}`,
  playerId: `player-${index}`,
  displayName: `Jugador ${index}`,
  text: `Mensaje ${index}`,
  sentAt: `2026-10-01T12:${String(index % 60).padStart(2, "0")}:00Z`,
});

function ChatHarness({
  messages = [],
  onSendMessage = vi.fn(() => true),
  historyReady = true,
}: {
  messages?: ChatMessage[];
  onSendMessage?: (text: string) => boolean | void;
  historyReady?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ChatPanel
      messages={messages}
      isOpen={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      onSendMessage={onSendMessage}
      historyReady={historyReady}
    />
  );
}

describe("ChatPanel", () => {
  it("starts folded and opens as an overlay without changing its surrounding layout", () => {
    const { container } = render(<ChatHarness />);

    const toggle = screen.getByRole("button", { name: "Abrir chat" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("#game-chat-panel")).toHaveAttribute("hidden");

    fireEvent.click(toggle);

    const panel = screen.getByRole("region", { name: "Chat de la partida" });
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).toHaveClass("social-chat-overlay");
  });

  it("shows the latest 50 messages as plain text with player and server time", () => {
    const messages = Array.from({ length: 51 }, (_, index) => message(index));
    messages[50] = { ...message(50), text: "<b>texto literal</b>" };
    render(<ChatHarness messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat" }));

    const log = screen.getByRole("log", { name: "Mensajes de la partida" });
    expect(within(log).getAllByRole("listitem")).toHaveLength(50);
    expect(within(log).getByText("<b>texto literal</b>")).toBeInTheDocument();
    expect(log.querySelector("b")).toBeNull();
    expect(within(log).getByText("Jugador 50")).toBeInTheDocument();
    expect(within(log).getByText(/12:50/)).toBeInTheDocument();
  });

  it("submits only after the socket accepts the command and does not add an optimistic message", () => {
    const onSendMessage = vi.fn(() => false);
    render(<ChatHarness messages={[message(1)]} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Escribe un mensaje" }), {
      target: { value: "Hola, amigos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(onSendMessage).toHaveBeenCalledWith("Hola, amigos");
    expect(screen.getByRole("alert")).toHaveTextContent("No se envió");
    expect(screen.getByRole("textbox", { name: "Escribe un mensaje" })).toHaveValue("Hola, amigos");
    expect(within(screen.getByRole("log", { name: "Mensajes de la partida" })).queryByText("Hola, amigos")).not.toBeInTheDocument();
  });

  it("rejects text over 280 characters and keeps keyboard close/focus restoration", () => {
    const onSendMessage = vi.fn(() => true);
    const { container } = render(<ChatHarness onSendMessage={onSendMessage} />);
    const toggle = screen.getByRole("button", { name: "Abrir chat" });
    fireEvent.click(toggle);

    const composer = screen.getByRole("textbox", { name: "Escribe un mensaje" });
    expect(composer).toHaveFocus();
    expect(composer).toHaveClass("resize-none");
    fireEvent.change(composer, { target: { value: "x".repeat(281) } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("280");

    fireEvent.keyDown(composer, { key: "Escape" });
    expect(container.querySelector("#game-chat-panel")).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Abrir chat" })).toHaveFocus();
  });

  it("announces a compact unread count while closed and clears it when opened", () => {
    const { rerender } = render(<ChatHarness messages={[message(1)]} />);
    rerender(<ChatHarness messages={[message(1), message(2), message(3)]} />);

    const toggle = screen.getByRole("button", { name: /Abrir chat/ });
    expect(toggle).toHaveTextContent("2");
    fireEvent.click(toggle);
    expect(document.querySelector(".social-chat-trigger")).not.toHaveTextContent("2");
  });

  it("does not count restored history as new unread messages", () => {
    const { rerender } = render(<ChatHarness historyReady={false} />);
    rerender(<ChatHarness historyReady messages={[message(1), message(2)]} />);
    expect(screen.getByRole("button", { name: "Abrir chat" })).not.toHaveTextContent("2");

    rerender(<ChatHarness historyReady messages={[message(1), message(2), message(3)]} />);
    expect(screen.getByRole("button", { name: /Abrir chat, 1 sin leer/ })).toHaveTextContent("1");
  });
});
