import type { Metadata } from "next";
import { RoomPageClient } from "./RoomPageClient";

type RoomPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: RoomPageProps): Promise<Metadata> {
  const { code } = await params;
  return { title: `Sala ${code.toUpperCase()}` };
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params;
  return <RoomPageClient code={code} />;
}
