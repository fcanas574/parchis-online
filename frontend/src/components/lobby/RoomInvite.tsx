"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type CopyState = "idle" | "copied" | "error";

export function RoomInvite({ roomCode }: { roomCode: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomPath = `/room/${roomCode}`;
  const invitation = useMemo(
    () => (typeof window === "undefined" ? roomPath : new URL(roomPath, window.location.origin).toString()),
    [roomPath],
  );

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copyInvitation = async () => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(invitation);
      setCopyState("copied");
      resetTimerRef.current = setTimeout(() => {
        setCopyState("idle");
        resetTimerRef.current = null;
      }, 2_000);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <Card className="invite-card">
      <div>
        <p className="eyebrow">Código de la sala</p>
        <p className="room-code-display">{roomCode}</p>
      </div>
      <div className="invite-copy-area">
        <label className="field-label" htmlFor="invitation-link">
          Invitación
        </label>
        <div className="invite-copy-row">
          <input
            id="invitation-link"
            className="invite-link"
            readOnly
            value={roomPath}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button onClick={copyInvitation} variant="secondary">
            {copyState === "copied" ? "Copiado" : "Copiar invitación"}
          </Button>
        </div>
        <div className="copy-feedback" aria-live="polite">
          {copyState === "error" ? (
            <p role="alert">No se pudo copiar. Selecciona el enlace y cópialo manualmente.</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
