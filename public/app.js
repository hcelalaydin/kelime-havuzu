/* ═══════════════════════════════════════════════
   Kelime Havuzu — Frontend Uygulama
   Socket.IO ile gerçek zamanlı iletişim
   ═══════════════════════════════════════════════ */

// ─── Socket.IO bağlantısı ───
const socket = io();

// ─── Durum yönetimi ───
const state = {
  mySocketId: null,
  roomCode: null,
  nickname: null,
  team: null,
  isAdmin: false,
  currentScreen: 'home-screen',
  roomState: null,
  currentWord: null,
  isMuted: localStorage.getItem('muted') === 'true',
  selectedJoinTeam: 'red'
};

// ─── Ses sistemi (Web Audio API) ───
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Askıya alınmış AudioContext'i devam ettir (mobil cihazlar için gerekli)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const SoundEffects = {
  // Kısa "ding" sesi — doğru tahmin
  ding() {
    if (state.isMuted) return;
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  },

  // Buzzer sesi — süre doldu
  buzzer() {
    if (state.isMuted) return;
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  },

  // Tick sesi — son 10 saniye
  tick() {
    if (state.isMuted) return;
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  },

  // Kısa jingle — faz geçişi
  jingle() {
    if (state.isMuted) return;
    const ctx = getAudioContext();
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.25);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.25);
    });
  },

  // Kutlama sesi — oyun sonu
  celebration() {
    if (state.isMuted) return;
    const ctx = getAudioContext();
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.3);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.3);
    });
  }
};

// ─── Ekran yönetimi ───
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(screenId);
  if (screen) {
    screen.classList.add('active');
    state.currentScreen = screenId;
  }
}

// ─── Bildirim (toast) ───
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

// ─── Yardımcı fonksiyonlar ───
function getPhaseInfo(phase) {
  const phases = {
    1: { name: 'Kelime Anlat', icon: '🗣️' },
    2: { name: 'Tek Kelime', icon: '☝️' },
    3: { name: 'Sessiz Sinema', icon: '🤫' },
    4: { name: 'Ses ile Anlat', icon: '🔊' }
  };
  return phases[phase] || phases[1];
}

// ═══════════════════════════════════════════
// ANA EKRAN — Olay dinleyicileri
// ═══════════════════════════════════════════

// Oda Oluştur
document.getElementById('btn-create').addEventListener('click', () => {
  const nickname = document.getElementById('create-nickname').value.trim();
  if (!nickname || nickname.length < 2 || nickname.length > 20) {
    showToast('Takma ad 2-20 karakter olmalıdır.');
    return;
  }
  state.nickname = nickname;
  socket.emit('create-room', { nickname });
});

// Takım seçimi (katılma formundaki)
document.getElementById('join-team-red').addEventListener('click', () => {
  state.selectedJoinTeam = 'red';
  document.getElementById('join-team-red').classList.add('active');
  document.getElementById('join-team-blue').classList.remove('active');
});

document.getElementById('join-team-blue').addEventListener('click', () => {
  state.selectedJoinTeam = 'blue';
  document.getElementById('join-team-blue').classList.add('active');
  document.getElementById('join-team-red').classList.remove('active');
});

// Odaya Katıl
document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const nickname = document.getElementById('join-nickname').value.trim();

  if (!code || code.length !== 6) {
    showToast('6 haneli oda kodunu gir.');
    return;
  }
  if (!nickname || nickname.length < 2 || nickname.length > 20) {
    showToast('Takma ad 2-20 karakter olmalıdır.');
    return;
  }

  state.nickname = nickname;
  state.roomCode = code;
  socket.emit('join-room', { roomCode: code, nickname, team: state.selectedJoinTeam });
});

// Kurallar modal
document.getElementById('btn-rules').addEventListener('click', () => {
  document.getElementById('rules-modal').style.display = 'flex';
});

document.getElementById('btn-close-rules').addEventListener('click', () => {
  document.getElementById('rules-modal').style.display = 'none';
});

