import SongView from "./song-view";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SongView id={id} />;
}
