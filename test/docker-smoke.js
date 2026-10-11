'use strict';
// Optional production smoke: npm run test:docker. Only its own temporary container/volume are removed.
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const name = 'kh-qa-' + randomUUID().slice(0, 8);
const volume = name + '-data';
const clients = [];
const sessions = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw Error(`Smoke timeout: ${label}`);
}
async function connect(url) {
  const c = io(url, { transports: ['websocket'], reconnection: false });
  clients.push(c);
  c.on('room-state', (s) => {
    c.state = s;
  });
  await wait(() => c.connected, 'socket');
  return c;
}
const command = (c, type, payload = {}) =>
  new Promise((resolve, reject) =>
    c
      .timeout(3000)
      .emit('command', { id: randomUUID(), type, payload }, (e, r) =>
        e ? reject(e) : r.ok ? resolve(r) : reject(Error(r.error)),
      ),
  );
async function healthy(url) {
  await wait(async () => {
    try {
      return (await fetch(url + '/healthz')).ok;
    } catch {
      return false;
    } // Container may still be starting.
  }, 'health');
}
async function run() {
  docker('build', '-q', '-t', 'kelime-havuzu:review', '.');
  docker('volume', 'create', volume);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::3000',
    '-v',
    volume + ':/app/state',
    'kelime-havuzu:review',
  );
  let url = 'http://' + docker('port', name, '3000/tcp');
  await healthy(url);
  for (let i = 0; i < 4; i++) {
    const c = await connect(url);
    const r = await command(c, i ? 'join' : 'create', {
      nickname: 'Docker ' + i,
      roomCode: sessions[0]?.roomCode,
      team: i % 2 ? 'blue' : 'red',
    });
    sessions.push(r.session);
    await command(c, 'save-words', {
      wordsVersion: 1,
      words: Array.from({ length: 5 }, (_, j) => 'Kelime ' + i + ' ' + j),
      submitted: true,
    });
  }
  await command(clients[0], 'start-game');
  await wait(() => clients[0].state.status === 'ready', 'ready');
  const desc = clients.find((c) => c.state.me === clients[0].state.game.describerId);
  await command(desc, 'start-turn', { turnId: desc.state.game.turnId });
  await wait(() => desc.state.game.word, 'word');
  await command(desc, 'correct', {
    cardId: desc.state.game.word.id,
    turnId: desc.state.game.turnId,
  });
  console.log('PASS: production container, four sockets, roles and scoring');
  docker('restart', name);
  // Docker can reassign an automatically chosen host port on restart.
  url = 'http://' + docker('port', name, '3000/tcp');
  await healthy(url);
  const restored = [];
  for (const session of sessions) {
    const c = await connect(url);
    await command(c, 'resume', session);
    restored.push(c);
  }
  await wait(
    () => restored.every((c) => c.state?.players.every((p) => p.connected)),
    'all players resumed',
  );
  const rs = restored[0].state;
  assert.equal(rs.status, 'paused');
  assert.equal(rs.game.scores.red + rs.game.scores.blue, 1);
  assert.equal(rs.game.remaining, 19);
  const host = restored.find((c) => c.state.me === rs.adminId);
  await command(host, 'resume-game');
  await wait(() => host.state.status === 'playing', 'countdown completed');
  assert(host.state.game.timeMs > 0);
  console.log(
    'PASS: SIGTERM/restart with persistent volume preserves identity, score, pool and time',
  );
}
run()
  .catch((error) => {
    console.error(error);
    try {
      console.error(docker('logs', name));
    } catch (logError) {
      console.error('Container logs unavailable:', logError.status);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    for (const c of clients) c.disconnect();
    try {
      docker('rm', '-f', name);
    } catch (error) {
      console.error('Container cleanup failed:', error.status);
    }
    try {
      docker('volume', 'rm', volume);
    } catch (error) {
      console.error('Volume cleanup failed:', error.status);
    }
  });
