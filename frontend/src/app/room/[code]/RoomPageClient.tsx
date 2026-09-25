"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lobby } from "@/components/lobby/Lobby";
import { Card } from "@/components/ui/card";
import { readSession, type RoomSession } from "@/lib/session";
import { useGameStore } from "@/stores/gameStore";

export function RoomPageClient({ code }: { code: string }) {
  const roomCode = code.toUpperCase();
  const [resolvedRoom, setResolvedRoom] = useState<{
    roomCode: string;
    session: RoomSession | null;
  } | null>(null);

  useEffect(() => {
    document.title = `Sala ${roomCode} — Parchís Online`;
    const session = readSession(roomCode);
    if (session) useGameStore.getState().setSession(session);
    setResolvedRoom({ roomCode, session });
  }, [roomCode]);

  if (!resolvedRoom || resolvedRoom.roomCode !== roomCode) {
    return (
      <main className="app-shell missing-session-shell">
        <Card className="missing-session-card" role="status" aria-busy="true">
          <p className="eyebrow">Sala {roomCode}</p>
          <h1>Preparando la sala</h1>
          <p>Comprobando la invitación guardada…</p>
        </Card>
      </main>
    );
  }

  if (!resolvedRoom.session) {
    return (
      <main className="app-shell missing-session-shell">
        <Card className="missing-session-card">
          <p className="eyebrow">Sala {roomCode}</p>
          <h1>Necesitas una invitación válida</h1>
          <p>
            No encontramos una sesión guardada para esta sala. Vuelve al inicio para crear una
            partida o entrar con el código.
          </p>
          <Link className="home-link" href="/">
            Volver al inicio
          </Link>
        </Card>
      </main>
    );
  }

  return <Lobby roomCode={roomCode} />;
}
