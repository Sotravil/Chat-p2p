/* ================================================================
   P2P Chat â€” Service Worker  (sw.js)
   Repo: Sotravil/Chat-p2p  â€” deployed alongside index.html
   Version: 2.0.0

   Responsibilities
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   1. Own notification display â€” click-to-focus/open-room works
      even when the browser tab is closed.
   2. Periodic Background Sync (Chrome 80+) â€” poll GitHub for new
      messages when the tab is closed and fire a notification.
   3. Self-refresh expired GitHub tokens from the same paste URL
      the main thread uses, so background sync survives token rotation.

   Path conventions (must stay in sync with p2p.html constants)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   roomIndexPath â†’ rooms-cells/<room>/index.json
   cellPath      â†’ rooms-cells/<room>/cells/cell-000001.json
   masterPath    â†’ master-rooms/<room>.json
   Room names are used RAW in paths â€” no encodeURIComponent.
   ================================================================ */

'use strict';

// â”€â”€ IDB helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IDB_NAME  = 'cp2p-bgpoll';
const IDB_STORE = 'state';

function _openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = () => rej(r.error);
  });
}
async function _dbGet(key) {
  const db = await _openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r  = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror   = () => rej(r.error);
  });
}
async function _dbSet(key, val) {
  const db = await _openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
  });
}

// â”€â”€ Path util (mirrors p2p.html) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _pad6 = n => String(n).padStart(6, '0');

// â”€â”€ Install / Activate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// â”€â”€ Messages from the main thread â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
self.addEventListener('message', e => {
  switch (e.data?.type) {
    case 'update-poll-state':
      _dbSet('pollState', e.data.state).catch(() => {});
      break;
    case 'clear-poll-state':
      _dbSet('pollState', null).catch(() => {});
      break;
    case 'show-notification':
      // Main thread asks SW to own the notification so click events
      // fire even when the tab is hidden/backgrounded.
      self.registration
        .showNotification(e.data.title || 'P2P Chat', e.data.opts ?? {})
        .catch(() => {});
      break;
  }
});

// â”€â”€ Notification click â€” focus app or open it â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const room    = e.notification.data?.room;
  const baseUrl = self.registration.scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.startsWith(baseUrl));
      if (existing) {
        existing.focus();
        if (room) existing.postMessage({ type: 'join-room', room });
        return;
      }
      // No open tab â€” open a new one; app reads ?room= on init
      const url = baseUrl + (room ? '?room=' + encodeURIComponent(room) : '');
      return clients.openWindow(url);
    })
  );
});

// â”€â”€ Periodic Background Sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fires at most once every ~30 min when periodic-background-sync
// permission is granted (Chrome 80+, Android / Desktop).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cp2p-msg-poll') {
    e.waitUntil(_bgPoll());
  }
});