// Son oyuna dön
document.getElementById('btn-rejoin').addEventListener('click', () => {
  const lastRoom = localStorage.getItem('lastRoomCode');
  const lastNick = localStorage.getItem('lastNickname');
  if (lastRoom && lastNick) {
    state.nickname = lastNick;
    state.roomCode = lastRoom;
    socket.emit('join-room', { roomCode: lastRoom, nickname: lastNick, team: 'red' });
  }
});

// Son oyun kontrolü
const lastRoom = localStorage.getItem('lastRoomCode');
const lastNick = localStorage.getItem('lastNickname');
if (lastRoom && lastNick) {
  document.getElementById('rejoin-section').style.display = 'block';
}

// ═══════════════════════════════════════════
// LOBİ EKRANI — Olay dinleyicileri
// ═══════════════════════════════════════════

// Oda kodunu kopyala
document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('lobby-room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Oda kodu kopyalandı!');
  }).catch(() => {
    showToast('Kopyalama başarısız.');
  });
});

// Takım değiştir
document.getElementById('btn-switch-team').addEventListener('click', () => {
  socket.emit('switch-team');
});

// Kelime yaz ekranına git
document.getElementById('btn-write-words').addEventListener('click', () => {
  if (!state.roomState) return;

  // Kelimeleri zaten gönderdi mi kontrol et
  const me = findMyself();
  if (me && me.wordsSubmitted) {
    showToast('Kelimelerin zaten gönderildi.');
    return;
  }

  const count = state.roomState.settings.wordsPerPlayer;
  document.getElementById('word-entry-info').textContent = `${count} kelime yazman gerekiyor`;

  // Input alanlarını oluştur
  const container = document.getElementById('word-inputs');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'word-input-row';
    row.innerHTML = `
      <span class="word-number">${i + 1}.</span>
      <input type="text" class="input word-input" maxlength="40" placeholder="Kelime ${i + 1}" autocomplete="off">
    `;
    container.appendChild(row);
  }

  // Otomatik odaklanma (focus)
  const inputs = container.querySelectorAll('.word-input');
  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      checkWordInputs();
      // Doluysa sonraki input'a geç
      if (input.value.trim() && idx < inputs.length - 1) {
        // Enter tuşuyla geçişi de kontrol et (aşağıda)
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && idx < inputs.length - 1) {
        e.preventDefault();
        inputs[idx + 1].focus();
      }
      if (e.key === 'Enter' && idx === inputs.length - 1) {
        e.preventDefault();
        const btn = document.getElementById('btn-submit-words');
        if (!btn.disabled) btn.click();
      }
    });
  });

  // İlk input'a odaklan
  if (inputs.length > 0) inputs[0].focus();

  showScreen('word-entry-screen');
});

// Kelime girişlerini kontrol et
function checkWordInputs() {
  const inputs = document.querySelectorAll('.word-input');
  const allFilled = Array.from(inputs).every(i => i.value.trim().length > 0);
  document.getElementById('btn-submit-words').disabled = !allFilled;
}

// Kelimeleri gönder
document.getElementById('btn-submit-words').addEventListener('click', () => {
  const inputs = document.querySelectorAll('.word-input');
  const words = Array.from(inputs).map(i => i.value.trim());

  const allValid = words.every(w => w.length >= 1 && w.length <= 40);
  if (!allValid) {
    showToast('Her kelime 1-40 karakter olmalıdır.');
    return;
  }

  socket.emit('submit-words', { words });
  showScreen('lobby-screen');
});

// Lobiye dön
document.getElementById('btn-back-lobby').addEventListener('click', () => {
  showScreen('lobby-screen');
});

// Ayarlar değişiklikleri (admin)
document.getElementById('setting-words').addEventListener('change', (e) => {
  socket.emit('update-settings', { wordsPerPlayer: e.target.value });
});

document.getElementById('setting-duration').addEventListener('change', (e) => {
  socket.emit('update-settings', { turnDuration: e.target.value });
});

// Oyunu başlat (admin)
document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('start-game');
});

// ═══════════════════════════════════════════
// OYUN EKRANI — Olay dinleyicileri
// ═══════════════════════════════════════════

// Anlatıcı "Başla" butonuna bastı
document.getElementById('btn-start-turn').addEventListener('click', () => {
  socket.emit('describer-ready');
});

// Doğru butonu
document.getElementById('btn-correct').addEventListener('click', () => {
  socket.emit('word-correct');
});

