"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createPracticeRoom } from "@/lib/api";
import { saveSession } from "@/lib/session";
import type { PlayerColor, RoomCredentials } from "@/types/game";

const colors: Array<{ value: PlayerColor; label: string }> = [
  { value: "green", label: "Verde" },
  { value: "red", label: "Rojo" },
  { value: "blue", label: "Azul" },
  { value: "yellow", label: "Amarillo" },
  { value: "purple", label: "Morado" },
  { value: "orange", label: "Naranja" },
];

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
  return "No pudimos iniciar la práctica. Inténtalo de nuevo.";
};

export function PracticePage() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [playerCount, setPlayerCount] = useState<4 | 5 | 6>(4);
  const [color, setColor] = useState<PlayerColor>("green");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submitPractice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;

    const normalizedName = displayName.trim();
    if (normalizedName.length < 2 || normalizedName.length > 20) {
      setError("El nombre debe tener entre 2 y 20 caracteres.");
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const credentials = await createPracticeRoom({
        displayName: normalizedName,
        playerCount,
        color,
      });
      if (mountedRef.current) {
        saveSession(credentials);
        router.push(`/room/${credentials.roomCode.toUpperCase()}`);
      }
    } catch (requestError) {
      if (mountedRef.current) setError(errorMessage(requestError));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  };

  return (
    <main className="app-shell practice-shell">
      <section className="practice-stage" aria-labelledby="practice-title">
        <Link className="home-link practice-back-link" href="/">
          ← Volver al inicio
        </Link>
        <Card className="practice-card">
          <header className="practice-intro">
            <p className="eyebrow">Mesa privada · modo de prueba</p>
            <h1 id="practice-title">Juega una práctica</h1>
            <p>
              Prueba el tablero a tu ritmo. Los asientos que falten se completan con
              jugadores automáticos.
            </p>
          </header>

          <form className="room-form" noValidate onSubmit={submitPractice}>
            <div className="space-y-2">
              <label className="field-label" htmlFor="practice-name">
                Tu nombre
              </label>
              <Input
                id="practice-name"
                autoComplete="nickname"
                maxLength={20}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
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
                      name="practice-player-count"
                      value={count}
                      checked={playerCount === count}
                      onChange={() => setPlayerCount(count)}
                    />
                    <span className="choice-label">{count} jugadores</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2.5">
              <legend className="field-label">Elige tu color</legend>
              <div className="color-choice-grid">
                {colors.map((option) => (
                  <label className="color-choice" key={option.value}>
                    <input
                      className="choice-input"
                      type="radio"
                      name="practice-color"
                      value={option.value}
                      checked={color === option.value}
                      onChange={() => setColor(option.value)}
                    />
                    <span className="choice-label">
                      <span
                        aria-hidden="true"
                        className="piece-swatch"
                        style={{ backgroundColor: `var(--color-piece-${option.value})` }}
                      />
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

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
              {pending ? "Preparando la mesa…" : "Empezar práctica"}
            </Button>
          </form>
        </Card>
      </section>
    </main>
  );
}
