"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LandingPage } from "@/components/home/LandingPage";
import { GameTable } from "@/components/game/GameTable";
import { Lobby } from "@/components/lobby/Lobby";
import { Card } from "@/components/ui/card";
import { useGameSocket } from "@/hooks/useGameSocket";
import { getRoom } from "@/lib/api";
import { readSession, type RoomSession } from "@/lib/session";
import { useGameStore } from "@/stores/gameStore";

function RoomSessionSurface({
  roomCode,
  session,
}: {
  roomCode: string;
  session: RoomSession;
}) {
  const actions = useGameSocket(roomCode);
  const room = useGameStore((state) =>
    state.room?.roomCode === roomCode ? state.room : null,
  );
  const connectionState = useGameStore((state) => state.connectionState);
  const lastError = useGameStore((state) => state.lastError);
  const rollEvent = useGameStore((state) =>
    state.recentEvents.findLast(
      (event) => event.type === "DICE_ROLLED" && event.roomCode === roomCode,
    ),
  );
  const recentEvents = useGameStore((state) => state.recentEvents);

  if (
    room?.gameState &&
    (room.status === "playing" || room.status === "finished")
  ) {
    return (
      <GameTable
        room={room}
        game={room.gameState}
        currentPlayerId={session.playerId}
        actions={actions}
        connectionState={connectionState}
        authenticationFailed={lastError?.code === "UNAUTHENTICATED"}
        rollEvent={rollEvent?.type === "DICE_ROLLED" ? rollEvent : undefined}
        events={recentEvents}
      />
    );
  }

  return <Lobby roomCode={roomCode} actions={actions} />;
}

export function RoomPageClient({ code }: { code: string }) {
  const roomCode = code.toUpperCase();
  const [resolvedRoom, setResolvedRoom] = useState<{
    roomCode: string;
    session: RoomSession | null;
    mode: "friends" | "practice" | "unavailable" | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    document.title = `Sala ${roomCode} — Parchís Online`;
    const session = readSession(roomCode);
    if (session) {
      useGameStore.getState().setSession(session);
      setResolvedRoom({ roomCode, session, mode: null });
    } else {
      void getRoom(roomCode).then(
        (room) => {
          if (!cancelled) setResolvedRoom({ roomCode, session: null, mode: room.mode });
        },
        () => {
          if (!cancelled) setResolvedRoom({ roomCode, session: null, mode: "unavailable" });
        },
      );
    }
    return () => {
      cancelled = true;
    };
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
    if (resolvedRoom.mode === "practice") {
      return (
        <main className="app-shell missing-session-shell">
          <Card className="missing-session-card">
            <p className="eyebrow">Sala {roomCode} · modo de práctica</p>
            <h1>Esta sala es de práctica</h1>
            <p>Para volver a esta partida necesitas la sesión guardada en el dispositivo donde la creaste.</p>
            <Link className="home-link" href="/">
              Volver al inicio
            </Link>
          </Card>
        </main>
      );
    }

    if (resolvedRoom.mode === "unavailable") {
      return (
        <main className="app-shell missing-session-shell">
          <Card className="missing-session-card">
            <p className="eyebrow">Sala {roomCode}</p>
            <h1>No pudimos verificar la sala</h1>
            <p>Revisa tu conexión e inténtalo de nuevo. Solo podrás unirte cuando confirmemos que la sala está disponible.</p>
            <Link className="home-link" href="/">
              Volver al inicio
            </Link>
          </Card>
        </main>
      );
    }

    return (
      <LandingPage
        initialMode="join"
        initialRoomCode={roomCode}
        onSessionSaved={(session) => {
          useGameStore.getState().setSession(session);
          setResolvedRoom({ roomCode, session, mode: resolvedRoom.mode });
        }}
      />
    );
  }

  return <RoomSessionSurface roomCode={roomCode} session={resolvedRoom.session} />;
}