// Ses açma/kapama
document.getElementById('btn-mute').addEventListener('click', () => {
  state.isMuted = !state.isMuted;
  localStorage.setItem('muted', state.isMuted);
  document.getElementById('btn-mute').textContent = state.isMuted ? '🔇' : '🔊';
});

// Ses butonunu başlangıçta ayarla
document.getElementById('btn-mute').textContent = state.isMuted ? '🔇' : '🔊';

// ═══════════════════════════════════════════
// FAZ GEÇİŞ EKRANI — Olay dinleyicileri
// ═══════════════════════════════════════════

document.getElementById('btn-next-phase').addEventListener('click', () => {
  socket.emit('next-phase');
});

// ═══════════════════════════════════════════
// OYUN SONU — Olay dinleyicileri
// ═══════════════════════════════════════════

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('return-to-lobby');
});

document.getElementById('btn-go-home').addEventListener('click', () => {
  location.reload();
});

// ═══════════════════════════════════════════
// Socket.IO — Olay işleyicileri
// ═══════════════════════════════════════════

// Bağlantı kurulduğunda socket ID'yi kaydet
socket.on('connect', () => {
  state.mySocketId = socket.id;
});

// Oda oluşturuldu
socket.on('room-created', ({ roomCode }) => {
  state.roomCode = roomCode;
  state.isAdmin = true;
  localStorage.setItem('lastRoomCode', roomCode);
  localStorage.setItem('lastNickname', state.nickname);
  showScreen('lobby-screen');
});

// Hata mesajı
socket.on('error', ({ message }) => {
  showToast(message);
});

// Ses çal
socket.on('play-sound', ({ soundType }) => {
  if (SoundEffects[soundType]) {
    SoundEffects[soundType]();
  }
});

// Timer güncellemesi
socket.on('timer-update', ({ timeRemaining }) => {
  const timerEl = document.getElementById('game-timer');
  timerEl.textContent = timeRemaining;

  // Son 10 saniye uyarısı
  if (timeRemaining <= 10) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }
});

// Kelime (sadece anlatıcıya)
socket.on('new-word', ({ word }) => {
  state.currentWord = word;
  const wordEl = document.getElementById('current-word');
  wordEl.textContent = word;
  // Kelime değişim animasyonu
  wordEl.classList.remove('word-success');
  void wordEl.offsetWidth; // reflow tetikle
  wordEl.style.animation = 'none';
  void wordEl.offsetWidth;
  wordEl.style.animation = '';
});

// Kelime doğru bilindi
socket.on('word-guessed', ({ newScore, wordsRemaining }) => {
  // Başarı animasyonu
  const wordEl = document.getElementById('current-word');
  wordEl.classList.add('word-success');
  setTimeout(() => wordEl.classList.remove('word-success'), 300);
});

// Anlatıcıya sıra geldi
socket.on('your-turn', ({ phase, phaseRule }) => {
  // Ekranın oyun ekranında olduğundan emin ol
  if (state.currentScreen !== 'game-screen') {
    showScreen('game-screen');
  }
});

// Tur sonu
socket.on('turn-end', ({ nextDescriber, nextTeam }) => {
  state.currentWord = null;
});

// Faz sonu
socket.on('phase-end', ({ phaseNumber, scores, phaseScores, nextPhase, nextPhaseRule, timeRemaining }) => {
  document.getElementById('phase-complete-title').textContent = `🎉 Faz ${phaseNumber} Tamamlandı!`;
  document.getElementById('pt-score-red').textContent = scores.red;
  document.getElementById('pt-score-blue').textContent = scores.blue;

  const phaseInfo = getPhaseInfo(nextPhase);
  document.getElementById('next-phase-name').textContent = `Sıradaki: Faz ${nextPhase} — ${phaseInfo.name}`;
  document.getElementById('next-phase-rule').textContent = nextPhaseRule.rule;

  showScreen('phase-transition-screen');
});

