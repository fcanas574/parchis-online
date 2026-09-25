import type { Metadata } from "next";
import { LandingPage } from "@/components/home/LandingPage";

export const metadata: Metadata = { title: "Inicio" };

export default function HomePage() {
  return <LandingPage />;
}