// â”€â”€ Token self-refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When the background sync fires with the tab closed the stored token
// may have rotated.  Re-fetch from the same paste URL the main thread
// uses (it's a public raw URL, no proxy needed inside a SW).
async function _refreshToken(pasteUrl) {
  if (!pasteUrl) return null;
  try {
    const res  = await fetch(pasteUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const m    = text.match(/github_pat_[^\s"<]+/);
    return m ? m[0].trim() : null;
  } catch (_) { return null; }
}

// â”€â”€ Core background poll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _bgPoll() {
  const state = await _dbGet('pollState');
  if (!state || !state.room || !state.ghOwner || !state.ghRepo) return;

  // Skip if an app tab is focused â€” the tab handles real-time polling
  const cs      = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const focused = cs.some(c => c.focused);
  if (focused) return;

  const {
    room,
    ghOwner,
    ghRepo,
    ghBranch       = 'main',
    roomsCellsBase = 'rooms-cells',   // matches ROOMS_CELLS_BASE in p2p.html
    masterRoomsDir = 'master-rooms',  // matches MASTER_ROOMS_DIR in p2p.html
    tokenPasteUrl,
    lastTs         = 0,
  } = state;

  let token     = state.token;
  const apiBase = `https://api.github.com/repos/${ghOwner}/${ghRepo}/contents`;

  // â”€â”€ Local helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function _apiGet(path, tok) {
    const res = await fetch(`${apiBase}/${path}`, {
      headers: {
        'Authorization': `Bearer ${tok}`,
        'Accept'       : 'application/vnd.github+json',
      },
    });
    return { ok: res.ok, status: res.status, res };
  }

  async function _apiGetJson(path, tok) {
    const { ok, status, res } = await _apiGet(path, tok);
    if (!ok) return { ok: false, status };
    const envelope = await res.json();
    const b64 = envelope?.content?.replace(/\n/g, '');
    if (!b64) return { ok: false };
    try { return { ok: true, obj: JSON.parse(atob(b64)) }; }
    catch (_) { return { ok: false }; }
  }

  // Auto-retry with a fresh token on 401
  async function ghJson(path) {
    let r = await _apiGetJson(path, token);
    if (r.ok) return r;
    if (r.status === 401 && tokenPasteUrl) {
      const fresh = await _refreshToken(tokenPasteUrl);
      if (fresh && fresh !== token) {
        token = fresh;
        await _dbSet('pollState', { ...state, token }); // persist so next poll uses it too
        return _apiGetJson(path, token);
      }
    }
    return r;
  }

  try {
    // ── 0. DM inbox check — always runs first (before any early returns) ──
    // Reads users/${myUid}/dm-notifs.json for unread entries written by senders.
    if (state.myUid) {
      try {
        const lastDmTs = state.lastDmNotifTs || 0;
        const dmR = await ghJson(`users/${state.myUid}/dm-notifs.json`);
        if (dmR.ok && Array.isArray(dmR.obj)) {
          const newDms = dmR.obj.filter(n => !n.read && (n.ts || 0) > lastDmTs);
          if (newDms.length) {
            const newDmTs = Math.max(...newDms.map(n => n.ts || 0));
            await _dbSet('pollState', { ...state, token, lastDmNotifTs: newDmTs });
            const senders = [...new Set(newDms.map(n => n.from || n.fromUid || 'Someone'))];
            const dmTitle = newDms.length === 1
              ? `\uD83D\uDC8C DM from ${senders[0]}`
              : `\uD83D\uDC8C ${newDms.length} new DMs`;
            const latestDm = newDms[newDms.length - 1];
            await self.registration.showNotification(dmTitle, {
              body     : (latestDm.text || 'New direct message').slice(0, 120),
              tag      : 'cp2p-dm-inbox',
              data     : { room: latestDm.room || '' },
              renotify : newDms.length > 1,
            });
          }
        }
      } catch (_dmErr) { /* DM inbox errors are non-fatal */ }
    }

    // ── 1. Cheap master-flag read ─────────────────────────────────────
    // master-rooms/<room>.json is true when sender writes, false when read.
    // Skip full cell reads when idle to conserve GitHub API quota.
    const masterR = await ghJson(`${masterRoomsDir}/${room}.json`);
    if (masterR.ok && masterR.obj === false) return; // nothing new

    // â”€â”€ 2. Room index â†’ latest cell number â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const idxR = await ghJson(`${roomsCellsBase}/${room}/index.json`);
    if (!idxR.ok) return;
    const latestCell = idxR.obj?.latestCell || 1;

    // â”€â”€ 3. Check last 2 cells (H-5 parity) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let newMsgs = [];
    for (let c = Math.max(1, latestCell - 1); c <= latestCell; c++) {
      const cellR = await ghJson(`${roomsCellsBase}/${room}/cells/cell-${_pad6(c)}.json`);
      if (!cellR.ok || !Array.isArray(cellR.obj)) continue;
      const fresh = cellR.obj.filter(m => m && !m.deleted && (m.ts || 0) > lastTs);
      newMsgs = newMsgs.concat(fresh);
    }

    if (!newMsgs.length) return;
    newMsgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    // â”€â”€ 4. Bump stored high-water mark â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const newLastTs = Math.max(...newMsgs.map(m => m.ts || 0));
    await _dbSet('pollState', { ...state, token, lastTs: newLastTs });

    // â”€â”€ 5. Wake any backgrounded (unfocused) tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // They'll do a full syncLatestFromStorage() without needing a notification.
    cs.forEach(c => { if (!c.focused) c.postMessage({ type: 'bg-new-messages', room }); });

    // â”€â”€ 6. Fire the notification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const latest = newMsgs[newMsgs.length - 1];
    const count  = newMsgs.length;
    const title  = count > 1
      ? `${count} new messages in #${room}`
      : `${latest.sender || 'Someone'} in #${room}`;
    const body   = latest.text
      ? latest.text.slice(0, 120)
      : latest.type === 'audio' ? 'ðŸŽµ Voice message'
      : latest.type === 'media' ? 'ðŸ“Ž Media message'
      : 'New message';

    await self.registration.showNotification(title, {
      body,
      tag      : `cp2p-room-${room}`,  // collapses duplicate room notifs
      // No icon path â€” avoids 404 noise when favicon.ico is absent
      data     : { room },
      renotify : count > 1,
    });

  } catch (err) {
    console.warn('[SW bgPoll]', err?.message || err);
  }
}
