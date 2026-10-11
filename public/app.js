'use strict';
const $ = (id) => document.getElementById(id);
const socket = io({ autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 4000 });
const avatars = ['🦊', '🐻', '🐸', '🐱', '🐼', '🐨', '🦉', '🐙'];
const animalNames = ['Tilki', 'Ayı', 'Kurbağa', 'Kedi', 'Panda', 'Koala', 'Baykuş', 'Ahtapot'];
const phaseNames = ['Kelime Anlat', 'Tek Kelime', 'Sessiz Sinema', 'Ses ile Anlat'];
const state = {
  room: null,
  mode: 'create',
  avatar: avatars[0],
  session: null,
  restoring: false,
  replaced: false,
  draftKey: null,
  draft: [],
  dirty: false,
  editNumber: 0,
  playSignature: '',
  sound: false,
};
const storage = {
  read(key, fallback, persistent = false) {
    try {
      const raw = (persistent ? localStorage : sessionStorage).getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value, persistent = false) {
    try {
      (persistent ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast('Tarayıcı kaydı kapalı. Sayfayı kapatırsan otomatik geri dönüş çalışmayabilir.');
      return false;
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Storage may be disabled; server session still expires. */
    }
  },
};
state.session = storage.read('kh-session', null);
state.sound = storage.read('kh-sound', false, true);
let draftTimer, toastTimer, audioContext, draftFlight;
const busy = new Set();
function node(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5500);
}
function showScreen(name) {
  for (const id of ['home-screen', 'lobby-screen', 'game-screen']) $(id).hidden = id !== name;
}
function actionButton(label, type, payload = {}, className = 'primary') {
  const b = node('button', className, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    await command(type, payload);
    if (b.isConnected) b.disabled = false;
  });
  return b;
}
function setConnection(message) {
  $('connection').replaceChildren(document.createTextNode(message));
  $('connection').hidden = !message;
  document.body.classList.toggle('connection-blocked', !!message);
}
function sound(kind = 'point') {
  if (!state.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume().catch(() => {
      /* Browser requires a gesture before sound. */
    });
    const osc = audioContext.createOscillator(),
      gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = kind === 'point' ? 740 : kind === 'turn' ? 250 : 520;
    gain.gain.setValueAtTime(0.09, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    osc.start();
    osc.stop(audioContext.currentTime + 0.21);
  } catch {
    toast('Bu tarayıcıda oyun sesi açılamadı.');
    state.sound = false;
  }
}
async function sendPacket(packet) {
  return new Promise((resolve) =>
    socket.timeout(4500).emit('command', packet, (error, response) =>
      resolve(
        error
          ? {
              ok: false,
              code: 'TIMEOUT',
              error: 'Yanıt gecikti. Bağlantını kontrol et; işlem durumu eşitleniyor.',
            }
          : response,
      ),
    ),
  );
}
async function command(type, payload = {}, { quiet = false, restoring = false } = {}) {
  if (!socket.connected || state.replaced || (state.restoring && !restoring)) {
    if (!quiet) toast('Bağlantı kurulunca tekrar dene.');
    return null;
  }
  if (busy.has(type)) return null;
  busy.add(type);
  const packet = { id: crypto.randomUUID(), type, payload };
  let result;
  try {
    result = await sendPacket(packet);
    if (result.code === 'TIMEOUT' && socket.connected) result = await sendPacket(packet); // Same id: never apply twice.
    if (!result.ok) {
      if (!quiet) toast(result.error);
      return result;
    }
    if (result.warning) toast(result.warning);
    if (result.session) {
      state.session = result.session;
      storage.write('kh-session', result.session);
    }
    return result;
  } finally {
    busy.delete(type);
  }
}
function ask(title, message, action = 'Onayla') {
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = action;
  const dialog = $('confirm-dialog');
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.close();
      $('confirm-ok').onclick = null;
      $('confirm-cancel').onclick = null;
      dialog.removeEventListener('cancel', cancel);
      resolve(result);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    $('confirm-ok').onclick = () => finish(true);
    $('confirm-cancel').onclick = () => finish(false);
    dialog.addEventListener('cancel', cancel);
    $('confirm-cancel').focus();
  });
}
function setMode(mode) {
  state.mode = mode;
  const join = mode === 'join';
  $('create-tab').setAttribute('aria-selected', String(!join));
  $('join-tab').setAttribute('aria-selected', String(join));
  $('join-fields').hidden = !join;
  $('room-code').required = join;
  $('entry-title').textContent = join ? 'Masada sana da yer var.' : 'Masa senin, davet senden.';
  $('entry-subtitle').textContent = join
    ? 'Arkadaşının paylaştığı oda kodunu gir.'
    : 'Odanı aç, kodunu arkadaşlarınla paylaş.';
  $('entry-submit').textContent = join ? 'Masaya katıl ↗' : 'Fanusu masaya koy ↗';
  $('entry-error').textContent = '';
}
$('create-tab').onclick = () => setMode('create');
$('join-tab').onclick = () => setMode('join');
for (const tab of [$('create-tab'), $('join-tab')])
  tab.onkeydown = (event) => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const next = tab.id === 'create-tab' ? $('join-tab') : $('create-tab');
      next.click();
      next.focus();
    }
  };
