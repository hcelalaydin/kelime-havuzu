'use strict';
const { randomBytes, randomInt, createHash } = require('node:crypto');

const PHASES = [
  {
    name: 'Kelime Anlat',
    icon: '💬',
    rule: 'Kelimeyi ve içindeki sözcükleri kullanmadan serbest cümlelerle anlat.',
  },
  { name: 'Tek Kelime', icon: '☝️', rule: 'Sadece tek bir kelime söyleyerek anlat.' },
  { name: 'Sessiz Sinema', icon: '🎭', rule: 'Hiç konuşmadan, sadece jest ve mimiklerle anlat.' },
  { name: 'Ses ile Anlat', icon: '🎵', rule: 'Kelime kullanmadan, sadece sesler çıkararak anlat.' },
];
const AVATARS = ['🦊', '🐻', '🐸', '🐱', '🐼', '🐨', '🦉', '🐙'];
const LIMITS = {
  players: 32,
  rooms: 100,
  reconnectMs: 120000,
  roomTtlMs: 21600000,
  reviewMs: 5000,
};
const other = (team) => (team === 'red' ? 'blue' : 'red');
const id = () => randomBytes(16).toString('hex');
const hash = (token) => createHash('sha256').update(token).digest('hex');
class GameError extends Error {
  constructor(message, code = 'INVALID') {
    super(message);
    this.code = code;
  }
}
function requireThat(condition, message, code) {
  if (!condition) throw new GameError(message, code);
}
function text(value, min, max, label) {
  requireThat(typeof value === 'string', `${label} metin olmalı.`);
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  requireThat(
    cleaned.length >= min && cleaned.length <= max && !/[\p{Cc}\p{Cf}<>]/u.test(cleaned),
    `${label} ${min}–${max} karakter olmalı; görünmez işaret veya < > içeremez.`,
  );
  return cleaned;
}
function integer(value, min, max, label) {
  requireThat(
    Number.isInteger(value) && value >= min && value <= max,
    `${label} ${min}–${max} arasında tam sayı olmalı.`,
  );
  return value;
}
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Server-authoritative rules. Clock injection makes deadline boundaries reproducible. */
class GameStore {
  constructor({ now = Date.now } = {}) {
    this.rooms = new Map();
    this.now = now;
  }
  player(room, playerId) {
    return room.players.find((p) => p.id === playerId);
  }
  connected(room, team) {
    return room.players.filter((p) => p.connected && (!team || p.team === team));
  }
  enough(room) {
    return this.connected(room, 'red').length >= 2 && this.connected(room, 'blue').length >= 2;
  }
  touch(room) {
    room.version++;
    room.updatedAt = this.now();
  }
  makePlayer(nickname, team, avatar) {
    const token = randomBytes(32).toString('hex');
    return {
      token,
      player: {
        id: id(),
        tokenHash: hash(token),
        nickname: text(nickname, 2, 20, 'Takma ad'),
        team,
        avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
        connected: true,
        disconnectedAt: null,
        words: [],
        submitted: false,
        joinedAt: this.now(),
      },
    };
  }
  create({ nickname, avatar } = {}) {
    requireThat(
      this.rooms.size < LIMITS.rooms,
      'Şu an çok fazla oda var. Biraz sonra tekrar dene.',
      'CAPACITY',
    );
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('');
    } while (this.rooms.has(code));
    const { token, player } = this.makePlayer(nickname, 'red', avatar);
    const room = {
      code,
      adminId: player.id,
      players: [player],
      settings: { wordsPerPlayer: 5, turnDuration: 60 },
      wordsVersion: 1,
      status: 'lobby',
      game: null,
      version: 1,
      updatedAt: this.now(),
      notice: 'Arkadaşlarını davet et. Her takımda en az iki kişi olmalı.',
    };
    this.rooms.set(code, room);
    return { room, player, token };
  }
  join({ roomCode, nickname, team, avatar } = {}) {
    requireThat(typeof roomCode === 'string', 'Oda kodunu yaz.');
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    requireThat(room, 'Oda bulunamadı veya süresi doldu.', 'ROOM_GONE');
    requireThat(
      room.status === 'lobby',
      'Oyun başladı. Yeni oyuncular sonraki oyunda katılabilir.',
    );
    requireThat(room.players.length < LIMITS.players, `Oda en fazla ${LIMITS.players} kişi alır.`);
    requireThat(['red', 'blue'].includes(team), 'Bir takım seç.');
    const result = this.makePlayer(nickname, team, avatar);
    requireThat(
      !room.players.some(
        (p) =>
          p.nickname.toLocaleLowerCase('tr') === result.player.nickname.toLocaleLowerCase('tr'),
      ),
      'Bu takma ad kullanılıyor. Başka bir ad seç.',
    );
    room.players.push(result.player);
    this.touch(room);
    return { room, ...result };
  }
  resume({ roomCode, token } = {}) {
    requireThat(
      typeof roomCode === 'string' && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
      'Geri dönüş bilgisi geçersiz.',
      'SESSION_GONE',
    );
    const room = this.rooms.get(roomCode);
    requireThat(room, 'Oda kapanmış. Yeni bir oda oluşturabilirsin.', 'ROOM_GONE');
    const player = room.players.find((p) => p.tokenHash === hash(token));
    requireThat(player, 'Oturumun sona ermiş veya odadan çıkarılmışsın.', 'SESSION_GONE');
    player.connected = true;
    player.disconnectedAt = null;
    if (!this.connected(room).some((p) => p.id === room.adminId)) room.adminId = player.id;
    this.touch(room);
    return { room, player, token };
  }
  remaining(room) {
    const g = room.game;
    return g ? Math.max(0, g.deadline === null ? g.remainingMs : g.deadline - this.now()) : 0;
  }
  freeze(room) {
    if (!room.game) return;
    room.game.remainingMs = this.remaining(room);
    room.game.deadline = null;
    room.game.countdownEnd = null;
  }
  pause(room, reason) {
    if (!room.game || ['finished', 'transition', 'challenge'].includes(room.status)) return;
    this.freeze(room);
    room.status = 'paused';
    room.notice = reason;
  }
  disconnect(room, playerId) {
    const p = this.player(room, playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    if (room.adminId === p.id) this.transferAdmin(room);
    if (room.game && (room.game.describerId === p.id || !this.enough(room)))
      this.pause(room, 'Bağlantı kesildi. Oyuncular dönünce yönetici devam ettirebilir.');
    this.touch(room);
  }
  transferAdmin(room) {
    const next = this.connected(room)[0];
    if (next) {
      room.adminId = next.id;
      room.notice = `${next.nickname} artık oda yöneticisi.`;
    }
  }
  remove(room, playerId) {
    const p = this.player(room, playerId);
    if (!p) return;
    const wasDescriber = room.game?.describerId === p.id;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.adminId === playerId) this.transferAdmin(room);
    if (wasDescriber && room.game && !['transition', 'finished'].includes(room.status)) {
      // Settle a pending review before its narrator leaves; no unresolved references.
      if (room.game.challenge) this.resolveChallenge(room, false);
      if (!['transition', 'finished'].includes(room.status)) {
        this.freeze(room);
        this.nextTurn(room);
        room.status = 'paused';
        room.notice = 'Anlatıcı ayrıldı. Yeni sıra hazır; yönetici devam ettirebilir.';
      }
    }
    if (room.game && !this.enough(room))
      this.pause(
        room,
        'Her takımda iki bağlı oyuncu gerekiyor. Eksik oyuncular dönmeli veya lobiye dönülmeli.',
      );
    this.touch(room);
    if (!room.players.length) this.rooms.delete(room.code);
  }
  chooseDescriber(room, team) {
    const roster = room.players.filter((p) => p.team === team);
    const previous = roster.findIndex((p) => p.id === room.game.lastDescriber[team]);
    for (let step = 1; step <= roster.length; step++) {
      const p = roster[(previous + step) % roster.length];
      if (p.connected) {
        room.game.lastDescriber[team] = p.id;
        return p.id;
      }
    }
    return null;
  }
  nextTurn(room) {
    const g = room.game;
    const oldCardId = g.currentId;
    g.team = other(g.team);
    g.describerId = this.chooseDescriber(room, g.team);
    g.pool = shuffle(g.pool);
    if (g.pool.length > 1 && g.pool[0] === oldCardId)
      [g.pool[0], g.pool[1]] = [g.pool[1], g.pool[0]];
    g.currentId = null;
    g.lastResult = null;
    g.turnId = id();
    g.remainingMs = room.settings.turnDuration * 1000;
    g.deadline = null;
    g.countdownEnd = null;
    room.status = this.enough(room) && g.describerId ? 'ready' : 'paused';
    room.notice =
      room.status === 'paused'
        ? 'Devam etmek için her takımda iki bağlı oyuncu olmalı.'
        : 'Yeni anlatıcı hazır olduğunda başlayabilir.';
  }
  finishPhase(room) {
    this.freeze(room);
    const g = room.game;
    g.currentId = null;
    room.status = g.phase === 4 ? 'finished' : 'transition';
    room.notice =
      g.phase === 4
        ? 'Dört aşama tamamlandı!'
        : 'Fanus boşaldı. Aynı kelimeler yeni kuralla geri geliyor.';
  }
  draw(room) {
    room.game.currentId = room.game.pool[0] || null;
  }
  score(room, valid) {
    const g = room.game;
    const cardId = g.currentId;
    requireThat(cardId && g.pool.includes(cardId), 'Bu kelime zaten işlendi.', 'STALE');
    g.pool.splice(g.pool.indexOf(cardId), 1);
    if (valid) {
      g.scores[g.team]++;
      g.phaseScores[g.phase - 1][g.team]++;
    } else g.invalid[g.phase - 1]++;
    g.lastResult = {
      cardId,
      valid,
      at: this.now(),
      team: g.team,
      phase: g.phase,
      turnId: g.turnId,
      reviewed: !valid || g.reviewedCards.includes(cardId),
    };
    if (!g.pool.length) this.finishPhase(room);
    else this.draw(room);
  }
  resolveChallenge(room, invalid) {
    const g = room.game;
    const c = g.challenge;
    requireThat(c, 'Bekleyen itiraz yok.');
    g.challenge = null;
    if (c.target === 'last') {
      if (invalid) {
        g.scores[c.team]--;
        g.phaseScores[g.phase - 1][c.team]--;
        g.invalid[g.phase - 1]++;
        g.lastResult.valid = false;
      }
      g.lastResult.reviewed = true;
    } else {
      g.reviewedCards.push(c.cardId);
      if (invalid) this.score(room, false);
    }
    if (!g.pool.length) this.finishPhase(room);
    else {
      room.status = 'paused';
      room.notice = invalid
        ? 'İhlal kabul edildi. Kelime puansız çıkarıldı; devam etmeye hazır.'
        : 'İtiraz reddedildi. Aynı kelime ve kalan süreyle devam edilecek.';
    }
  }
  /** Validate and apply one command; per-card and per-turn IDs reject stale clicks. */
  act(room, playerId, type, data = {}) {
    requireThat(data && typeof data === 'object' && !Array.isArray(data), 'İstek biçimi geçersiz.');
    this.tickRoom(room);
    requireThat(this.rooms.get(room.code) === room, 'Oda kapanmış.', 'ROOM_GONE');
    const p = this.player(room, playerId);
    requireThat(p?.connected, 'Önce odaya yeniden bağlan.', 'SESSION_GONE');
    const admin = () =>
      requireThat(room.adminId === p.id, 'Bu işlem yalnızca oda yöneticisine açık.', 'FORBIDDEN');
    const lobby = () =>
      requireThat(room.status === 'lobby', 'Bu işlem yalnızca lobide yapılabilir.');
    const g = room.game;
    switch (type) {
      case 'save-words': {
        lobby();
        requireThat(
          data.wordsVersion === room.wordsVersion,
          'Kelime adedi değişti. Güncel alanları kontrol et.',
          'SETTINGS_CHANGED',
        );
        requireThat(
          Array.isArray(data.words) && data.words.length === room.settings.wordsPerPlayer,
          'Kelime sayısını kontrol et.',
        );
        const words = data.words.map((w) => text(w, 0, 40, 'Kelime'));
        requireThat(typeof data.submitted === 'boolean', 'Gönderim bilgisi geçersiz.');
        requireThat(!data.submitted || words.every(Boolean), 'Bütün kelimeleri doldur.');
        p.words = words;
        p.submitted = data.submitted;
        break;
      }
      case 'switch-team':
        lobby();
        p.team = other(p.team);
        break;
      case 'shuffle-teams': {
        admin();
        lobby();
        const mixed = shuffle(room.players);
        mixed.forEach((p, i) => {
          p.team = i % 2 ? 'blue' : 'red';
        });
        room.notice = 'Takımlar karıştırıldı. Kelimelerin sende kaldı.';
        break;
      }
      case 'settings': {
        admin();
        requireThat(data.version === room.version, 'Oda değişti. Ayarı yeniden seç.', 'STALE');
        const duration =
          data.turnDuration === undefined
            ? room.settings.turnDuration
            : integer(data.turnDuration, 30, 120, 'Tur süresi');
        if (data.wordsPerPlayer !== undefined) {
          lobby();
          integer(data.wordsPerPlayer, 5, 10, 'Kelime adedi');
        }
        if (data.wordsPerPlayer !== undefined) {
          lobby();
          const count = integer(data.wordsPerPlayer, 5, 10, 'Kelime adedi');
          if (count !== room.settings.wordsPerPlayer) {
            room.settings.wordsPerPlayer = count;
            room.wordsVersion++;
            for (const q of room.players) {
              q.words = Array.from({ length: count }, (_, i) => q.words[i] || '');
              q.submitted = false;
            }
            room.notice = 'Kelime adedi değişti. Yazılarını kontrol edip yeniden onayla.';
          }
        }
        room.settings.turnDuration = duration;
        break;
      }
      case 'start-game': {
        admin();
        lobby();
        requireThat(this.enough(room), 'Her takımda en az iki bağlı oyuncu olmalı.');
        requireThat(
          room.players.every((p) => p.connected && p.submitted),
          'Herkes bağlanmalı ve kelimelerini onaylamalı.',
        );
        const cards = room.players.flatMap((p) => p.words.map((word) => ({ id: id(), word })));
        const team = randomInt(2) ? 'blue' : 'red';
        room.game = {
          phase: 1,
          cards,
          pool: shuffle(cards.map((c) => c.id)),
          currentId: null,
          team,
          describerId: null,
          lastDescriber: { red: null, blue: null },
          turnId: id(),
          remainingMs: room.settings.turnDuration * 1000,
          deadline: null,
          countdownEnd: null,
          scores: { red: 0, blue: 0 },
          phaseScores: Array.from({ length: 4 }, () => ({ red: 0, blue: 0 })),
          invalid: [0, 0, 0, 0],
          lastResult: null,
          challenge: null,
          reviewedCards: [],
        };
        room.game.describerId = this.chooseDescriber(room, team);
        room.status = 'ready';
        room.notice = 'İlk takım kura ile seçildi. Anlatıcı hazırsa başlasın.';
        break;
      }
      case 'start-turn': {
        requireThat(g && room.status === 'ready', 'Tur şu an başlatılamaz.');
        requireThat(
          p.id === g.describerId && data.turnId === g.turnId,
          'Sıra sende değil.',
          'FORBIDDEN',
        );
        requireThat(this.enough(room), 'Her takımda iki bağlı kişi gerekiyor.');
        this.draw(room);
        g.deadline = this.now() + g.remainingMs;
        room.status = 'playing';
        break;
      }
      case 'correct': {
        requireThat(
          g && room.status === 'playing' && this.remaining(room) > 0,
          'Tur şu an aktif değil.',
          'STALE',
        );
        requireThat(
          g.describerId === p.id,
          'Doğruyu yalnızca anlatıcı işaretleyebilir.',
          'FORBIDDEN',
        );
        requireThat(
          data.cardId === g.currentId && data.turnId === g.turnId,
          'Bu kelime veya tur değişti.',
          'STALE',
        );
        this.score(room, true);
        break;
      }
      case 'challenge': {
        requireThat(
          g && ['playing', 'transition', 'finished'].includes(room.status),
          'Şu an itiraz edilemez.',
        );
        requireThat(p.team !== g.team, 'İtirazı karşı takım yapabilir.', 'FORBIDDEN');
        requireThat(data.turnId === g.turnId, 'Tur değişti.', 'STALE');
        const last = g.lastResult;
        const isLast =
          last &&
          last.cardId === data.cardId &&
          last.valid &&
          !last.reviewed &&
          last.turnId === g.turnId &&
          this.now() - last.at <= LIMITS.reviewMs;
        const isCurrent =
          room.status === 'playing' &&
          data.cardId === g.currentId &&
          !g.reviewedCards.includes(data.cardId);
        requireThat(
          isLast || isCurrent,
          'Bu kelime için itiraz süresi bitti veya karar verildi.',
          'STALE',
        );
        this.freeze(room);
        g.challenge = {
          cardId: data.cardId,
          by: p.nickname,
          team: g.team,
          target: isLast ? 'last' : 'current',
        };
        room.status = 'challenge';
        room.notice = 'İtiraz var. Süre durdu; yönetici karar verecek.';
        break;
      }
      case 'resolve-challenge':
        admin();
        requireThat(
          room.status === 'challenge' && typeof data.invalid === 'boolean',
          'Bekleyen itiraz yok.',
        );
        this.resolveChallenge(room, data.invalid);
        break;
      case 'next-phase': {
        admin();
        requireThat(g && room.status === 'transition', 'Aşama henüz tamamlanmadı.');
        requireThat(
          !g.lastResult || this.now() - g.lastResult.at > LIMITS.reviewMs || g.lastResult.reviewed,
          'Son kelime için itiraz süresinin bitmesini bekle.',
        );
        requireThat(this.enough(room), 'Devam etmek için her takımda iki bağlı kişi olmalı.');
        g.phase++;
        g.pool = shuffle(g.cards.map((c) => c.id));
        g.currentId = null;
        g.lastResult = null;
        g.reviewedCards = [];
        if (g.remainingMs > 0 && this.player(room, g.describerId)?.connected) {
          room.status = 'countdown';
          g.countdownEnd = this.now() + 3000;
        } else this.nextTurn(room);
        break;
      }
      case 'resume-game': {
        admin();
        requireThat(g && room.status === 'paused', 'Oyun duraklatılmış değil.');
        requireThat(this.enough(room), 'Her takımda en az iki bağlı oyuncu olmalı.');
        requireThat(
          this.player(room, g.describerId)?.connected,
          'Anlatıcının geri dönmesini bekle veya oyuncuyu odadan çıkar.',
        );
        if (g.remainingMs <= 0) this.nextTurn(room);
        else if (!g.currentId) room.status = 'ready';
        else {
          room.status = 'countdown';
          g.countdownEnd = this.now() + 3000;
        }
        break;
      }
      case 'pause-game':
        admin();
        requireThat(
          g && ['playing', 'ready', 'countdown'].includes(room.status),
          'Oyun zaten bekliyor.',
        );
        this.pause(room, 'Yönetici oyunu duraklattı.');
        break;
      case 'return-lobby':
        admin();
        requireThat(g, 'Zaten lobidesin.');
        room.status = 'lobby';
        room.game = null;
        room.wordsVersion++;
        room.players.forEach((q) => {
          q.words = [];
          q.submitted = false;
        });
        room.notice = 'Yeni oyun, yeni kelimeler. Fanus yeniden dolsun!';
        break;
      case 'kick':
        admin();
        requireThat(
          typeof data.playerId === 'string' &&
            data.playerId !== p.id &&
            this.player(room, data.playerId),
          'Geçersiz oyuncu.',
        );
        this.remove(room, data.playerId);
        break;
      case 'transfer-admin':
        admin();
        requireThat(this.player(room, data.playerId)?.connected, 'Bağlı bir oyuncu seç.');
        room.adminId = data.playerId;
        break;
      case 'leave':
        this.remove(room, p.id);
        return;
      default:
        throw new GameError('Bilinmeyen işlem.');
    }
    this.touch(room);
  }
  tickRoom(room) {
    let changed = false;
    const now = this.now();
    const g = room.game;
    if (room.status === 'playing' && g.deadline <= now) {
      this.freeze(room);
      this.nextTurn(room);
      changed = true;
    }
    if (room.status === 'countdown' && g.countdownEnd <= now) {
      g.countdownEnd = null;
      if (!this.enough(room) || !this.player(room, g.describerId)?.connected)
        this.pause(room, 'Oyuncu bekleniyor.');
      else {
        if (!g.currentId) this.draw(room);
        g.deadline = now + g.remainingMs;
        room.status = 'playing';
      }
      changed = true;
    }
    for (const p of [...room.players]) {
      if (
        !p.connected &&
        p.disconnectedAt !== null &&
        now - p.disconnectedAt >= LIMITS.reconnectMs
      ) {
        this.remove(room, p.id);
        changed = true;
      }
    }
    if (now - room.updatedAt >= LIMITS.roomTtlMs) {
      this.rooms.delete(room.code);
      changed = true;
    }
    if (changed) this.touch(room);
    return changed;
  }
  /** Build a separate projection per recipient; never broadcast the hidden pool. */
  view(room, playerId) {
    const p = this.player(room, playerId);
    if (!p) return null;
    const g = room.game;
    const visible = g && (p.id === g.describerId || p.team !== g.team);
    const card = (cardId) => {
      const c = g?.cards.find((c) => c.id === cardId);
      return c ? { ...c } : null;
    };
    const last = g?.lastResult;
    return {
      code: room.code,
      version: room.version,
      wordsVersion: room.wordsVersion,
      status: room.status,
      settings: { ...room.settings },
      adminId: room.adminId,
      me: p.id,
      notice: room.notice,
      limits: { players: LIMITS.players },
      players: room.players.map((q) => ({
        id: q.id,
        nickname: q.nickname,
        team: q.team,
        avatar: q.avatar,
        connected: q.connected,
        count: q.words.filter(Boolean).length,
        submitted: q.submitted,
      })),
      myWords: room.status === 'lobby' ? [...p.words] : [],
      game: g
        ? {
            phase: g.phase,
            rule: PHASES[g.phase - 1],
            total: g.cards.length,
            remaining: g.pool.length,
            team: g.team,
            describerId: g.describerId,
            turnId: g.turnId,
            timeMs: this.remaining(room),
            countdown: g.countdownEnd
              ? Math.max(0, Math.ceil((g.countdownEnd - this.now()) / 1000))
              : 0,
            scores: { ...g.scores },
            phaseScores: structuredClone(g.phaseScores),
            invalid: [...g.invalid],
            word: visible && g.currentId ? card(g.currentId) : null,
            lastWord:
              visible && last && this.now() - last.at <= LIMITS.reviewMs
                ? {
                    ...card(last.cardId),
                    valid: last.valid,
                    reviewable: last.valid && !last.reviewed,
                  }
                : null,
            reviewMs:
              last && !last.reviewed
                ? Math.max(0, LIMITS.reviewMs - (this.now() - last.at) + 1)
                : 0,
            canChallenge:
              visible &&
              p.team !== g.team &&
              room.status === 'playing' &&
              !g.reviewedCards.includes(g.currentId),
            challenge: g.challenge
              ? { by: g.challenge.by, word: visible ? card(g.challenge.cardId)?.word : null }
              : null,
          }
        : null,
    };
  }
  serialize() {
    return {
      schema: 1,
      rooms: [...this.rooms.values()].map((room) => {
        const copy = structuredClone(room);
        if (copy.game) {
          copy.game.remainingMs = this.remaining(room);
          copy.game.deadline = null;
          copy.game.countdownEnd = null;
        }
        return copy;
      }),
    };
  }
  restore(data) {
    requireThat(data?.schema === 1 && Array.isArray(data.rooms), 'Kayıt biçimi desteklenmiyor.');
    for (const room of data.rooms) {
      if (this.now() - room.updatedAt >= LIMITS.roomTtlMs) continue;
      room.players.forEach((p) => {
        p.connected = false;
        p.disconnectedAt = this.now();
      });
      if (room.game && ['playing', 'ready', 'countdown', 'paused'].includes(room.status)) {
        room.status = 'paused';
        room.notice = 'Sunucu yeniden başladı. Herkes bağlanınca yönetici devam ettirebilir.';
      }
      this.rooms.set(room.code, room);
    }
  }
}
module.exports = { GameStore, GameError, PHASES, AVATARS, LIMITS };
