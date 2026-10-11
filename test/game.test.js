'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameStore, GameError, LIMITS } = require('../src/game');
function fixture(count = 4) {
  let time = 100000;
  const store = new GameStore({ now: () => time });
  const first = store.create({ nickname: 'Oyuncu 0' });
  const members = [first];
  for (let i = 1; i < count; i++)
    members.push(
      store.join({
        roomCode: first.room.code,
        nickname: `Oyuncu ${i}`,
        team: i % 2 ? 'blue' : 'red',
      }),
    );
  const room = first.room;
  const act = (p, type, data) =>
    store.act(room, typeof p === 'string' ? p : p.player.id, type, data);
  const fill = () =>
    members.forEach((m, j) =>
      act(m, 'save-words', {
        wordsVersion: room.wordsVersion,
        words: Array.from({ length: room.settings.wordsPerPlayer }, (_, i) => `${j} kelime ${i}`),
        submitted: true,
      }),
    );
  const start = () => {
    fill();
    act(first, 'start-game');
  };
  const draw = () => act(room.game.describerId, 'start-turn', { turnId: room.game.turnId });
  const correct = () =>
    act(room.game.describerId, 'correct', {
      turnId: room.game.turnId,
      cardId: room.game.currentId,
    });
  const advance = (ms) => {
    time += ms;
    store.tickRoom(room);
  };
  return { store, room, members, first, act, fill, start, draw, correct, advance };
}
for (const count of [4, 5, 6, 7, 8, 9, 32])
  test(`${count} players complete all phases with exact score conservation`, () => {
    const f = fixture(count);
    f.start();
    f.draw();
    const original = f.room.game.cards.map((c) => c.id).sort();
    const total = count * 5;
    for (let phase = 1; phase <= 4; phase++) {
      assert.equal(f.room.game.phase, phase);
      assert.deepEqual([...f.room.game.pool].sort(), original);
      const narrator = f.room.game.describerId;
      const turn = f.room.game.turnId;
      for (let i = 0; i < total; i++) f.correct();
      assert.equal(f.room.game.scores.red + f.room.game.scores.blue, total * phase);
      assert.equal(f.room.game.pool.length, 0);
      if (phase < 4) {
        assert.equal(f.room.status, 'transition');
        f.advance(5001);
        f.act(f.first, 'next-phase');
        assert.equal(f.room.status, 'countdown');
        assert.equal(f.room.game.describerId, narrator);
        assert.equal(f.room.game.turnId, turn);
        assert.throws(() => f.draw(), GameError);
        f.advance(3000);
        assert.equal(f.room.status, 'playing');
      }
    }
    assert.equal(f.room.status, 'finished');
    f.advance(5001);
    f.act(f.first, 'return-lobby');
    assert.equal(f.room.status, 'lobby');
    assert.equal(f.room.game, null);
    assert(f.room.players.every((p) => !p.submitted && !p.words.length));
  });
