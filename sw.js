/* ================================================================
   P2P Chat — Service Worker  (sw.js)
   Version: 1.0.0

   Responsibilities:
   1. Own notification display so click → focus/open app works
      even when the browser tab is in the background.
   2. Periodic Background Sync (Chrome 80+): poll GitHub for new
      messages and fire a notification when the tab is closed.
   3. Receive state updates (token, room, lastTs) from the main
      thread via postMessage, stored in IndexedDB.
   ================================================================ */

'use strict';

const IDB_NAME  = 'cp2p-bgpoll';
const IDB_STORE = 'state';
const CACHE_VER = 'cp2p-sw-v1';

// ── Install / Activate ──────────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── IndexedDB helpers ──────────────────────────────────────────────
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function dbSet(key, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Messages from the main thread ─────────────────────────────────
self.addEventListener('message', e => {
  switch (e.data?.type) {
    case 'update-poll-state':
      dbSet('pollState', e.data.state).catch(() => {});
      break;
    case 'clear-poll-state':
      dbSet('pollState', null).catch(() => {});
      break;
    case 'show-notification':
      // Main thread asks SW to own the notification (click handling works in background)
      self.registration.showNotification(e.data.title, e.data.opts ?? {})
        .catch(() => {});
      break;
  }
});

// ── Periodic Background Sync ───────────────────────────────────────
// Fires at most once every ~30 minutes when the site's periodic-background-sync
// permission is granted (Chrome 80+ on Android/Desktop).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cp2p-msg-poll') {
    e.waitUntil(pollForNewMessages());
  }
});

// ── Notification click — focus app or open it ─────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const room = e.notification.data?.room;
  const baseUrl = self.registration.scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      // Find an existing tab for this app
      const existing = cs.find(c => c.url.startsWith(baseUrl));
      if (existing) {
        existing.focus();
        if (room) existing.postMessage({ type: 'join-room', room });
        return;
      }
      // No open tab — open a new one; the app will handle ?room= on init
      const target = baseUrl + (room ? '?room=' + encodeURIComponent(room) : '');
      return clients.openWindow(target);
    })
  );
});

// ── Core: poll GitHub for new messages ───────────────────────────
async function pollForNewMessages() {
  const state = await dbGet('pollState');
  if (!state || !state.token || !state.room) return;

  const { token, room, lastTs = 0, ghOwner, ghRepo, ghBranch } = state;
  if (!ghOwner || !ghRepo || !ghBranch) return;

  // Skip poll if a client tab is currently focused (it will handle it)
  const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const focused = cs.some(c => c.focused);
  if (focused) return;

  const repoBase = `https://api.github.com/repos/${ghOwner}/${ghRepo}/contents`;
  const authHdr  = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

  try {
    // 1. Read room index to get latestCell
    const idxPath = `rooms-cells/${encodeURIComponent(room)}/index.json`;
    const idxRes  = await fetch(`${repoBase}/${idxPath}`, { headers: authHdr });
    if (!idxRes.ok) return;
    const idxJson = await idxRes.json();
    const idx     = JSON.parse(atob(idxJson.content.replace(/\n/g, '')));
    const latestCell = idx.latestCell || 1;

    // 2. Check last 2 cells (in case messages landed in N-1 cell)
    let newMsgs = [];
    for (let c = Math.max(1, latestCell - 1); c <= latestCell; c++) {
      const pad     = String(c).padStart(6, '0');
      const cellPath = `rooms-cells/${encodeURIComponent(room)}/cells/cell-${pad}.json`;
      const cellRes  = await fetch(`${repoBase}/${cellPath}`, { headers: authHdr });
      if (!cellRes.ok) continue;
      const cellJson = await cellRes.json();
      const messages = JSON.parse(atob(cellJson.content.replace(/\n/g, '')));
      const fresh    = messages.filter(m => m && !m.deleted && (m.ts || 0) > lastTs);
      newMsgs = newMsgs.concat(fresh);
    }

    if (!newMsgs.length) return;

    // 3. Update stored lastTs so we don't re-notify
    const newLastTs = Math.max(...newMsgs.map(m => m.ts || 0));
    await dbSet('pollState', { ...state, lastTs: newLastTs });

    // 4. Show one notification for the latest message batch
    const latest = newMsgs[newMsgs.length - 1];
    const count  = newMsgs.length;
    const title  = count > 1
      ? `${count} new messages in #${room}`
      : `${latest.sender || 'Someone'} in #${room}`;
    const body   = latest.text
      ? latest.text.slice(0, 120)
      : latest.type === 'audio' ? '🎵 Voice message'
      : latest.type === 'media' ? '📎 Media'
      : 'New message';

    await self.registration.showNotification(title, {
      body,
      tag      : `cp2p-room-${room}`,
      icon     : 'favicon.ico',
      badge    : 'favicon.ico',
      data     : { room },
      renotify : count > 1,
    });
  } catch (err) {
    console.warn('[SW poll error]', err.message || err);
  }
}
