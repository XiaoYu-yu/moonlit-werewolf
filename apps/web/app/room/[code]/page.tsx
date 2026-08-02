import { GameExperience } from '@/components/game-experience';
import type { RequestedRoomMode } from '@/lib/live-api';

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const requested = Array.isArray(query.mode) ? query.mode[0] : query.mode;
  const mode: RequestedRoomMode = requested === 'live' || requested === 'demo' ? requested : 'auto';
  return <GameExperience requestedMode={mode} roomCode={code.toUpperCase()} />;
}
