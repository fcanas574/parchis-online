"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/types/game";

type ChatPanelProps = {
  messages: readonly ChatMessage[];
  isOpen: boolean;
  onToggle: () => void;
  onSendMessage: (text: string) => boolean | void;
  disabled?: boolean;
  historyReady?: boolean;
};

const MAX_MESSAGE_LENGTH = 280;
const MAX_UNREAD_BADGE = 99;

function serverTimeLabel(value: string) {
  const match = value.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? "";
}

export function ChatPanel({
  messages,
  isOpen,
  onToggle,
  onSendMessage,
  disabled = false,
  historyReady = true,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const wasOpenRef = useRef(false);
  const previousMessageIdsRef = useRef(new Set(messages.map((message) => message.messageId)));
  const wasHistoryReadyRef = useRef(historyReady);
  const latestMessages = messages.slice(-50);

  useEffect(() => {
    if (!historyReady) {
      previousMessageIdsRef.current = new Set(messages.map((message) => message.messageId));
      wasHistoryReadyRef.current = false;
      return;
    }
    if (!wasHistoryReadyRef.current) {
      previousMessageIdsRef.current = new Set(messages.map((message) => message.messageId));
      wasHistoryReadyRef.current = true;
      return;
    }

    const previousIds = previousMessageIdsRef.current;
    const addedCount = messages.reduce(
      (count, message) => count + (previousIds.has(message.messageId) ? 0 : 1),
      0,
    );
    previousMessageIdsRef.current = new Set(messages.map((message) => message.messageId));

    if (isOpen) {
      setUnreadCount(0);
    } else if (addedCount > 0) {
      setUnreadCount((count) => Math.min(MAX_UNREAD_BADGE, count + addedCount));
    }
  }, [historyReady, isOpen, messages]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      composerRef.current?.focus();
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onToggle]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || !text) return;
    if (draft.length > MAX_MESSAGE_LENGTH) {
      setSendError("El mensaje no puede superar los 280 caracteres.");
      return;
    }

    try {
      if (onSendMessage(text) === false) {
        setSendError("No se envió. Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
      setDraft("");
      setSendError(null);
    } catch {
      setSendError("No se envió. Revisa tu conexión e inténtalo de nuevo.");
    }
  };

  const unreadLabel = unreadCount > MAX_UNREAD_BADGE ? `${MAX_UNREAD_BADGE}+` : String(unreadCount);

  return (
    <div className="social-chat-control">
      <button
        ref={triggerRef}
        type="button"
        className="social-chat-trigger"
        aria-label={isOpen ? "Cerrar chat" : unreadCount ? `Abrir chat, ${unreadLabel} sin leer` : "Abrir chat"}
        aria-expanded={isOpen}
        aria-controls="game-chat-panel"
        onClick={() => {
          if (!isOpen) setUnreadCount(0);
          onToggle();
        }}
      >
        <span className="social-chat-trigger-icon" aria-hidden="true">▤</span>
        <span>Chat</span>
        {unreadCount > 0 && !isOpen ? (
          <span className="social-chat-unread" aria-hidden="true">{unreadLabel}</span>
        ) : null}
      </button>

      <section
        id="game-chat-panel"
        className="social-chat-overlay"
        role="region"
        aria-label="Chat de la partida"
        hidden={!isOpen}
      >
        <header className="social-chat-heading">
          <div>
            <p className="eyebrow">La mesa</p>
            <h2>Chat</h2>
          </div>
          <button
            type="button"
            className="social-chat-close"
            aria-label="Cerrar chat"
            onClick={onToggle}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <ol className="social-chat-messages" role="log" aria-label="Mensajes de la partida" aria-live="polite" aria-relevant="additions">
          {latestMessages.length ? latestMessages.map((message) => (
            <li className="social-chat-message" key={message.messageId}>
              <div className="social-chat-message-meta">
                <span className="social-chat-author">{message.displayName}</span>
                <time dateTime={message.sentAt}>{serverTimeLabel(message.sentAt)}</time>
              </div>
              <p>{message.text}</p>
            </li>
          )) : (
            <li className="social-chat-empty">Todavía no hay mensajes. Saluda a la mesa.</li>
          )}
        </ol>

        <form className="social-chat-composer" noValidate onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="game-chat-message">Escribe un mensaje</label>
          <textarea
            ref={composerRef}
            id="game-chat-message"
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            className="social-chat-input resize-none"
            placeholder={disabled ? "Chat no disponible" : "Escribe algo…"}
            value={draft}
            disabled={disabled}
            aria-describedby={sendError ? "game-chat-error" : "game-chat-limit"}
            onChange={(event) => {
              setDraft(event.target.value);
              setSendError(event.target.value.length > MAX_MESSAGE_LENGTH
                ? "El mensaje no puede superar los 280 caracteres."
                : null);
            }}
          />
          <button type="submit" className="social-chat-send" disabled={disabled || !draft.trim()} aria-label="Enviar mensaje">
            <span aria-hidden="true">↑</span>
          </button>
          <span id="game-chat-limit" className="social-chat-character-count">{draft.length}/{MAX_MESSAGE_LENGTH}</span>
          {sendError ? <p id="game-chat-error" className="social-chat-error" role="alert">{sendError}</p> : null}
        </form>
      </section>
    </div>
  );
}