test('hidden words and session hashes never leave narrator/opponent projections', () => {
  const f = fixture(7);
  f.start();
  f.draw();
  const g = f.room.game;
  for (const p of f.room.players) {
    const view = f.store.view(f.room, p.id);
    const exposed = p.id === g.describerId || p.team !== g.team;
    assert.equal(!!view.game.word, exposed);
    assert.deepEqual(view.myWords, []);
    assert(!JSON.stringify(view).includes('tokenHash'));
    assert(!JSON.stringify(view).includes('wordPool'));
    assert(!('cards' in view.game));
  }
  const guessingAdmin = f.room.players.find((p) => p.team === g.team && p.id !== g.describerId);
  f.room.adminId = guessingAdmin.id;
  const opponent = f.room.players.find((p) => p.team !== g.team);
  f.act(opponent.id, 'challenge', { cardId: g.currentId, turnId: g.turnId });
  assert.equal(f.store.view(f.room, guessingAdmin.id).game.challenge.word, null);
});
test('draft counts visible, draft text private, revisions preserve data and invalidate old submissions', () => {
  const f = fixture(5);
  const words = ['gizli kelime', '', 'uzaylı', '', ''];
  f.act(f.first, 'save-words', { wordsVersion: 1, words, submitted: false });
  assert.equal(f.store.view(f.room, f.members[1].player.id).players[0].count, 2);
  assert(!JSON.stringify(f.store.view(f.room, f.members[1].player.id)).includes('gizli kelime'));
  f.act(f.first, 'settings', { wordsPerPlayer: 7, version: f.room.version });
  assert.equal(f.first.player.words.length, 7);
  assert.equal(f.first.player.words[0], words[0]);
  assert.throws(
    () => f.act(f.first, 'save-words', { wordsVersion: 1, words, submitted: true }),
    /adedi değişti/,
  );
  assert.throws(() => f.act(f.first, 'start-game'), /onaylamalı/);
});
test('duplicate words are separate slips; duplicate correct and old turn clicks cannot score twice', () => {
  const f = fixture();
  f.members.forEach((m) =>
    f.act(m, 'save-words', { wordsVersion: 1, words: Array(5).fill('aynı'), submitted: true }),
  );
  f.act(f.first, 'start-game');
  f.draw();
  const g = f.room.game,
    payload = { cardId: g.currentId, turnId: g.turnId },
    actor = g.describerId;
  f.correct();
  assert.equal(g.pool.length, 19);
  assert.equal(g.scores.red + g.scores.blue, 1);
  assert.throws(() => f.act(actor, 'correct', payload), /değişti/);
  assert.equal(g.pool.length, 19);
  const nextPayload = { cardId: g.currentId, turnId: g.turnId };
  f.advance(60000);
  assert.throws(() => f.act(actor, 'correct', nextPayload), GameError);
  assert.equal(g.scores.red + g.scores.blue, 1);
});
test('first turn of each team goes to its first member; circular rotation does not skip', () => {
  const f = fixture(8);
  f.start();
  const firstTeam = f.room.game.team;
  for (let turn = 0; turn < 8; turn++) {
    const g = f.room.game;
    const team = turn % 2 ? (firstTeam === 'red' ? 'blue' : 'red') : firstTeam;
    assert.equal(
      g.describerId,
      f.room.players.filter((p) => p.team === team)[Math.floor(turn / 2)].id,
    );
    f.draw();
    f.advance(60000);
  }
});
test('deadline wins against a late correct, new duration affects only the next turn', () => {
  const f = fixture();
  f.start();
  f.draw();
  f.advance(20000);
  f.act(f.first, 'settings', { turnDuration: 30, version: f.room.version });
  assert.equal(f.store.remaining(f.room), 40000);
  const actor = f.room.game.describerId,
    payload = { cardId: f.room.game.currentId, turnId: f.room.game.turnId };
  f.advance(40000);
  assert.throws(() => f.act(actor, 'correct', payload), GameError);
  assert.equal(f.room.game.remainingMs, 30000);
  assert.equal(f.room.game.scores.red + f.room.game.scores.blue, 0);
});
test('current-word challenge freezes exact time; invalid card is scoreless but returns next phase', () => {
  const f = fixture();
  f.start();
  f.draw();
  f.advance(2500);
  const g = f.room.game,
    original = g.currentId,
    opponent = f.room.players.find((p) => p.team !== g.team);
  f.act(opponent.id, 'challenge', { cardId: original, turnId: g.turnId });
  const remaining = f.store.remaining(f.room);
  f.advance(10000);
  assert.equal(f.store.remaining(f.room), remaining);
  assert.throws(() => f.correct(), GameError);
  f.act(f.first, 'resolve-challenge', { invalid: true });
  assert.equal(f.room.status, 'paused');
  assert.equal(g.invalid[0], 1);
  assert.equal(g.pool.length, 19);
  assert.equal(g.scores.red + g.scores.blue, 0);
  f.act(f.first, 'resume-game');
  f.advance(3000);
  while (f.room.status === 'playing') f.correct();
  f.advance(5001);
  f.act(f.first, 'next-phase');
  assert(g.pool.includes(original));
});
test('last correct can be challenged once including phase/game boundary without negative scores', () => {
  const f = fixture();
  f.start();
  f.draw();
  const g = f.room.game;
  while (f.room.status === 'playing') f.correct();
  const last = g.lastResult.cardId,
    opponent = f.room.players.find((p) => p.team !== g.team);
  f.act(opponent.id, 'challenge', { cardId: last, turnId: g.turnId });
  assert.equal(f.room.status, 'challenge');
  f.act(f.first, 'resolve-challenge', { invalid: true });
  assert.equal(f.room.status, 'transition');
  assert.equal(g.scores.red + g.scores.blue, 19);
  assert.throws(
    () => f.act(opponent.id, 'challenge', { cardId: last, turnId: g.turnId }),
    GameError,
  );
  f.act(f.first, 'next-phase');
  assert.equal(g.phase, 2);
});
test('rejected challenge cannot be spammed for the same current card', () => {
  const f = fixture();
  f.start();
  f.draw();
  const g = f.room.game,
    p = f.room.players.find((p) => p.team !== g.team);
  const payload = { cardId: g.currentId, turnId: g.turnId };
  f.act(p.id, 'challenge', payload);
  f.act(f.first, 'resolve-challenge', { invalid: false });
  f.act(f.first, 'resume-game');
  f.advance(3000);
  assert.throws(() => f.act(p.id, 'challenge', payload), GameError);
  f.correct();
  assert.equal(g.scores.red + g.scores.blue, 1);
});
test('narrator disconnect, authenticated resume, admin transfer and frozen clock', () => {
  const f = fixture();
  f.start();
  f.draw();
  f.advance(1000);
  const narrator = f.members.find((m) => m.player.id === f.room.game.describerId),
    word = f.room.game.currentId;
  f.store.disconnect(f.room, narrator.player.id);
  assert.equal(f.room.status, 'paused');
  f.advance(15000);
  assert.equal(f.store.remaining(f.room), 59000);
  assert.throws(() => f.store.resume({ roomCode: f.room.code, token: '0'.repeat(64) }), GameError);
  const resumed = f.store.resume({ roomCode: f.room.code, token: narrator.token });
  assert.equal(resumed.player.id, narrator.player.id);
  assert.equal(f.room.status, 'paused');
  f.act(f.room.adminId, 'resume-game');
  f.advance(3000);
  assert.equal(f.room.game.currentId, word);
  assert.equal(f.room.status, 'playing');
  f.store.disconnect(f.room, f.room.adminId);
  assert(f.store.player(f.room, f.room.adminId).connected);
});
test('non-narrator loss pauses only when fewer than two connected members remain', () => {
  const f = fixture(8);
  f.start();
  f.draw();
  const team = f.room.game.team;
  const candidates = f.room.players.filter(
    (p) => p.id !== f.room.game.describerId && p.team === team,
  );
  f.store.disconnect(f.room, candidates[0].id);
  assert.equal(f.room.status, 'playing');
  f.store.disconnect(f.room, candidates[1].id);
  assert.equal(f.room.status, 'playing');
  f.store.disconnect(f.room, candidates[2].id);
  assert.equal(f.room.status, 'paused');
});
test('disconnected player expiration and kicked narrator recover; cards remain in the pool', () => {
  const f = fixture(8);
  f.start();
  f.draw();
  const total = f.room.game.cards.length;
  const narrator = f.room.game.describerId;
  f.store.disconnect(f.room, narrator);
  f.advance(LIMITS.reconnectMs);
  assert(!f.store.player(f.room, narrator));
  assert.equal(f.room.game.cards.length, total);
  assert.equal(f.room.status, 'paused');
  f.act(f.room.adminId, 'resume-game');
  assert.equal(f.room.status, 'ready');
  f.draw();
  const target = f.room.game.describerId;
  if (target === f.room.adminId)
    f.act(f.room.adminId, 'transfer-admin', {
      playerId: f.room.players.find((p) => p.id !== target && p.connected).id,
    });
  f.act(f.room.adminId, 'kick', { playerId: target });
  assert.equal(f.room.status, 'paused');
  assert.notEqual(f.room.game.describerId, target);
});
test('countdown cancels on disconnect/reset; old countdown never starts a new game', () => {
  const f = fixture();
  f.start();
  f.draw();
  while (f.room.status === 'playing') f.correct();
  f.advance(5001);
  f.act(f.first, 'next-phase');
  const narrator = f.room.game.describerId;
  f.store.disconnect(f.room, narrator);
  f.advance(3000);
  assert.equal(f.room.status, 'paused');
  f.act(f.room.adminId, 'return-lobby');
  f.advance(10000);
  assert.equal(f.room.status, 'lobby');
  assert.equal(f.room.game, null);
});
test('snapshot restoration authenticates original players and resumes without counting downtime', () => {
  const f = fixture();
  f.start();
  f.draw();
  f.advance(12000);
  const data = f.store.serialize();
  const restored = new GameStore({ now: () => 190000 });
  restored.restore(data);
  const room = restored.rooms.get(f.room.code);
  assert.equal(room.status, 'paused');
  assert.equal(room.game.remainingMs, 48000);
  for (const m of f.members) restored.resume({ roomCode: room.code, token: m.token });
  restored.act(room, room.adminId, 'resume-game');
  assert.equal(room.status, 'countdown');
});
test('invalid payloads, out-of-order commands and unauthorized actions leave state intact', () => {
  const f = fixture();
  for (const nickname of [123, {}, [], null, '', '<svg onload=x>', 'x'.repeat(21)])
    assert.throws(() => f.store.create({ nickname }), GameError);
  assert.throws(
    () => f.act(f.members[1], 'settings', { turnDuration: 30, version: f.room.version }),
    GameError,
  );
  assert.throws(
    () =>
      f.act(f.first, 'settings', {
        turnDuration: 30,
        wordsPerPlayer: 100,
        version: f.room.version,
      }),
    GameError,
  );
  assert.equal(f.room.settings.turnDuration, 60);
  assert.throws(
    () =>
      f.act(f.first, 'save-words', { words: [1, 2, 3, 4, 5], submitted: true, wordsVersion: 1 }),
    GameError,
  );
  assert.throws(() => f.act(f.first, 'return-lobby'), GameError);
  assert.equal(f.room.status, 'lobby');
  f.start();
  assert.throws(() => f.act(f.first, 'start-game'), GameError);
  assert.throws(() => f.act(f.first, 'switch-team'), GameError);
  f.draw();
  const guesser = f.room.players.find((p) => p.id !== f.room.game.describerId);
  assert.throws(
    () =>
      f.act(guesser.id, 'correct', { cardId: f.room.game.currentId, turnId: f.room.game.turnId }),
    GameError,
  );
});
test('Turkish nickname normalization, player cap, and only-lobby new joins', () => {
  const f = fixture(32);
  assert.throws(
    () => f.store.join({ roomCode: f.room.code, nickname: 'Fazla', team: 'red' }),
    /32/,
  );
  const other = fixture();
  other.store.join({ roomCode: other.room.code, nickname: 'İPEK', team: 'red' });
  assert.throws(
    () => other.store.join({ roomCode: other.room.code, nickname: 'ipek', team: 'blue' }),
    /kullanılıyor/,
  );
  f.start();
  assert.throws(
    () => f.store.join({ roomCode: f.room.code, nickname: 'Yeni', team: 'red' }),
    /Oyun başladı/,
  );
});
test('narrator can leave at phase boundary without turning an empty pool into a stuck turn', () => {
  const f = fixture(8);
  f.start();
  f.draw();
  while (f.room.status === 'playing') f.correct();
  const narrator = f.room.game.describerId;
  f.store.remove(f.room, narrator);
  assert.equal(f.room.status, 'transition');
  f.advance(5001);
  f.act(f.room.adminId, 'next-phase');
  assert.equal(f.room.game.phase, 2);
  assert.equal(f.room.status, 'ready');
  f.draw();
  assert.equal(f.room.status, 'playing');
});
test('departure during a last-word challenge still finishes the phase', () => {
  const f = fixture(8);
  f.start();
  f.draw();
  while (f.room.status === 'playing') f.correct();
  const g = f.room.game,
    p = f.room.players.find((p) => p.team !== g.team);
  f.act(p.id, 'challenge', { cardId: g.lastResult.cardId, turnId: g.turnId });
  f.store.remove(f.room, g.describerId);
  assert.equal(f.room.status, 'transition');
  assert.equal(g.challenge, null);
  f.act(f.room.adminId, 'next-phase');
  assert.equal(g.phase, 2);
});
test('mixed actions retain deadline and score/pool invariants', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const f = fixture(5 + (seed % 4));
    f.start();
    let n = seed;
    const random = () => {
      n = (n * 1664525 + 1013904223) >>> 0;
      return n / 4294967296;
    };
    for (let step = 0; step < 250 && f.room.status !== 'finished'; step++) {
      const g = f.room.game;
      if (f.room.status === 'ready') f.draw();
      else if (f.room.status === 'playing') {
        const choice = random();
        if (choice < 0.65) f.correct();
        else if (choice < 0.75) f.advance(60000);
        else if (choice < 0.9 && !g.reviewedCards.includes(g.currentId)) {
          const p = f.room.players.find((p) => p.team !== g.team);
          f.act(p.id, 'challenge', { cardId: g.currentId, turnId: g.turnId });
          f.act(f.room.adminId, 'resolve-challenge', { invalid: random() < 0.5 });
        } else {
          f.act(f.room.adminId, 'pause-game');
        }
      } else if (f.room.status === 'paused') f.act(f.room.adminId, 'resume-game');
      else if (f.room.status === 'countdown') f.advance(3000);
      else if (f.room.status === 'transition') {
        f.advance(5001);
        f.act(f.room.adminId, 'next-phase');
      }
      const phase = g.phase - 1;
      assert.equal(
        g.phaseScores[phase].red + g.phaseScores[phase].blue + g.invalid[phase] + g.pool.length,
        g.cards.length,
      );
      assert.equal(
        g.scores.red,
        g.phaseScores.reduce((sum, s) => sum + s.red, 0),
      );
      assert.equal(
        g.scores.blue,
        g.phaseScores.reduce((sum, s) => sum + s.blue, 0),
      );
      assert(g.currentId === null || g.pool.includes(g.currentId));
      assert(f.store.remaining(f.room) >= 0);
    }
  }
});
test('last correct review survives a turn boundary and deducts from the original team', () => {
  const f = fixture();
  f.start();
  f.draw();
  f.advance(59900);
  const g = f.room.game;
  const scoredTeam = g.team;
  const opponent = f.room.players.find((p) => p.team !== scoredTeam);
  const guesser = f.room.players.find((p) => p.team === scoredTeam && p.id !== g.describerId);
  f.correct();
  const last = { cardId: g.lastResult.cardId, turnId: g.turnId };
  f.advance(100);
  assert.equal(f.room.status, 'ready');
  assert.notEqual(g.team, scoredTeam);
  assert(f.store.view(f.room, opponent.id).game.lastWord.reviewable);
  assert.equal(f.store.view(f.room, guesser.id).game.lastWord, null);
  f.act(opponent.id, 'challenge', last);
  f.act(f.room.adminId, 'resolve-challenge', { invalid: true });
  assert.equal(g.scores[scoredTeam], 0);
  assert.equal(g.invalid[0], 1);
  assert.equal(g.pool.length, 19);
  f.act(f.room.adminId, 'resume-game');
  assert.equal(f.room.status, 'ready');
});
test('a rejected challenge does not prevent judging the same word on a new turn', () => {
  const f = fixture();
  f.start();
  f.draw();
  const g = f.room.game;
  while (g.pool.length > 1) f.correct();
  const opponent = f.room.players.find((p) => p.team !== g.team);
  f.act(opponent.id, 'challenge', { cardId: g.currentId, turnId: g.turnId });
  f.act(f.room.adminId, 'resolve-challenge', { invalid: false });
  f.act(f.room.adminId, 'resume-game');
  f.advance(3000);
  f.advance(60000);
  f.draw();
  const newOpponent = f.room.players.find((p) => p.team !== g.team);
  f.act(newOpponent.id, 'challenge', { cardId: g.currentId, turnId: g.turnId });
  assert.equal(f.room.status, 'challenge');
});
