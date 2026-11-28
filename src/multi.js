// v1.23 "Birlikte oyna": the Game played together by everyone who has it open (Nov 2026).
//
// No game server: the players talk through a Supabase Realtime broadcast channel (the cesnigirder.org project's own
// Supabase, publishable key; broadcast needs no table and no SQL). Each player sends their own position a few times a
// second and tells the others when one of their bullets hit them; the one who was hit takes the damage and says when
// they died. Nothing is stored anywhere. The supabase-js client is downloaded only when someone joins.
//
// `?mp=local` swaps in a BroadcastChannel between tabs of the same browser (for testing without the network).

const SB_URL = 'https://hdztvyindbhhpveukvox.supabase.co';
const SB_KEY = 'sb_publishable_Ory-OQ3Xxt8Fzf8oq_P8BA_p3Loet-w';
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
export const ROOMS = { pvp: 'koprukoy-oyun-pvp-1', takim: 'koprukoy-oyun-takim-1' };

/**
 * Join a room (ROOMS.pvp or ROOMS.takim). onMsg(msg) gets every message another player sent (msg.t = type, msg.i = sender id).
 * Resolves to { id, send(msg), close() } once connected; rejects if the connection fails.
 */
export async function joinRoom(room, onMsg, { local = /[?&]mp=local/.test(location.search) } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  if (local) {
    const bc = new BroadcastChannel(room);
    bc.onmessage = (e) => { if (e.data && e.data.i !== id) onMsg(e.data); };
    return { id, send: (m) => { m.i = id; bc.postMessage(m); }, close: () => bc.close(), local: true };
  }
  const { createClient } = await import(/* @vite-ignore */ SB_LIB);
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 20 } } });
  const ch = sb.channel(room, { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'm' }, ({ payload }) => { if (payload && payload.i !== id) onMsg(payload); });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout')), 12000);
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') { clearTimeout(to); res(); }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(to); rej(new Error(s)); }
    });
  });
  return {
    id,
    send: (m) => { m.i = id; ch.send({ type: 'broadcast', event: 'm', payload: m }); },
    close: () => { try { sb.removeChannel(ch); } catch (_) {} },
    local: false,
  };
}