// Oyun bitti
socket.on('game-over', ({ finalScores, phaseScores, winner }) => {
  // Kazanan gösterimi
  const winnerText = document.getElementById('winner-text');
  const winnerDisplay = document.getElementById('winner-display');

  if (winner === 'red') {
    winnerText.textContent = '🏆 Kırmızı Takım Kazandı!';
    winnerText.className = 'winner-text winner-red';
  } else if (winner === 'blue') {
    winnerText.textContent = '🏆 Mavi Takım Kazandı!';
    winnerText.className = 'winner-text winner-blue';
  } else {
    winnerText.textContent = '🤝 Berabere!';
    winnerText.className = 'winner-text winner-draw';
  }

  // Animasyonu yeniden başlat
  winnerDisplay.style.animation = 'none';
  void winnerDisplay.offsetWidth;
  winnerDisplay.style.animation = '';

  // Puanlar
  document.getElementById('go-score-red').textContent = finalScores.red;
  document.getElementById('go-score-blue').textContent = finalScores.blue;

  // Faz tablosu
  const tbody = document.getElementById('phase-table-body');
  tbody.innerHTML = '';
  const phaseNames = ['Kelime Anlat', 'Tek Kelime', 'Sessiz Sinema', 'Ses ile Anlat'];
  for (let i = 1; i <= 4; i++) {
    const row = document.createElement('tr');
    const ps = phaseScores[i] || { red: 0, blue: 0 };
    row.innerHTML = `<td>${phaseNames[i - 1]}</td><td>${ps.red}</td><td>${ps.blue}</td>`;
    tbody.appendChild(row);
  }

  // Toplam satırı
  const totalRow = document.createElement('tr');
  totalRow.innerHTML = `<td><strong>Toplam</strong></td><td><strong>${finalScores.red}</strong></td><td><strong>${finalScores.blue}</strong></td>`;
  tbody.appendChild(totalRow);

  showScreen('game-over-screen');
});

// Oyun başladı
socket.on('game-started', () => {
  showScreen('game-screen');
});

// Yeni admin
socket.on('new-admin', ({ nickname }) => {
  if (nickname === state.nickname) {
    state.isAdmin = true;
    showToast('Sen artık Admin\'sin! ⭐');
  }
});

// Oyuncu koptu
socket.on('player-disconnected', ({ nickname }) => {
  showToast(`${nickname} bağlantısı koptu...`);
});

// ═══════════════════════════════════════════
// room-state — Ana durum güncelleyici
// ═══════════════════════════════════════════

socket.on('room-state', (roomState) => {
  state.roomState = roomState;
  state.roomCode = roomState.code;
  state.isAdmin = roomState.admin === state.mySocketId;

  // localStorage güncelle
  localStorage.setItem('lastRoomCode', roomState.code);
  localStorage.setItem('lastNickname', state.nickname);

  // Hangi ekrandayız?
  if (roomState.status === 'lobby') {
    if (state.currentScreen === 'home-screen') {
      showScreen('lobby-screen');
    }
    renderLobby(roomState);
  } else if (roomState.status === 'playing') {
    if (state.currentScreen !== 'game-screen') {
      showScreen('game-screen');
    }
    renderGame(roomState);
  } else if (roomState.status === 'phase-transition') {
    renderPhaseTransition(roomState);
  } else if (roomState.status === 'game-over') {
    renderGameOver(roomState);
  } else if (roomState.status === 'paused') {
    if (state.currentScreen !== 'game-screen') {
      showScreen('game-screen');
    }
    renderGame(roomState);
    showToast('Oyun duraklatıldı — oyuncu bekleniyor...');
  }
});

// ═══════════════════════════════════════════
// Render fonksiyonları
// ═══════════════════════════════════════════

function findMyself() {
  if (!state.roomState) return null;
  const allPlayers = [...state.roomState.teams.red, ...state.roomState.teams.blue];
  return allPlayers.find(p => p.id === state.mySocketId);
}

function findMyTeam() {
  if (!state.roomState) return null;
  if (state.roomState.teams.red.some(p => p.id === state.mySocketId)) return 'red';
  if (state.roomState.teams.blue.some(p => p.id === state.mySocketId)) return 'blue';
  return null;
}

