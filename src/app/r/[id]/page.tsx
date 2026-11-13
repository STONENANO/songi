import type { Metadata } from "next";
import SongView from "./song-view";

/** Private song page: never indexed; a shared preview link shows a generic card (no names). */
export const metadata: Metadata = {
  title: "Your song versions",
  description: "A custom song written from a true story. Listen to the versions and pick your favourite.",
  robots: { index: false, follow: false },
  openGraph: { title: "A custom song, ready to hear", description: "Listen to the versions and pick your favourite." },
  twitter: { card: "summary_large_image", title: "A custom song, ready to hear", description: "Listen to the versions and pick your favourite." },
};

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SongView id={id} />;
}
