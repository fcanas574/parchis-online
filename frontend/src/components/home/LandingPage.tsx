"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "@/lib/api";
import { saveSession } from "@/lib/session";
import type { PlayerColor, RoomCredentials } from "@/types/game";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const colors: Array<{ value: PlayerColor; label: string }> = [
  { value: "green", label: "Verde" },
  { value: "red", label: "Rojo" },
  { value: "blue", label: "Azul" },
  { value: "yellow", label: "Amarillo" },
  { value: "purple", label: "Morado" },
  { value: "orange", label: "Naranja" },
];

type Mode = "create" | "join";

const errorMessage = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "No pudimos completar la solicitud. Inténtalo de nuevo.";
};

function ColorChoices({
  name,
  value,
  onChange,
  optional = false,
}: {
  name: string;
  value: PlayerColor | "";
  onChange: (value: PlayerColor | "") => void;
  optional?: boolean;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="field-label">{optional ? "Color (opcional)" : "Elige tu color"}</legend>
      <div className="color-choice-grid">
        {optional ? (
          <label className="color-choice color-choice-any">
            <input
              className="choice-input"
              type="radio"
              name={name}
              value=""
              checked={value === ""}
              onChange={() => onChange("")}
            />
            <span className="choice-label">Cualquiera</span>
          </label>
        ) : null}
        {colors.map((color) => (
          <label className="color-choice" key={color.value}>
            <input
              className="choice-input"
              type="radio"
              name={name}
              value={color.value}
              checked={value === color.value}
              onChange={() => onChange(color.value)}
            />
            <span className="choice-label">
              <span
                aria-hidden="true"
                className="piece-swatch"
                style={{ backgroundColor: `var(--color-piece-${color.value})` }}
              />
              {color.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function LandingPage() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const createNameRef = useRef<HTMLInputElement>(null);
  const joinNameRef = useRef<HTMLInputElement>(null);
  const roomCodeRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("create");
  const [createName, setCreateName] = useState("");
  const [playerCount, setPlayerCount] = useState<4 | 5 | 6>(4);
  const [createColor, setCreateColor] = useState<PlayerColor>("green");
  const [joinName, setJoinName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinColor, setJoinColor] = useState<PlayerColor | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginRequest = () => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    return true;
  };

  const endRequest = () => {
    pendingRef.current = false;
    if (mountedRef.current) setPending(false);
  };

  const complete = (credentials: RoomCredentials) => {
    saveSession(credentials);
    router.push(`/room/${credentials.roomCode.toUpperCase()}`);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!beginRequest()) return;
    const displayName = createName.trim();
    if (displayName.length < 2 || displayName.length > 20) {
      setError("El nombre debe tener entre 2 y 20 caracteres.");
      createNameRef.current?.focus();
      endRequest();
      return;
    }
    try {
      const credentials = await createRoom({ displayName, playerCount, color: createColor });
      if (mountedRef.current) complete(credentials);
    } catch (requestError) {
      if (mountedRef.current) setError(errorMessage(requestError));
    } finally {
      endRequest();
    }
  };

  const submitJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!beginRequest()) return;
    const displayName = joinName.trim();
    const normalizedCode = roomCode.trim().toUpperCase();
    if (displayName.length < 2 || displayName.length > 20) {
      setError("El nombre debe tener entre 2 y 20 caracteres.");
      joinNameRef.current?.focus();
      endRequest();
      return;
    }
    if (!/^[A-Z0-9]{5}$/.test(normalizedCode)) {
      setError("El código debe tener 5 letras o números.");
      roomCodeRef.current?.focus();
      endRequest();
      return;
    }
    try {
      const credentials = await joinRoom(normalizedCode, {
        displayName,
        ...(joinColor ? { color: joinColor } : {}),
      });
      if (mountedRef.current) complete(credentials);
    } catch (requestError) {
      if (mountedRef.current) setError(errorMessage(requestError));
    } finally {
      endRequest();
    }
  };

  const selectMode = (nextMode: Mode) => {
    if (pending) return;
    setMode(nextMode);
    setError(null);
  };

  return (
    <main className="app-shell landing-shell">
      <section className="landing-stage" aria-labelledby="landing-title">
        <div className="landing-intro">
          <div className="room-seal" aria-hidden="true">
            {colors.map((color) => (
              <span
                key={color.value}
                style={{ backgroundColor: `var(--color-piece-${color.value})` }}
              />
            ))}
          </div>
          <p className="eyebrow">Mesa privada · 4–6 amigos</p>
          <h1 id="landing-title" className="display-title">
            PARCHÍS ONLINE
          </h1>
          <p className="landing-lede">Jugar con amigos en una sala privada</p>
          <p className="landing-note">
            Elige tu ficha, comparte el código y prepara la mesa. Sin cuentas ni salas públicas.
          </p>
        </div>

        <Card className="task-card">
          <div className="mode-switch" aria-label="Elige cómo entrar">
            <Button
              aria-pressed={mode === "create"}
              className="flex-1"
              onClick={() => selectMode("create")}
              variant={mode === "create" ? "primary" : "ghost"}
            >
              Crear partida
            </Button>
            <Button
              aria-pressed={mode === "join"}
              className="flex-1"
              onClick={() => selectMode("join")}
              variant={mode === "join" ? "primary" : "ghost"}
            >
              Unirse a partida
            </Button>
          </div>

          {mode === "create" ? (
            <form className="room-form" noValidate onSubmit={submitCreate}>
              <div className="space-y-2">
                <label className="field-label" htmlFor="create-name">
                  Tu nombre
                </label>
                <Input
                  ref={createNameRef}
                  id="create-name"
                  autoComplete="nickname"
                  maxLength={20}
                  required
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </div>

              <fieldset className="space-y-2.5">
                <legend className="field-label">Cantidad de jugadores</legend>
                <div className="count-choice-grid">
                  {([4, 5, 6] as const).map((count) => (
                    <label className="count-choice" key={count}>
                      <input
                        className="choice-input"
                        type="radio"
                        name="player-count"
                        value={count}
                        checked={playerCount === count}
                        onChange={() => setPlayerCount(count)}
                      />
                      <span className="choice-label">{count} jugadores</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <ColorChoices
                name="create-color"
                value={createColor}
                onChange={(color) => color && setCreateColor(color)}
              />

              <div className="form-feedback" aria-live="polite">
                {error ? <p role="alert">{error}</p> : null}
              </div>
              <Button
                aria-busy={pending}
                className="w-full"
                disabled={pending}
                size="lg"
                type="submit"
              >
                {pending ? "Creando sala…" : "Crear sala"}
              </Button>
            </form>
          ) : (
            <form className="room-form" noValidate onSubmit={submitJoin}>
              <div className="space-y-2">
                <label className="field-label" htmlFor="join-name">
                  Tu nombre
                </label>
                <Input
                  ref={joinNameRef}
                  id="join-name"
                  autoComplete="nickname"
                  maxLength={20}
                  required
                  value={joinName}
                  onChange={(event) => setJoinName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="field-label" htmlFor="room-code">
                  Código de sala
                </label>
                <Input
                  ref={roomCodeRef}
                  id="room-code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="room-code-input"
                  inputMode="text"
                  maxLength={5}
                  required
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().slice(0, 5))}
                />
              </div>
              <ColorChoices
                name="join-color"
                optional
                value={joinColor}
                onChange={setJoinColor}
              />
              <div className="form-feedback" aria-live="polite">
                {error ? <p role="alert">{error}</p> : null}
              </div>
              <Button
                aria-busy={pending}
                className="w-full"
                disabled={pending}
                size="lg"
                type="submit"
              >
                {pending ? "Entrando…" : "Entrar a la sala"}
              </Button>
            </form>
          )}
        </Card>
      </section>
    </main>
  );
}
