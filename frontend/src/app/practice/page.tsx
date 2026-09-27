import type { Metadata } from "next";
import { PracticePage } from "@/components/practice/PracticePage";

export const metadata: Metadata = {
  title: "Modo de práctica",
  description: "Prueba una partida de Parchís contra jugadores automáticos.",
  robots: { index: false, follow: false },
};

export default function PracticeRoute() {
  return <PracticePage />;
}
