import type { Metadata } from "next";
import { LandingPage } from "@/components/home/LandingPage";

export const metadata: Metadata = {
  title: "Inicio",
  description: "Crea una sala privada de Parchís Online y comparte la invitación con tus amigos.",
};

export default function HomePage() {
  return <LandingPage />;
}