// ─── Lobi render ───
function renderLobby(rs) {
  // Oda kodu
  document.getElementById('lobby-room-code').textContent = rs.code;

  // Ayarlar
  const settingsSection = document.getElementById('settings-section');
  if (state.isAdmin) {
    settingsSection.style.display = '';
    document.getElementById('setting-words').value = rs.settings.wordsPerPlayer;
    document.getElementById('setting-duration').value = rs.settings.turnDuration;
    document.getElementById('setting-words').disabled = false;
    document.getElementById('setting-duration').disabled = false;
  } else {
    // Ayarları göster ama düzenlemeyi engelle
    settingsSection.style.display = '';
    document.getElementById('setting-words').value = rs.settings.wordsPerPlayer;
    document.getElementById('setting-duration').value = rs.settings.turnDuration;
    document.getElementById('setting-words').disabled = true;
    document.getElementById('setting-duration').disabled = true;
  }

  // Takım listeleri
  renderTeamList('team-red-list', rs.teams.red, 'red', rs);
  renderTeamList('team-blue-list', rs.teams.blue, 'blue', rs);

  // Minimum oyuncu uyarısı
  const warning = document.getElementById('min-players-warning');
  if (rs.teams.red.length < 2 || rs.teams.blue.length < 2) {
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
  }

  // Kelime yazma butonu — gönderdiyse devre dışı
  const me = findMyself();
  const writeBtn = document.getElementById('btn-write-words');
  if (me && me.wordsSubmitted) {
    writeBtn.textContent = '✅ Kelimeler Gönderildi';
    writeBtn.disabled = true;
  } else {
    writeBtn.textContent = '✏️ Kelimelerimi Yaz';
    writeBtn.disabled = false;
  }

  // Oyunu başlat butonu (admin)
  const startBtn = document.getElementById('btn-start-game');
  if (state.isAdmin) {
    startBtn.style.display = 'block';
    const canStart = rs.teams.red.length >= 2 && rs.teams.blue.length >= 2 &&
      [...rs.teams.red, ...rs.teams.blue].every(p => p.wordsSubmitted);
    startBtn.disabled = !canStart;
  } else {
    startBtn.style.display = 'none';
  }
}

function renderTeamList(containerId, players, teamColor, rs) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  players.forEach(player => {
    const li = document.createElement('li');
    li.className = 'player-item';

    // Bağlantı kopuksa soluk göster
    if (!player.connected) {
      li.style.opacity = '0.4';
    }

    let nameHtml = `<span class="player-name">`;
    // Admin ikonu
    if (player.id === rs.admin) {
      nameHtml += '⭐ ';
    }
    // Sıradaki anlatıcı oku
    if (rs.game && rs.game.turnOrder) {
      const isCurrentDescriber =
        rs.game.currentDescriberTeam === teamColor &&
        rs.game.turnOrder[teamColor][rs.game.currentDescriberIndex[teamColor]] === player.nickname;
      if (isCurrentDescriber) {
        nameHtml += '→ ';
      }
    }
    nameHtml += player.nickname;
    nameHtml += '</span>';

    // Durum ikonu
    let statusHtml = '<span class="player-status">';
    if (player.wordsSubmitted) {
      statusHtml += '✅';
    } else {
      statusHtml += '⏳';
    }
    statusHtml += '</span>';

    // Admin: Kick butonu (kendini atmaz)
    let kickHtml = '';
    if (state.isAdmin && player.id !== state.mySocketId) {
      kickHtml = `<button class="player-kick" data-nickname="${player.nickname}">✕</button>`;
    }

    li.innerHTML = nameHtml + statusHtml + kickHtml;
    container.appendChild(li);
  });

  // Kick butonları için olay dinleyicileri
  container.querySelectorAll('.player-kick').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('kick-player', { targetNickname: btn.dataset.nickname });
    });
  });
}

