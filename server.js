'use strict';
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { GameStore, GameError } = require('./src/game');
const { SnapshotFile } = require('./src/persistence');
const proxyAddress = require('proxy-addr');

/** Creates an isolated application; importing this module never opens a port. */
function createApplication({
  stateDir = process.env.STATE_DIR || path.join(__dirname, 'state'),
  now = Date.now,
  production = process.env.NODE_ENV === 'production',
} = {}) {
  const store = new GameStore({ now });
  const disk = new SnapshotFile(stateDir);
  const saved = disk.load();
  if (saved) store.restore(saved);
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const origins = (process.env.APP_ORIGIN || '').split(',').filter(Boolean);
  const allowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // Native clients and health probes; rate limits still apply.
    try {
      return origins.length ? origins.includes(origin) : new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  const io = new Server(server, {
    maxHttpBufferSize: 16384,
    serveClient: true,
    allowRequest: (req, done) => done(null, allowed(req)),
  });
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cache-Control': 'no-cache',
    });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  let healthy = true;
  app.get('/healthz', (_req, res) => res.status(healthy ? 200 : 503).json({ ok: healthy }));
  app.use(express.static(path.join(__dirname, 'public'), { etag: true }));
  const trustedHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustedHops) || trustedHops < 0 || trustedHops > 5)
    throw new Error('TRUST_PROXY_HOPS must be 0–5');
  const clientAddress = (socket) =>
    proxyAddress(socket.request, (_address, hop) => hop < trustedHops);
  const bindings = new Map(); // Stable player ID -> the one currently authorized socket.
  const buckets = new Map();
  const ipCounts = new Map();
  function quota(key, limit, windowMs) {
    const time = now();
    let b = buckets.get(key);
    if (!b || b.until <= time) {
      b = { count: 0, until: time + windowMs };
      buckets.set(key, b);
    }
    return ++b.count <= limit;
  }
  function persist() {
    try {
      disk.save(store.serialize());
      healthy = true;
      return true;
    } catch (error) {
      healthy = false;
      console.error('State persistence failed:', error.code || error.name);
      return false;
    }
  }
  function publish(room) {
    for (const p of room.players) {
      const socket = bindings.get(p.id);
      if (socket?.connected) socket.emit('room-state', store.view(room, p.id));
    }
  }
  function detach(socket) {
    const membership = socket.data.membership;
    if (!membership) return;
    if (bindings.get(membership.playerId) === socket) bindings.delete(membership.playerId);
    socket.data.membership = null;
  }
  function bind(socket, result) {
    const { room, player } = result;
    const old = bindings.get(player.id);
    if (old && old !== socket) {
      old.data.membership = null;
      old.emit('session-replaced');
      old.disconnect(true);
    }
    socket.data.membership = { roomCode: room.code, playerId: player.id };
    bindings.set(player.id, socket);
  }
  io.use((socket, next) => {
    const ip = clientAddress(socket);
    if ((ipCounts.get(ip) || 0) >= 128) return next(new Error('Bu ağdan çok fazla bağlantı var.'));
    if (!quota(`connect:${ip}`, 300, 60000))
      return next(new Error('Çok sık bağlantı denemesi. Bir dakika bekle.'));
    next();
  });
  io.on('connection', (socket) => {
    const ip = clientAddress(socket);
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    const seen = new Map();
    socket.on('command', (packet, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      let room;
      try {
        if (
          !packet ||
          typeof packet !== 'object' ||
          Array.isArray(packet) ||
          typeof packet.id !== 'string' ||
          !/^[a-zA-Z0-9-]{8,64}$/.test(packet.id) ||
          typeof packet.type !== 'string'
        )
          throw new GameError('İstek biçimi geçersiz.');
        if (seen.has(packet.id)) {
          acknowledge(seen.get(packet.id));
          return;
        }
        if (!quota(`socket:${socket.id}`, 40, 1000) || !quota(`ip:${ip}`, 4000, 60000))
          throw new GameError('Çok hızlı işlem yapılıyor. Biraz bekle.', 'RATE_LIMIT');
        if (!healthy) {
          persist();
          if (!healthy)
            throw new GameError(
              'Kayıt hizmeti geçici olarak kullanılamıyor. Oyun koruma altında duruyor.',
              'UNAVAILABLE',
            );
        }
        const { type, payload = {} } = packet;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw new GameError('İstek biçimi geçersiz.');
        let result;
        if (['create', 'join', 'resume'].includes(type)) {
          if (socket.data.membership) throw new GameError('Önce mevcut odadan ayrıl.');
          if (!quota(`entry:${ip}`, 180, 60000))
            throw new GameError('Çok fazla oda denemesi. Bir dakika bekle.', 'RATE_LIMIT');
          if (type === 'create' && !quota(`create:${ip}`, 12, 60000))
            throw new GameError('Bu ağdan çok fazla oda açıldı. Bir dakika bekle.', 'RATE_LIMIT');
          result = store[type](payload);
          room = result.room;
          bind(socket, result);
        } else {
          const m = socket.data.membership;
          if (!m || bindings.get(m.playerId) !== socket)
            throw new GameError('Oturumuna yeniden bağlan.', 'SESSION_GONE');
          room = store.rooms.get(m.roomCode);
          if (!room) throw new GameError('Oda kapanmış.', 'ROOM_GONE');
          const removedId =
            type === 'kick' ? payload.playerId : type === 'leave' ? m.playerId : null;
          store.act(room, m.playerId, type, payload);
          if (removedId) {
            const removed = bindings.get(removedId);
            if (removed) {
              detach(removed);
              removed.emit('room-left', { kicked: type === 'kick' });
            }
          }
        }
        const persisted = persist();
        if (!persisted) {
          for (const active of store.rooms.values())
            store.pause(active, 'Kayıt hizmeti kesildi. Oyun koruma için duraklatıldı.');
        }
        // The command has already applied. Acknowledge it once and return any newly
        // issued session, even during a disk failure, so reconnect cannot strand it.
        const response = {
          ok: true,
          ...(persisted
            ? {}
            : {
                warning:
                  'İşlem uygulandı ancak diske kaydedilemedi. Oyun koruma için duraklatıldı.',
              }),
          ...(result ? { session: { roomCode: room.code, token: result.token } } : {}),
        };
        seen.set(packet.id, response);
        if (seen.size > 128) seen.delete(seen.keys().next().value);
        acknowledge(response);
        if (room) publish(room);
      } catch (error) {
        const expected = error instanceof GameError;
        if (!expected) console.error('Command failed:', error.stack);
        acknowledge({
          ok: false,
          code: expected ? error.code : 'INTERNAL',
          error: expected
            ? error.message
            : 'Beklenmeyen bir hata oluştu. Durumu yeniden kontrol et.',
        });
        if (room) publish(room);
      }
    });
    socket.on('disconnect', () => {
      ipCounts.set(ip, Math.max(0, (ipCounts.get(ip) || 1) - 1));
      if (!ipCounts.get(ip)) ipCounts.delete(ip);
      const m = socket.data.membership;
      if (m && bindings.get(m.playerId) === socket) {
        const room = store.rooms.get(m.roomCode);
        detach(socket);
        if (room) {
          store.disconnect(room, m.playerId);
          publish(room);
          persist();
        }
      }
      buckets.delete(`socket:${socket.id}`);
    });
  });
  let lastSecond = 0;
  const timer = setInterval(() => {
    const second = Math.floor(now() / 1000);
    const pulse = second !== lastSecond;
    let changed = false;
    for (const room of store.rooms.values()) {
      const update = store.tickRoom(room);
      changed ||= update;
      if (!store.rooms.has(room.code)) {
        for (const p of room.players) {
          const s = bindings.get(p.id);
          if (s) {
            detach(s);
            s.emit('room-left', { expired: true });
          }
        }
      } else if (update || (pulse && room.game)) publish(room);
    }
    if (pulse) {
      lastSecond = second;
      for (const [key, b] of buckets) if (b.until < now()) buckets.delete(key);
    }
    if (changed || (pulse && store.rooms.size)) persist();
    if (!healthy) {
      for (const room of store.rooms.values()) {
        store.pause(room, 'Kayıt bağlantısı kesildi. Yönetici biraz sonra devam ettirebilir.');
        publish(room);
      }
    }
  }, 100);
  timer.unref();
  async function close() {
    clearInterval(timer);
    for (const room of store.rooms.values()) store.pause(room, 'Sunucu yeniden başlıyor.');
    persist();
    await new Promise((resolve) => io.close(resolve));
  }
  return { app, server, io, store, close };
}
if (require.main === module) {
  const application = createApplication();
  const port = Number(process.env.PORT || 3000);
  application.server.listen(port, '0.0.0.0', () =>
    console.log(`Kelime Havuzu listening on ${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      application
        .close()
        .then(() => process.exit(0))
        .catch((error) => {
          console.error('Shutdown failed:', error.message);
          process.exit(1);
        });
    });
}
module.exports = { createApplication };
