'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../server');
async function waitFor(fn, ms = 3000) {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw Error('Condition timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function harness(t, options = {}) {
  const app = createApplication({ stateDir: '', ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const clients = [];
  t.after(async () => {
    for (const c of clients) c.disconnect();
    await app.close();
  });
  async function connect(extra = {}) {
    const c = io(url, { transports: ['websocket'], reconnection: false, ...extra });
    clients.push(c);
    c.on('room-state', (s) => {
      c.state = s;
    });
    await new Promise((resolve, reject) => {
      c.once('connect', resolve);
      c.once('connect_error', reject);
    });
    return c;
  }
  async function command(c, type, payload = {}, requestId = randomUUID()) {
    return new Promise((resolve, reject) =>
      c
        .timeout(2000)
        .emit('command', { id: requestId, type, payload }, (e, result) =>
          e ? reject(e) : resolve(result),
        ),
    );
  }
  return { ...app, url, connect, command, clients };
}
test('HTTP health, CSP, local assets and malformed socket requests remain healthy', async (t) => {
  const h = await harness(t);
  const response = await fetch(h.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /Kelime Havuzu/);
  const c = await h.connect();
  for (const payload of [{ nickname: 5 }, { nickname: {} }, { nickname: '<svg onload=x>' }, null]) {
    const result = await h.command(c, 'create', payload);
    assert.equal(result.ok, false);
  }
  const arbitrary = await new Promise((resolve) => c.emit('command', null, resolve));
  assert.equal(arbitrary.ok, false);
  assert.equal((await fetch(`${h.url}/healthz`)).status, 200);
  assert.equal((await h.command(c, 'create', { nickname: 'Gerçek' })).ok, true);
});
test('socket acknowledgements deduplicate requests and exclude secrets from other clients', async (t) => {
  const h = await harness(t);
  const clients = [];
  let session;
  for (let i = 0; i < 5; i++) {
    const c = await h.connect();
    const reply = await h.command(c, i === 0 ? 'create' : 'join', {
      nickname: `Kişi ${i}`,
      roomCode: session?.roomCode,
      team: i % 2 ? 'blue' : 'red',
    });
    assert(reply.ok);
    session ||= reply.session;
    clients.push(c);
    await waitFor(() => c.state);
    await h.command(c, 'save-words', {
      wordsVersion: 1,
      words: Array(5).fill(`gizli ${i}`),
      submitted: true,
    });
  }
  const requestId = randomUUID();
  await h.command(clients[0], 'start-game', {}, requestId);
  await h.command(clients[0], 'start-game', {}, requestId);
  await waitFor(() => clients[0].state.status === 'ready');
  const g = clients[0].state.game;
  const narrator = clients.find((c) => c.state.me === g.describerId);
  await h.command(narrator, 'start-turn', { turnId: g.turnId });
  await waitFor(() => narrator.state.game.word);
  const card = narrator.state.game.word;
  const id = randomUUID();
  assert.equal(
    (await h.command(narrator, 'correct', { cardId: card.id, turnId: g.turnId }, id)).ok,
    true,
  );
  assert.equal(
    (await h.command(narrator, 'correct', { cardId: card.id, turnId: g.turnId }, id)).ok,
    true,
  );
  await waitFor(() => narrator.state.game.remaining === 24);
  assert.equal(narrator.state.game.scores.red + narrator.state.game.scores.blue, 1);
  for (const c of clients) {
    assert(!JSON.stringify(c.state).includes(session.token));
    assert(!JSON.stringify(c.state).includes('tokenHash'));
  }
});
test('token resume replaces old socket; nickname alone cannot take over a player', async (t) => {
  const h = await harness(t);
  const original = await h.connect();
  const response = await h.command(original, 'create', { nickname: 'Yönetici' });
  await waitFor(() => original.state);
  const playerId = original.state.me;
  const attacker = await h.connect();
  assert.equal(
    (
      await h.command(attacker, 'resume', {
        roomCode: response.session.roomCode,
        token: '0'.repeat(64),
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await h.command(attacker, 'join', {
        roomCode: response.session.roomCode,
        nickname: 'Yönetici',
        team: 'blue',
      })
    ).ok,
    false,
  );
  const fresh = await h.connect();
  assert.equal((await h.command(fresh, 'resume', response.session)).ok, true);
  await waitFor(() => !original.connected && fresh.state);
  assert.equal(fresh.state.me, playerId);
  assert.equal(fresh.state.adminId, playerId);
  assert.equal(h.store.rooms.get(response.session.roomCode).players.length, 1);
});
test('lobby reconnect preserves draft and role; explicit leave invalidates the token', async (t) => {
  const h = await harness(t);
  const c = await h.connect();
  const result = await h.command(c, 'create', { nickname: 'İpek' });
  await h.command(c, 'save-words', {
    wordsVersion: 1,
    words: ['Kavanoz', '', '', '', ''],
    submitted: false,
  });
  c.disconnect();
  const newer = await h.connect();
  await h.command(newer, 'resume', result.session);
  await waitFor(() => newer.state);
  assert.equal(newer.state.myWords[0], 'Kavanoz');
  assert.equal(newer.state.players[0].count, 1);
  assert.equal((await h.command(newer, 'leave')).ok, true);
  const gone = await h.connect();
  assert.equal((await h.command(gone, 'resume', result.session)).code, 'ROOM_GONE');
});
test('disk state survives real app recreation; token itself is never persisted', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kh-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = await harness(t, { stateDir: dir });
  const c = await first.connect();
  const response = await first.command(c, 'create', { nickname: 'Kalıcı' });
  await first.command(c, 'save-words', {
    wordsVersion: 1,
    words: ['Ay', 'Güneş', '', '', ''],
    submitted: false,
  });
  const raw = readFileSync(path.join(dir, 'rooms.json'), 'utf8');
  assert(!raw.includes(response.session.token));
  c.disconnect();
  await first.close();
  const second = await harness(t, { stateDir: dir });
  const fresh = await second.connect();
  assert.equal((await second.command(fresh, 'resume', response.session)).ok, true);
  await waitFor(() => fresh.state);
  assert.equal(fresh.state.myWords[1], 'Güneş');
});
test('cross-origin browser handshake is rejected', async (t) => {
  const h = await harness(t);
  const c = io(h.url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Origin: 'https://unrelated.example' },
  });
  t.after(() => c.disconnect());
  await new Promise((resolve) => c.once('connect_error', resolve));
  assert.equal(c.connected, false);
});
test('disk failure returns session and one applied ack, reports unhealthy and blocks subsequent changes', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kh-fault-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'not-a-directory');
  writeFileSync(file, 'occupied');
  const h = await harness(t, { stateDir: file });
  const c = await h.connect();
  const requestId = randomUUID();
  const response = await h.command(c, 'create', { nickname: 'Disk Testi' }, requestId);
  assert(response.ok && response.session && response.warning);
  assert.equal((await fetch(`${h.url}/healthz`)).status, 503);
  const repeat = await h.command(c, 'create', { nickname: 'Disk Testi' }, requestId);
  assert.deepEqual(repeat, response);
  assert.equal(h.store.rooms.size, 1);
  assert.equal((await h.command(c, 'switch-team')).code, 'UNAVAILABLE');
});
