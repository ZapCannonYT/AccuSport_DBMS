'use client';
// Follow / unfollow a player (UPDATE users.followed_player_id)
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FollowButton({ playerId, following }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function toggle() {
    setBusy(true);
    await fetch('/api/me/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: following ? null : playerId }),
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <button className={following ? 'secondary' : ''} onClick={toggle} disabled={busy}>
      {following ? 'Unfollow' : 'Follow on dashboard'}
    </button>
  );
}