// ─── Oyun ekranı render ───
function renderGame(rs) {
  if (!rs.game) return;

  const game = rs.game;
  const myTeam = findMyTeam();
  const amDescriber = game.currentDescriberNickname === state.nickname &&
    game.currentDescriberTeam === myTeam;

  // HUD güncellemeleri
  document.getElementById('hud-score-red').textContent = game.scores.red;
  document.getElementById('hud-score-blue').textContent = game.scores.blue;

  const phaseInfo = getPhaseInfo(game.currentPhase);
  document.getElementById('hud-phase').textContent = `Faz ${game.currentPhase}/4: ${phaseInfo.name}`;
  document.getElementById('hud-words-left').textContent = `Havuzda ${game.wordsRemaining} kelime`;

  // Aktif anlatıcı
  const describerTeamIcon = game.currentDescriberTeam === 'red' ? '🔴' : '🔵';
  document.getElementById('hud-active-describer').textContent =
    `${describerTeamIcon} ${game.currentDescriberNickname} anlatıyor`;

  // Faz kuralı banner
  document.getElementById('phase-rule-text').textContent = `${phaseInfo.icon} ${phaseInfo.name}`;

  // Timer
  const timerEl = document.getElementById('game-timer');
  timerEl.textContent = game.timeRemaining;
  if (game.timeRemaining <= 10 && game.timerRunning) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }

  // Tüm rol görünümlerini gizle
  const roleViews = ['describer-waiting', 'describer-active', 'guesser-view', 'spectator-view', 'waiting-view', 'phase-countdown-view'];
  roleViews.forEach(id => document.getElementById(id).style.display = 'none');

  // Faz geri sayımı varsa (3-2-1)
  if (game.phaseCountdown > 0) {
    document.getElementById('phase-countdown-view').style.display = 'flex';
    document.getElementById('countdown-number').textContent = game.phaseCountdown;
    return;
  }

  // Ben anlatıcıyım
  if (amDescriber) {
    if (!game.describerReady && !game.timerRunning) {
      // Başla butonunu göster
      document.getElementById('describer-waiting').style.display = 'flex';
      const ruleDetail = document.getElementById('waiting-phase-rule');
      ruleDetail.textContent = `${phaseInfo.icon} ${phaseInfo.name}`;
    } else if (game.timerRunning) {
      // Aktif anlatıcı — kelime + doğru butonu
      document.getElementById('describer-active').style.display = 'flex';
      if (state.currentWord) {
        document.getElementById('current-word').textContent = state.currentWord;
      }
    } else {
      // Bekleme (örn. faz geçişi sonrası)
      document.getElementById('waiting-view').style.display = 'flex';
      document.getElementById('waiting-msg').textContent = 'Hazırlanıyor...';
    }
  }
  // Takım arkadaşım anlatıyor
  else if (game.currentDescriberTeam === myTeam) {
    if (game.timerRunning) {
      document.getElementById('guesser-view').style.display = 'flex';
    } else {
      document.getElementById('waiting-view').style.display = 'flex';
      document.getElementById('waiting-msg').textContent = `${game.currentDescriberNickname} hazırlanıyor...`;
    }
  }
  // Rakip takım anlatıyor
  else {
    if (game.timerRunning) {
      document.getElementById('spectator-view').style.display = 'flex';
      const teamName = game.currentDescriberTeam === 'red' ? 'Kırmızı' : 'Mavi';
      document.getElementById('spectator-info').textContent =
        `${game.currentDescriberNickname} ${teamName} takım için anlatıyor...`;
    } else {
      document.getElementById('waiting-view').style.display = 'flex';
      document.getElementById('waiting-msg').textContent = `${game.currentDescriberNickname} hazırlanıyor...`;
    }
  }
}

// ─── Faz geçişi render ───
function renderPhaseTransition(rs) {
  if (state.currentScreen !== 'phase-transition-screen') {
    showScreen('phase-transition-screen');
  }

  // Admin butonu
  const nextPhaseBtn = document.getElementById('btn-next-phase');
  const adminWait = document.getElementById('pt-admin-wait');

  if (state.isAdmin) {
    nextPhaseBtn.style.display = 'block';
    adminWait.style.display = 'none';
  } else {
    nextPhaseBtn.style.display = 'none';
    adminWait.style.display = 'block';
  }
}

// ─── Oyun sonu render ───
function renderGameOver(rs) {
  if (state.currentScreen !== 'game-over-screen') {
    showScreen('game-over-screen');
  }

  // Yeni oyun butonu (admin)
  const newGameBtn = document.getElementById('btn-new-game');
  if (state.isAdmin) {
    newGameBtn.style.display = 'block';
  } else {
    newGameBtn.style.display = 'none';
  }
}
