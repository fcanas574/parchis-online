"use client";

import Link from "next/link";
import type { GameSocketActions } from "@/hooks/useGameSocket";
import { useGameStore, type ConnectionState } from "@/stores/gameStore";
import { Card } from "@/components/ui/card";
import { PlayerList } from "./PlayerList";
import { RoomInvite } from "./RoomInvite";
import { cn } from "@/lib/utils";
import { GameSettings } from "@/components/game/GameSettings";
import { DEFAULT_PLAYER_PREFERENCES, type PlayerPreferences } from "@/lib/player-preferences";

const connectionCopy: Record<ConnectionState, string> = {
  idle: "Preparando la sala…",
  connecting: "Conectando con la sala…",
  connected: "Sala sincronizada",
  reconnecting: "Reconectando… Conservamos tu asiento.",
  disconnected: "Sin conexión. Intentaremos reconectar.",
  error: "La conexión necesita atención.",
};

export function Lobby({
  roomCode,
  actions,
  preferences = DEFAULT_PLAYER_PREFERENCES,
  onPreferencesChange = () => undefined,
}: {
  roomCode: string;
  actions: Pick<GameSocketActions, "sendReady" | "sendStartGame">;
  preferences?: PlayerPreferences;
  onPreferencesChange?: (preferences: PlayerPreferences) => void;
}) {
  const room = useGameStore((state) => state.room);
  const session = useGameStore((state) => state.session);
  const connectionState = useGameStore((state) => state.connectionState);
  const lastError = useGameStore((state) => state.lastError);
  const { sendReady, sendStartGame } = actions;
  const authenticationFailed = lastError?.code === "UNAUTHENTICATED";

  const bannerCopy = authenticationFailed
    ? "No pudimos autenticar esta sesión. Vuelve al inicio para entrar de nuevo."
    : connectionCopy[connectionState];

  const connectionBanner = (
    <div
      className={cn(
        "connection-banner",
        connectionState === "connected" && "connection-banner-success",
        (connectionState === "reconnecting" || connectionState === "connecting") &&
          "connection-banner-warning",
        (connectionState === "error" || authenticationFailed) && "connection-banner-error",
      )}
      role={authenticationFailed ? "alert" : "status"}
    >
      <span className="connection-dot" aria-hidden="true" />
      <span>{bannerCopy}</span>
      {authenticationFailed ? (
        <Link className="inline-link ml-auto" href="/">
          Volver al inicio
        </Link>
      ) : null}
    </div>
  );

  if (!room || room.roomCode !== roomCode) {
    return (
      <main className="app-shell lobby-shell">
        <div className="lobby-stage">
          {connectionBanner}
          <Card className="waiting-panel">
            <p className="eyebrow">Sala {roomCode}</p>
            <h1>Preparando la mesa</h1>
            <p>Esperando el estado de la sala…</p>
          </Card>
        </div>
      </main>
    );
  }

  if (room.status !== "lobby") {
    return (
      <main className="app-shell lobby-shell">
        <div className="lobby-stage">
          {connectionBanner}
          <Card className="phase-panel" role="status">
            <p className="eyebrow">Sala {roomCode}</p>
            <h1>Sincronizando la partida</h1>
            <p>La sala ya comenzó. Estamos recuperando el estado actual del tablero…</p>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell lobby-shell">
      <div className="lobby-stage">
        {connectionBanner}
        <header className="lobby-header">
          <div>
            <p className="eyebrow">Mesa privada</p>
            <h1>Sala {roomCode}</h1>
            <p>Que todos encuentren su asiento, marquen listo y empiece la partida.</p>
          </div>
          <GameSettings preferences={preferences} onChange={onPreferencesChange} />
        </header>
        <RoomInvite roomCode={roomCode} />
        <PlayerList
          room={room}
          currentPlayerId={session?.playerId ?? null}
          socketConnected={connectionState === "connected"}
          onReady={sendReady}
          onStart={sendStartGame}
        />
      </div>
    </main>
  );
}