avatars.forEach((avatar, i) => {
  const button = node('button', '', avatar);
  button.type = 'button';
  button.setAttribute('aria-label', animalNames[i]);
  button.setAttribute('aria-pressed', String(i === 0));
  button.onclick = () => {
    state.avatar = avatar;
    [...$('avatars').children].forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  };
  $('avatars').append(button);
});
function papers(target, count, total) {
  const shown = count === 0 ? 0 : Math.max(1, Math.round(Math.min(1, count / total) * 38));
  if (target.childElementCount === shown) return;
  while (target.childElementCount > shown) target.lastElementChild.remove();
  const colors = ['#eec97e', '#e8a99d', '#9ebbb2', '#b8cce2', '#d7b8d7', '#e4d9ac'];
  while (target.childElementCount < shown) {
    const i = target.childElementCount;
    const paper = node('span', 'paper');
    paper.style.left = `${7 + ((i * 31) % 68)}%`;
    paper.style.bottom = `${4 + Math.floor(i / 5) * 7}%`;
    paper.style.setProperty('--rotation', `${((i * 37) % 68) - 34}deg`);
    paper.style.setProperty('--paper-color', colors[i % colors.length]);
    target.append(paper);
  }
}
papers($('hero-papers'), 25, 35);
$('entry-form').onsubmit = async (event) => {
  event.preventDefault();
  if (state.session && state.room) return;
  const payload = { nickname: $('nickname').value.trim(), avatar: state.avatar };
  if (state.mode === 'join') {
    payload.roomCode = $('room-code').value.trim().toUpperCase();
    payload.team = document.querySelector('input[name=team]:checked').value;
  }
  $('entry-submit').disabled = true;
  $('entry-error').textContent = '';
  const result = await command(state.mode, payload, { quiet: true });
  if (!result?.ok)
    $('entry-error').textContent =
      result?.error || 'Sunucuya bağlanılıyor. Biraz sonra tekrar dene.';
  $('entry-submit').disabled = false;
};
const invited = new URL(location.href).searchParams.get('room');
if (invited) {
  setMode('join');
  $('room-code').value = invited.slice(0, 6).toUpperCase();
}
function clearSession() {
  clearTimeout(draftTimer);
  storage.remove('kh-session');
  if (state.draftKey) storage.remove(state.draftKey);
  state.session = null;
  state.room = null;
  state.draftKey = null;
  state.dirty = false;
  state.playSignature = '';
  $('restore-box').hidden = true;
  showScreen('home-screen');
}
async function restore() {
  if (!state.session || state.restoring) return;
  state.restoring = true;
  setConnection('Masadaki yerine geri bağlanılıyor…');
  const result = await command('resume', state.session, { restoring: true, quiet: true });
  state.restoring = false;
  if (!socket.connected) return;
  if (result?.ok) {
    setConnection('');
    if (state.dirty) scheduleDraft();
  } else if (result && ['SESSION_GONE', 'ROOM_GONE'].includes(result.code)) {
    clearSession();
    setConnection('');
    toast(result.error);
  } else {
    setConnection('Bağlantı kurulamadı.');
    const retry = node('button', 'secondary', 'Tekrar bağlan');
    retry.onclick = restore;
    $('connection').append(retry);
    $('restore-box').hidden = false;
    if (socket.connected && result?.code === 'TIMEOUT')
      setTimeout(() => {
        if (state.session && !state.restoring && !state.replaced) restore();
      }, 2000);
  }
}
$('restore-box').hidden = !state.session;
$('restore-button').onclick = restore;
$('forget-button').onclick = async () => {
  if (
    await ask(
      'Oturum kaydı unutulsun mu?',
      'Bu sekmedeki geri dönüş anahtarı silinir. Devam eden oyuna aynı oyuncu olarak dönemeyebilirsin.',
      'Kaydı unut',
    )
  ) {
    clearSession();
    setConnection('');
  }
};
socket.on('connect', async () => {
  if (state.replaced) return;
  if (state.session) await restore();
  else setConnection('');
});
socket.on('disconnect', () => {
  if (!state.replaced)
    setConnection('Bağlantı kesildi. Yeniden bağlanıyoruz; yazdıkların bu sekmede duruyor.');
});
socket.on('connect_error', () => {
  setConnection(
    'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et; otomatik tekrar deniyoruz.',
  );
});
socket.on('session-replaced', () => {
  state.replaced = true;
  socket.disconnect();
  clearSession();
  setConnection('Bu oturum başka bir bağlantıda açıldı. Burada devam etmek için sayfayı yenile.');
});
socket.on('room-left', ({ kicked, expired }) => {
  clearSession();
  toast(
    kicked
      ? 'Yönetici seni odadan çıkardı.'
      : expired
        ? 'Odanın süresi doldu.'
        : 'Odadan ayrıldın.',
  );
});
socket.on('room-state', (room) => {
  const old = state.room;
  if (old?.code === room.code && room.version < old.version) return;
  state.room = room;
  if (old?.game && room.game) {
    if (room.game.scores.red + room.game.scores.blue > old.game.scores.red + old.game.scores.blue)
      sound();
    else if (room.game.turnId !== old.game.turnId) sound('turn');
  }
  if (room.status === 'lobby') {
    showScreen('lobby-screen');
    renderLobby(room, old);
  } else {
    showScreen('game-screen');
    renderGame(room);
  }
});
function me(room = state.room) {
  return room?.players.find((p) => p.id === room.me);
}
function isAdmin(room = state.room) {
  return room?.adminId === room?.me;
}
function renderPlayers(target, players, room, game = false) {
  // Rebuild only when roster/progress changes; timer ticks must not steal keyboard focus.
  const signature = JSON.stringify([players, room.adminId, room.me, room.game?.describerId, game]);
  if (target.dataset.signature === signature) return;
  target.dataset.signature = signature;
  target.replaceChildren();
  if (!players.length) target.append(node('li', 'empty-team', 'İlk takım arkadaşını bekliyor.'));
  for (const p of players) {
    const li = node('li', `player-row${p.connected ? '' : ' offline'}`);
    const avatar = node('span', 'player-avatar', p.avatar);
    avatar.setAttribute('aria-hidden', 'true');
    li.append(avatar);
    const detail = node('span', 'player-detail');
    detail.append(node('span', 'player-name', `${p.nickname}${p.id === room.me ? ' (sen)' : ''}`));
    const labels = [];
    if (p.id === room.adminId) labels.push('Yönetici');
    if (!p.connected) labels.push('Geri bağlanıyor');
    else if (game)
      labels.push(
        `${p.team === 'red' ? 'Kırmızı' : 'Mavi'}${p.id === room.game.describerId ? ' · Anlatıcı' : ''}`,
      );
    else labels.push(p.submitted ? 'Hazır' : p.count ? 'Yazıyor' : 'Henüz yazmadı');
    detail.append(node('span', 'player-meta', labels.join(' · ')));
    li.append(detail);
    if (!game)
      li.append(
        node(
          'span',
          'player-count',
          `${p.count}/${room.settings.wordsPerPlayer}${p.submitted ? ' ✓' : ''}`,
        ),
      );
    if (isAdmin(room) && p.id !== room.me) {
      const actions = node('span', 'player-actions');
      const kick = node('button', 'quiet danger', 'Çıkar');
      kick.setAttribute('aria-label', `${p.nickname} adlı oyuncuyu çıkar`);
      kick.onclick = async () => {
        if (
          await ask(
            'Oyuncu çıkarılsın mı?',
            `${p.nickname} odadan ayrılacak. Oyun başladıysa yazdığı kelimeler havuzda kalır.`,
            'Oyuncuyu çıkar',
          )
        )
          await command('kick', { playerId: p.id });
      };
      actions.append(kick);
      if (!game && p.connected) {
        const transfer = node('button', 'quiet', '★');
        transfer.setAttribute('aria-label', `Yöneticiliği ${p.nickname} adlı oyuncuya ver`);
        transfer.onclick = async () => {
          if (
            await ask(
              'Yöneticilik devredilsin mi?',
              `${p.nickname} oda ayarlarını ve itirazları yönetecek.`,
              'Devret',
            )
          )
            await command('transfer-admin', { playerId: p.id });
        };
        actions.prepend(transfer);
      }
      li.append(actions);
    }
    target.append(li);
  }
}
function renderLobby(room, previous) {
  state.playSignature = '';
  const myself = me(room);
  const admin = isAdmin(room);
  const total = room.players.length * room.settings.wordsPerPlayer,
    count = room.players.reduce((n, p) => n + p.count, 0);
  $('lobby-code').textContent = room.code;
  $('lobby-notice').textContent = room.notice;
  $('player-count').textContent = `${room.players.length} kişi`;
  $('pool-count').textContent = count;
  $('pool-target').textContent = ` / ${total} kelime`;
  $('pool-remaining').textContent =
    total - count
      ? `${total - count} kâğıt daha bekleniyor`
      : 'Fanus doldu. Son onaylar bekleniyor.';
  $('lobby-jar').setAttribute('aria-label', `Fanusta ${total} kelimeden ${count} tanesi var.`);
  papers($('lobby-papers'), count, total);
  $('my-progress').textContent = `${myself.count}/${room.settings.wordsPerPlayer}`;
  for (const team of ['red', 'blue']) {
    const players = room.players.filter((p) => p.team === team);
    $(team + '-count').textContent = `${players.length} kişi`;
    renderPlayers($(team + '-players'), players, room);
  }
  $('setting-words').value = room.settings.wordsPerPlayer;
  $('setting-duration').value = room.settings.turnDuration;
  $('setting-words').disabled = !admin;
  $('setting-duration').disabled = !admin;
  document.querySelectorAll('#lobby-screen .admin-control').forEach((el) => {
    el.hidden = !admin;
  });
  const enough = ['red', 'blue'].every(
    (team) => room.players.filter((p) => p.team === team && p.connected).length >= 2,
  );
  const pending = room.players.filter((p) => !p.submitted || !p.connected);
  $('start-game').disabled = !enough || pending.length > 0;
  $('start-reason').textContent = !enough
    ? 'Başlamak için her takımda en az iki bağlı kişi olmalı.'
    : pending.length
      ? `${pending.length} kişinin bağlantısı veya kelime onayı bekleniyor.`
      : admin
        ? 'Herkes hazır. Fanusu karıştırma zamanı!'
        : 'Herkes hazır. Yönetici oyunu başlatacak.';
  if (!pending.length) $('pool-remaining').textContent = 'Bütün kâğıtlar hazır!';
  const key = `kh-draft:${room.code}:${room.me}:${room.wordsVersion}`;
  if (state.draftKey !== key) {
    const carry =
      previous?.status === 'lobby' &&
      previous.code === room.code &&
      previous.wordsVersion !== room.wordsVersion
        ? [...state.draft]
        : null;
    clearTimeout(draftTimer);
    if (state.draftKey) storage.remove(state.draftKey);
    state.draftKey = key;
    const local = storage.read(key, null);
    state.draft = Array.from(
      { length: room.settings.wordsPerPlayer },
      (_, i) => carry?.[i] ?? local?.words?.[i] ?? room.myWords[i] ?? '',
    );
    state.dirty =
      !myself.submitted &&
      (!!local?.dirty || (!!carry && state.draft.some((w, i) => w !== (room.myWords[i] || ''))));
    $('word-inputs').replaceChildren();
    state.draft.forEach((word, i) => {
      const row = node('div', 'word-row');
      const label = node('label', '', `${String(i + 1).padStart(2, '0')}`);
      label.htmlFor = `word-${i}`;
      const input = node('input');
      input.id = `word-${i}`;
      input.name = `word-${i}`;
      input.setAttribute('aria-label', `${i + 1}. kelime veya ifade`);
      input.maxLength = 40;
      input.autocomplete = 'off';
      input.placeholder = [
        'Bir nesne…',
        'Bir karakter…',
        'Bir yer…',
        'Bir hareket…',
        'Aklına gelen bir şey…',
      ][i % 5];
      input.value = word;
      input.oninput = () => {
        state.draft[i] = input.value;
        state.dirty = true;
        state.editNumber++;
        storage.write(state.draftKey, { words: state.draft, dirty: true });
        $('draft-status').textContent = 'Kaydediliyor…';
        scheduleDraft();
        updateSubmit();
      };
      input.onkeydown = (event) => {
        if (event.key === 'Enter' && i < state.draft.length - 1) {
          event.preventDefault();
          $(`word-${i + 1}`).focus();
        }
      };
      row.append(label, input);
      $('word-inputs').append(row);
    });
    if (state.dirty) scheduleDraft();
  }
  $('words-form').hidden = myself.submitted;
  $('submitted-box').hidden = !myself.submitted;
  $('writing-hint').hidden = myself.submitted;
  updateSubmit();
}
function updateSubmit() {
  $('submit-words').disabled = !state.draft.every((w) => w.trim()) || !socket.connected;
}
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveWords(false), 500);
}
async function saveWords(submitted) {
  if (!state.room || state.room.status !== 'lobby') return;
  const number = state.editNumber;
  const key = state.draftKey;
  const payload = { words: [...state.draft], wordsVersion: state.room.wordsVersion, submitted };
  const flight = command('save-words', payload, { quiet: !submitted });
  draftFlight = flight;
  const result = await flight;
  if (draftFlight === flight) draftFlight = null;
  if (result?.ok && key === state.draftKey && number === state.editNumber) {
    state.dirty = false;
    storage.write(key, { words: state.draft, dirty: false });
    $('draft-status').textContent = 'Kaydedildi. Kelimelerini yalnızca sen görebilirsin.';
  } else if (result && !result.ok) {
    $('draft-status').textContent = result.error;
  } else if (state.dirty && socket.connected) scheduleDraft();
  return result;
}
$('words-form').onsubmit = async (event) => {
  event.preventDefault();
  clearTimeout(draftTimer);
  $('submit-words').disabled = true;
  if (draftFlight) await draftFlight;
  clearTimeout(draftTimer);
  const result = await saveWords(true);
  if (!result?.ok) {
    updateSubmit();
    if (!result) toast('Taslak kaydı tamamlanınca tekrar onayla.');
  }
};
$('edit-words').onclick = async () => {
  await saveWords(false);
};
$('switch-team').onclick = () => command('switch-team');
$('shuffle-teams').onclick = async () => {
  if (
    await ask(
      'Takımlar karıştırılsın mı?',
      'Herkes rastgele iki takıma dağılır. Kelimeleriniz korunur.',
      'Karıştır',
    )
  )
    await command('shuffle-teams');
};
$('start-game').onclick = () => command('start-game');
$('setting-words').onchange = async () => {
  const value = Number($('setting-words').value);
  const room = state.room;
  if (
    room.players.some((p) => p.count) &&
    !(await ask(
      'Kelime adedi değişsin mi?',
      'Yazılmış kelimeler yeni sınıra kadar korunur. Azaltırsan son alanlar silinir. Herkes yeniden onaylamalı.',
      'Değiştir',
    ))
  ) {
    $('setting-words').value = room.settings.wordsPerPlayer;
    return;
  }
  await command('settings', { wordsPerPlayer: value, version: state.room.version });
};
for (const id of ['setting-duration', 'game-duration'])
  $(id).onchange = async () => {
    const result = await command('settings', {
      turnDuration: Number($(id).value),
      version: state.room.version,
    });
    if (result?.ok && state.room.status !== 'lobby') toast('Süre sonraki yeni turda uygulanacak.');
  };
