/* ================================================================
   P2P Chat — Service Worker  (sw.js)
   Repo: Sotravil/Chat-p2p  — deployed alongside index.html
   Version: 2.0.0

   Responsibilities
   ─────────────────
   1. Own notification display — click-to-focus/open-room works
      even when the browser tab is closed.
   2. Periodic Background Sync (Chrome 80+) — poll GitHub for new
      messages when the tab is closed and fire a notification.
   3. Self-refresh expired GitHub tokens from the same paste URL
      the main thread uses, so background sync survives token rotation.

   Path conventions (must stay in sync with p2p.html constants)
   ──────────────────────────────────────────────────────────────
   roomIndexPath → rooms-cells/<room>/index.json
   cellPath      → rooms-cells/<room>/cells/cell-000001.json
   masterPath    → master-rooms/<room>.json
   Room names are used RAW in paths — no encodeURIComponent.
   ================================================================ */

'use strict';

// ── IDB helpers ────────────────────────────────────────────────────
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

// ── Path util (mirrors p2p.html) ───────────────────────────────────
const _pad6 = n => String(n).padStart(6, '0');

// ── Install / Activate ─────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── Messages from the main thread ──────────────────────────────────
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

// ── Notification click — focus app or open it ──────────────────────
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
      // No open tab — open a new one; app reads ?room= on init
      const url = baseUrl + (room ? '?room=' + encodeURIComponent(room) : '');
      return clients.openWindow(url);
    })
  );
});

// ── Periodic Background Sync ───────────────────────────────────────
// Fires at most once every ~30 min when periodic-background-sync
// permission is granted (Chrome 80+, Android / Desktop).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cp2p-msg-poll') {
    e.waitUntil(_bgPoll());
  }
});

// ── Token self-refresh ─────────────────────────────────────────────
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

// ── Core background poll ───────────────────────────────────────────
async function _bgPoll() {
  const state = await _dbGet('pollState');
  if (!state || !state.room || !state.ghOwner || !state.ghRepo) return;

  // Skip if an app tab is focused — the tab handles real-time polling
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

  // ── Local helpers ──────────────────────────────────────────────
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
    // ── 1. Cheap master-flag read ───────────────────────────────
    // master-rooms/<room>.json is set to `true` by the sender and
    // `false` by the receiver — lets us skip full cell reads when idle.
    const masterR = await ghJson(`${masterRoomsDir}/${room}.json`);
    if (masterR.ok && masterR.obj === false) return; // nothing new

    // ── 2. Room index → latest cell number ─────────────────────
    const idxR = await ghJson(`${roomsCellsBase}/${room}/index.json`);
    if (!idxR.ok) return;
    const latestCell = idxR.obj?.latestCell || 1;

    // ── 3. Check last 2 cells (H-5 parity) ─────────────────────
    let newMsgs = [];
    for (let c = Math.max(1, latestCell - 1); c <= latestCell; c++) {
      const cellR = await ghJson(`${roomsCellsBase}/${room}/cells/cell-${_pad6(c)}.json`);
      if (!cellR.ok || !Array.isArray(cellR.obj)) continue;
      const fresh = cellR.obj.filter(m => m && !m.deleted && (m.ts || 0) > lastTs);
      newMsgs = newMsgs.concat(fresh);
    }

    if (!newMsgs.length) return;
    newMsgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    // ── 4. Bump stored high-water mark ──────────────────────────
    const newLastTs = Math.max(...newMsgs.map(m => m.ts || 0));
    await _dbSet('pollState', { ...state, token, lastTs: newLastTs });

    // ── 5. Wake any backgrounded (unfocused) tabs ───────────────
    // They'll do a full syncLatestFromStorage() without needing a notification.
    cs.forEach(c => { if (!c.focused) c.postMessage({ type: 'bg-new-messages', room }); });

    // ── 6. Fire the notification ────────────────────────────────
    const latest = newMsgs[newMsgs.length - 1];
    const count  = newMsgs.length;
    const title  = count > 1
      ? `${count} new messages in #${room}`
      : `${latest.sender || 'Someone'} in #${room}`;
    const body   = latest.text
      ? latest.text.slice(0, 120)
      : latest.type === 'audio' ? '🎵 Voice message'
      : latest.type === 'media' ? '📎 Media message'
      : 'New message';

    await self.registration.showNotification(title, {
      body,
      tag      : `cp2p-room-${room}`,  // collapses duplicate room notifs
      // No icon path — avoids 404 noise when favicon.ico is absent
      data     : { room },
      renotify : count > 1,
    });

  } catch (err) {
    console.warn('[SW bgPoll]', err?.message || err);
  }
}


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