$('copy-invite').onclick = async () => {
  const link = `${location.origin}/?room=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Davet bağlantısı kopyalandı. Arkadaşlarına gönder!');
  } catch {
    toast(`Kopyalama kullanılamıyor. Oda kodu: ${state.room.code}`);
  }
};
async function leave() {
  if (
    await ask(
      'Masadan ayrılmak istiyor musun?',
      'Bu oyuncu kaydı silinecek. Oyun başladıysa sonraki oyuna kadar yeniden katılamazsın.',
      'Odadan ayrıl',
    )
  ) {
    const result = await command('leave');
    if (result?.ok) clearSession();
  }
}
$('leave-lobby').onclick = leave;
$('leave-game').onclick = leave;
$('pause-game').onclick = () => command('pause-game');
$('reset-game').onclick = async () => {
  if (
    await ask(
      'Oyun bitirilsin mi?',
      'Puanlar ve bu oyunun kelimeleri silinir. Herkes yeni kelimeler yazmak için lobiye döner.',
      'Lobiye dön',
    )
  )
    await command('return-lobby');
};
function message(character, title, description) {
  const box = node('div', 'stage-message');
  box.append(
    node('div', 'character', character),
    node('h2', '', title),
    node('p', '', description),
  );
  return box;
}
function renderGame(room) {
  const g = room.game,
    myself = me(room),
    admin = isAdmin(room),
    narrator = room.players.find((p) => p.id === g.describerId);
  const describes = myself.id === g.describerId,
    opponent = myself.team !== g.team;
  $('game-room').textContent = `ODA ${room.code}`;
  $('phase-title').textContent = `${g.rule.icon} ${g.rule.name}`;
  $('score-red').textContent = g.scores.red;
  $('score-blue').textContent = g.scores.blue;
  if ($('phase-track').dataset.phase !== String(g.phase)) {
    $('phase-track').dataset.phase = g.phase;
    $('phase-track').replaceChildren(
      ...phaseNames.map((name, i) => {
        const li = node(
          'li',
          i + 1 === g.phase ? 'active' : i + 1 < g.phase ? 'done' : '',
          `${i + 1}. ${name}`,
        );
        if (i + 1 === g.phase) li.setAttribute('aria-current', 'step');
        return li;
      }),
    );
  }
  $('role-label').textContent = describes
    ? 'Sen anlatıyorsun'
    : opponent
      ? 'Rakip takım · Hakem sensin'
      : 'Sen tahmin ediyorsun';
  $('remaining-count').textContent = `${g.remaining} / ${g.total} kelime kaldı`;
  $('describer-label').textContent = narrator
    ? `${narrator.avatar} ${narrator.nickname} · ${g.team === 'red' ? 'Kırmızı' : 'Mavi'} takım`
    : 'Anlatıcı bekleniyor';
  $('timer').textContent = Math.ceil(g.timeMs / 1000);
  $('timer').classList.toggle('urgent', room.status === 'playing' && g.timeMs <= 10000);
  $('game-rule').textContent = g.rule.rule;
  $('game-duration').value = room.settings.turnDuration;
  $('game-duration').disabled = !admin;
  document.querySelectorAll('#game-screen .admin-control').forEach((el) => {
    el.hidden = !admin;
  });
  $('pause-game').hidden = !admin || !['playing', 'ready', 'countdown'].includes(room.status);
  renderPlayers($('game-players'), room.players, room, true);
  const signature = JSON.stringify([
    room.status,
    room.me,
    room.adminId,
    g.phase,
    g.turnId,
    g.word,
    g.lastWord,
    g.challenge,
    g.scores,
    g.phaseScores,
    g.invalid,
    g.canChallenge,
    g.reviewMs > 0,
    room.players.map((p) => [p.id, p.connected]),
    room.notice,
  ]);
  if (state.playSignature === signature) {
    const counter = $('countdown-number');
    if (counter) counter.textContent = g.countdown;
    const review = $('review-time');
    if (review) review.textContent = `${Math.ceil(g.reviewMs / 1000)} sn itiraz süresi`;
    return;
  }
  state.playSignature = signature;
  const target = $('play-content');
  target.replaceChildren();
  if (room.status === 'ready') {
    const box = message(
      describes ? myself.avatar : '🫙',
      describes ? 'Sahne senin!' : `${narrator?.nickname || 'Anlatıcı'} hazırlanıyor`,
      describes
        ? 'Takım arkadaşların hazır mı? Başlayınca kelimen ve süren açılır.'
        : 'Anlatıcı başlayınca süre işleyecek.',
    );
    if (describes)
      box.append(
        actionButton('Hazırım, kelimeyi çek ↗', 'start-turn', { turnId: g.turnId }, 'primary wide'),
      );
    target.append(box);
  } else if (room.status === 'playing') {
    const card = node('div', `word-card${g.word ? '' : ' hidden-card'}`);
    if (g.word)
      card.append(
        node('span', 'small', describes ? 'TAKIMINA ANLAT' : 'KELİMEYİ SESLİ SÖYLEME'),
        node('p', 'word', g.word.word),
      );
    else
      card.append(
        node('span', 'character', '👂'),
        node('h2', '', 'Kulaklar sende!'),
        node('p', 'small', 'Takım arkadaşını dinle, aklına geleni söyle.'),
      );
    target.append(card);
    const row = node('div', 'action-row');
    if (describes)
      row.append(
        actionButton(
          '✓ Bildiler!',
          'correct',
          { cardId: g.word.id, turnId: g.turnId },
          'primary correct-button',
        ),
      );
    else if (opponent) {
      const b = actionButton(
        'Anlatım kuralına itiraz et',
        'challenge',
        { cardId: g.word.id, turnId: g.turnId },
        'secondary',
      );
      b.disabled = !g.canChallenge;
      row.append(b);
    }
    if (row.childElementCount) target.append(row);
    target.append(
      node(
        'p',
        'result-note',
        describes
          ? 'Pas yok. Bilinmezse süre bitince kelime fanusta kalır.'
          : opponent
            ? 'Yalnızca anlatım kuralı ihlal edilirse itiraz et. Süre durur, yönetici karar verir.'
            : 'Doğru tahmini anlatıcı işaretler. Her doğru 1 puan.',
      ),
    );
  } else if (room.status === 'paused') {
    const box = message('⏸', 'Masa seni bekler.', room.notice);
    if (admin) {
      const enough = ['red', 'blue'].every(
        (team) => room.players.filter((p) => p.team === team && p.connected).length >= 2,
      );
      const resume = actionButton('Kaldığımız yerden devam', 'resume-game', {}, 'primary wide');
      resume.disabled = !enough || !narrator?.connected;
      box.append(resume);
      if (resume.disabled)
        box.append(
          node(
            'p',
            'small',
            'Eksik oyuncuyu bekle. Geri dönemiyorsa listeden çıkarabilir veya lobiye dönebilirsin.',
          ),
        );
    } else box.append(node('p', 'small', 'Yönetici oyunu devam ettirecek.'));
    target.append(box);
  } else if (room.status === 'countdown') {
    const box = message('🫙', 'Hazır mısınız?', 'Kalan süreyle devam ediyoruz.');
    const count = node('div', 'countdown', g.countdown);
    count.id = 'countdown-number';
    box.append(count);
    target.append(box);
  } else if (room.status === 'challenge') {
    const box = message(
      '✋',
      'Bir saniye, itiraz var.',
      `${g.challenge.by} anlatım kuralına itiraz etti. Süre durduruldu.`,
    );
    if (g.challenge.word) box.append(node('p', 'word', g.challenge.word));
    if (admin) {
      box.append(
        node(
          'p',
          'small',
          'İhlal varsa bu kelime puansız çıkarılır. Son doğru kelimeyse puanı geri alınır.',
        ),
      );
      const row = node('div', 'action-row');
      row.append(
        actionButton('İhlal var, sayılmasın', 'resolve-challenge', { invalid: true }),
        actionButton('İhlal yok', 'resolve-challenge', { invalid: false }, 'secondary'),
      );
      box.append(row);
    } else box.append(node('p', 'small', 'Yönetici iki tarafı dinleyip karar verecek.'));
    target.append(box);
  } else if (room.status === 'transition') {
    const box = message(
      '🎉',
      'Fanus boşaldı!',
      `Sıradaki: ${phaseNames[g.phase]}. Aynı kelimeler, yeni anlatım şekli.`,
    );
    box.append(
      node(
        'p',
        'small',
        `${Math.ceil(g.timeMs / 1000)} saniye kaldı. Süre varsa aynı anlatıcı devam eder.`,
      ),
    );
    if (g.reviewMs > 0) {
      const wait = node('p', 'small', `${Math.ceil(g.reviewMs / 1000)} sn itiraz süresi`);
      wait.id = 'review-time';
      box.append(wait);
    }
    if (admin) {
      const b = actionButton('Sonraki aşamaya geç ↗', 'next-phase', {}, 'primary wide');
      b.disabled = g.reviewMs > 0;
      box.append(b);
    } else box.append(node('p', 'small', 'Yönetici sonraki aşamayı başlatacak.'));
    target.append(box);
  } else if (room.status === 'finished') {
    const draw = g.scores.red === g.scores.blue;
    const box = message(
      draw ? '🤝' : '🏆',
      draw
        ? 'Bu masada dostluk kazandı!'
        : `${g.scores.red > g.scores.blue ? 'Kırmızı' : 'Mavi'} takım kazandı!`,
      draw
        ? 'Puanlar eşit. Rövanşa ne dersiniz?'
        : 'Dört aşama, bir sürü ortak hikâye. Rövanşa var mısınız?',
    );
    const table = node('table', 'score-table');
    table.append(node('caption', '', 'Aşama aşama puanlar'));
    const head = node('thead'),
      header = node('tr');
    ['Aşama', 'Kırmızı', 'Mavi', 'İhlal'].forEach((s) => {
      const th = node('th', '', s);
      th.scope = 'col';
      header.append(th);
    });
    head.append(header);
    table.append(head);
    const body = node('tbody');
    g.phaseScores.forEach((scores, i) => {
      const tr = node('tr');
      tr.append(
        node('td', '', phaseNames[i]),
        node('td', '', scores.red),
        node('td', '', scores.blue),
        node('td', '', g.invalid[i]),
      );
      body.append(tr);
    });
    table.append(body);
    box.append(table);
    if (g.reviewMs > 0)
      box.append(node('p', 'small', 'Son kelimenin itiraz süresi bitince sonuç kesinleşir.'));
    if (admin) {
      const button = node('button', 'primary wide', 'Yeni oyun, yeni kelimeler ↗');
      button.disabled = g.reviewMs > 0;
      button.onclick = () => command('return-lobby');
      box.append(button);
    } else box.append(node('p', 'small', 'Yönetici yeni oyunu açabilir.'));
    target.append(box);
  }
  if (
    opponent &&
    g.lastWord?.reviewable &&
    ['playing', 'transition', 'finished'].includes(room.status)
  ) {
    const row = node('div', 'review-row');
    row.append(
      node('span', '', `Son doğru: ${g.lastWord.word}`),
      actionButton(
        'Son doğruya itiraz',
        'challenge',
        { cardId: g.lastWord.id, turnId: g.turnId },
        'secondary',
      ),
    );
    target.append(row);
  }
}
$('rules-button').onclick = () => $('rules-dialog').showModal();
document.querySelectorAll('[data-close]').forEach((button) => {
  button.onclick = () => $(button.dataset.close).close();
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-button').textContent = theme === 'dark' ? '☀' : '☾';
  $('theme-button').setAttribute(
    'aria-label',
    theme === 'dark' ? 'Gündüz temasını aç' : 'Gece temasını aç',
  );
  $('theme-button').setAttribute('aria-pressed', String(theme === 'dark'));
  document.querySelector('meta[name=theme-color]').content =
    theme === 'dark' ? '#182822' : '#f6f4ed';
}
applyTheme(storage.read('kh-theme', 'light', true));
$('theme-button').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  storage.write('kh-theme', theme, true);
};
function renderSound() {
  $('sound-button').setAttribute('aria-pressed', String(state.sound));
  $('sound-button').setAttribute(
    'aria-label',
    state.sound ? 'Oyun seslerini kapat' : 'Oyun seslerini aç',
  );
  $('sound-button').textContent = state.sound ? '♫' : '♪';
}
renderSound();
$('sound-button').onclick = () => {
  state.sound = !state.sound;
  storage.write('kh-sound', state.sound, true);
  renderSound();
  if (state.sound) sound();
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !socket.connected && !state.replaced) socket.connect();
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
setConnection('Oyun masasına bağlanılıyor…');
socket.connect();
