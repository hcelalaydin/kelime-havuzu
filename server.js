const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────
// Estado en memoria: mapa de roomCode → Room
// ─────────────────────────────────────────────────
const rooms = new Map();

// Mapa inverso socketId → roomCode para búsquedas rápidas
const socketRoomMap = new Map();

// ─────────────────────────────────────────────────
// Funciones auxiliares
// ─────────────────────────────────────────────────

// Caracteres seguros para código de sala (sin 0/O, 1/I/L)
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Obtener estado sanitizado de la sala (sin palabras ocultas)
function getSanitizedRoomState(room) {
  return {
    code: room.code,
    admin: room.admin,
    settings: { ...room.settings },
    status: room.status,
    teams: {
      red: room.teams.red.map(p => ({
        id: p.id,
        nickname: p.nickname,
        wordsSubmitted: p.wordsSubmitted,
        connected: p.connected
      })),
      blue: room.teams.blue.map(p => ({
        id: p.id,
        nickname: p.nickname,
        wordsSubmitted: p.wordsSubmitted,
        connected: p.connected
      }))
    },
    game: room.game ? {
      currentPhase: room.game.currentPhase,
      wordsRemaining: room.game.wordPool.length,
      currentDescriberTeam: room.game.currentDescriberTeam,
      currentDescriberNickname: getCurrentDescriberNickname(room),
      timeRemaining: Math.ceil(room.game.timeRemaining),
      timerRunning: room.game.timerRunning,
      scores: { ...room.game.scores },
      phaseScores: JSON.parse(JSON.stringify(room.game.phaseScores)),
      turnOrder: JSON.parse(JSON.stringify(room.game.turnOrder)),
      currentDescriberIndex: { ...room.game.currentDescriberIndex },
      describerReady: room.game.describerReady,
      phaseCountdown: room.game.phaseCountdown || 0,
      totalWords: room.game.allWords.length
    } : null
  };
}

// Enviar estado a todos los jugadores de la sala
function broadcastRoomState(room) {
  const state = getSanitizedRoomState(room);
  io.to(room.code).emit('room-state', state);
}

// Obtener el jugador anlatıcı (descriptor) actual
function getCurrentDescriber(room) {
  if (!room.game) return null;
  const team = room.game.currentDescriberTeam;
  const index = room.game.currentDescriberIndex[team];
  const nickname = room.game.turnOrder[team][index];
  // Buscar jugador por nickname en la lista del equipo
  return findPlayerByNickname(room, nickname);
}

function getCurrentDescriberNickname(room) {
  if (!room.game) return null;
  const team = room.game.currentDescriberTeam;
  const index = room.game.currentDescriberIndex[team];
  return room.game.turnOrder[team][index] || null;
}

// Buscar jugador por nickname en cualquier equipo
function findPlayerByNickname(room, nickname) {
  const redPlayer = room.teams.red.find(p => p.nickname === nickname);
  if (redPlayer) return redPlayer;
  return room.teams.blue.find(p => p.nickname === nickname);
}

// Buscar jugador por socket ID
function findPlayerById(room, socketId) {
  const redPlayer = room.teams.red.find(p => p.id === socketId);
  if (redPlayer) return { player: redPlayer, team: 'red' };
  const bluePlayer = room.teams.blue.find(p => p.id === socketId);
  if (bluePlayer) return { player: bluePlayer, team: 'blue' };
  return null;
}

// Obtener equipo del siguiente descriptor
function getOtherTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

// Avanzar al siguiente descriptor del equipo
function advanceDescriberIndex(room, team) {
  const order = room.game.turnOrder[team];
  // Filtrar los jugadores desconectados de la lista de turnos
  const activePlayers = order.filter(nickname => {
    const player = findPlayerByNickname(room, nickname);
    return player && player.connected;
  });

  if (activePlayers.length === 0) return;

  let currentIndex = room.game.currentDescriberIndex[team];
  // Avanzar al siguiente índice circular
  currentIndex = (currentIndex + 1) % order.length;

  // Saltar jugadores desconectados
  let attempts = 0;
  while (attempts < order.length) {
    const nickname = order[currentIndex];
    const player = findPlayerByNickname(room, nickname);
    if (player && player.connected) break;
    currentIndex = (currentIndex + 1) % order.length;
    attempts++;
  }

  room.game.currentDescriberIndex[team] = currentIndex;
}

// Seleccionar siguiente palabra del pool
function pickNextWord(room, excludeWord) {
  if (room.game.wordPool.length === 0) return null;

  // Si solo queda 1 palabra, no hay opción
  if (room.game.wordPool.length === 1) {
    return room.game.wordPool[0];
  }

  // Barajar y asegurar que la palabra excluida no esté primera
  if (excludeWord) {
    let shuffled = shuffleArray(room.game.wordPool);
    // Si la excluida está en la primera posición, moverla
    if (shuffled[0] === excludeWord) {
      const swapIndex = 1 + Math.floor(Math.random() * (shuffled.length - 1));
      [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
    }
    room.game.wordPool = shuffled;
  }

  return room.game.wordPool[0];
}

// ─────────────────────────────────────────────────
// Gestión del temporizador del servidor
// ─────────────────────────────────────────────────

function startTimer(room) {
  if (room.game.timerInterval) {
    clearInterval(room.game.timerInterval);
  }

  room.game.timerRunning = true;
  room.game.lastTickTime = Date.now();

  room.game.timerInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - room.game.lastTickTime) / 1000;
    room.game.lastTickTime = now;
    room.game.timeRemaining -= elapsed;

    // Emitir actualización de tiempo a todos
    const timeRemaining = Math.max(0, room.game.timeRemaining);
    io.to(room.code).emit('timer-update', {
      timeRemaining: Math.ceil(timeRemaining)
    });

    // Sonido de último 10 segundos
    if (timeRemaining <= 10 && timeRemaining > 0 && Math.ceil(timeRemaining) !== Math.ceil(timeRemaining + elapsed)) {
      io.to(room.code).emit('play-sound', { soundType: 'tick' });
    }

    // Tiempo agotado
    if (timeRemaining <= 0) {
      room.game.timeRemaining = 0;
      stopTimer(room);
      handleTurnEnd(room);
    }
  }, 100); // 100ms de precisión
}

function stopTimer(room) {
  room.game.timerRunning = false;
  if (room.game.timerInterval) {
    clearInterval(room.game.timerInterval);
    room.game.timerInterval = null;
  }
}

// ─────────────────────────────────────────────────
// Lógica de final de turno
// ─────────────────────────────────────────────────

function handleTurnEnd(room) {
  // Sonido de buzzer
  io.to(room.code).emit('play-sound', { soundType: 'buzzer' });

  // Deslizar la palabra no adivinada de vuelta al pool
  const unansweredWord = room.game.currentWord;
  room.game.currentWord = null;

  // Cambiar al siguiente equipo y descriptor
  const nextTeam = getOtherTeam(room.game.currentDescriberTeam);
  advanceDescriberIndex(room, nextTeam);
  room.game.currentDescriberTeam = nextTeam;

  // Barajar el pool asegurando que la palabra no adivinada no sea primera
  if (unansweredWord && room.game.wordPool.length > 1) {
    room.game.wordPool = shuffleArray(room.game.wordPool);
    if (room.game.wordPool[0] === unansweredWord) {
      const swapIndex = 1 + Math.floor(Math.random() * (room.game.wordPool.length - 1));
      [room.game.wordPool[0], room.game.wordPool[swapIndex]] = [room.game.wordPool[swapIndex], room.game.wordPool[0]];
    }
  }

  // Reiniciar el tiempo completo para el nuevo turno
  room.game.timeRemaining = room.settings.turnDuration;
  room.game.describerReady = false;

  // Notificar al siguiente descriptor
  const describer = getCurrentDescriber(room);
  if (describer) {
    io.to(describer.id).emit('your-turn', {
      phase: room.game.currentPhase,
      phaseRule: getPhaseRule(room.game.currentPhase)
    });
  }

  io.to(room.code).emit('turn-end', {
    nextDescriber: getCurrentDescriberNickname(room),
    nextTeam: room.game.currentDescriberTeam
  });

  broadcastRoomState(room);
}

// ─────────────────────────────────────────────────
// Lógica de final de fase
// ─────────────────────────────────────────────────

function handlePhaseEnd(room) {
  stopTimer(room);

  const savedTime = room.game.timeRemaining;
  room.game.savedTimeRemaining = savedTime;

  // Si estamos en la fase 4, el juego termina
  if (room.game.currentPhase >= 4) {
    handleGameOver(room);
    return;
  }

  room.status = 'phase-transition';
  room.game.currentWord = null;

  io.to(room.code).emit('phase-end', {
    phaseNumber: room.game.currentPhase,
    scores: { ...room.game.scores },
    phaseScores: room.game.phaseScores[room.game.currentPhase],
    nextPhase: room.game.currentPhase + 1,
    nextPhaseRule: getPhaseRule(room.game.currentPhase + 1),
    timeRemaining: savedTime
  });

  io.to(room.code).emit('play-sound', { soundType: 'jingle' });

  broadcastRoomState(room);
}

// ─────────────────────────────────────────────────
// Lógica de final del juego
// ─────────────────────────────────────────────────

function handleGameOver(room) {
  stopTimer(room);
  room.status = 'game-over';
  room.game.currentWord = null;

  let winner;
  if (room.game.scores.red > room.game.scores.blue) {
    winner = 'red';
  } else if (room.game.scores.blue > room.game.scores.red) {
    winner = 'blue';
  } else {
    winner = 'draw';
  }

  io.to(room.code).emit('game-over', {
    finalScores: { ...room.game.scores },
    phaseScores: JSON.parse(JSON.stringify(room.game.phaseScores)),
    winner
  });

  io.to(room.code).emit('play-sound', { soundType: 'celebration' });

  broadcastRoomState(room);
}

// Reglas de cada fase en Türkçe
function getPhaseRule(phase) {
  const rules = {
    1: { name: 'Kelime Anlat', icon: '🗣️', rule: 'Kelimeyi ve içindeki sözcükleri kullanmadan serbest cümlelerle anlat!' },
    2: { name: 'Tek Kelime', icon: '☝️', rule: 'Sadece TEK bir kelime söyleyerek anlat!' },
    3: { name: 'Sessiz Sinema', icon: '🤫', rule: 'Hiç konuşmadan, sadece jest ve mimiklerle anlat!' },
    4: { name: 'Ses ile Anlat', icon: '🔊', rule: 'Kelime kullanmadan, sadece sesler çıkararak anlat!' }
  };
  return rules[phase] || rules[1];
}

// Verificar si todos los jugadores enviaron palabras
function allWordsSubmitted(room) {
  const allPlayers = [...room.teams.red, ...room.teams.blue];
  return allPlayers.length > 0 && allPlayers.every(p => p.wordsSubmitted);
}

// Verificar requisitos mínimos para iniciar
function canStartGame(room) {
  const hasMinPlayers = room.teams.red.length >= 2 && room.teams.blue.length >= 2;
  const allSubmitted = allWordsSubmitted(room);
  return hasMinPlayers && allSubmitted;
}

// ─────────────────────────────────────────────────
// Manejo de desconexiones
// ─────────────────────────────────────────────────

function handleDisconnect(room, socketId) {
  const result = findPlayerById(room, socketId);
  if (!result) return;

  const { player, team } = result;
  player.connected = false;

  // Temporizador de reconexión: 15 segundos
  player.disconnectTimer = setTimeout(() => {
    removePlayer(room, socketId);
  }, 15000);

  io.to(room.code).emit('player-disconnected', { nickname: player.nickname });

  // Si el jugador era el descriptor activo en medio de un turno
  if (room.status === 'playing' && room.game) {
    const describer = getCurrentDescriber(room);
    if (describer && describer.id === socketId) {
      stopTimer(room);
      // Devolver la palabra al pool
      if (room.game.currentWord) {
        // La palabra ya está en el pool (nunca la eliminamos del pool,
        // solo la marcamos como currentWord)
        room.game.currentWord = null;
      }

      // Cambiar al otro equipo
      const nextTeam = getOtherTeam(room.game.currentDescriberTeam);
      advanceDescriberIndex(room, nextTeam);
      room.game.currentDescriberTeam = nextTeam;
      room.game.timeRemaining = room.settings.turnDuration;
      room.game.describerReady = false;

      // Verificar si queda suficiente jugadores
      const activeRed = room.teams.red.filter(p => p.connected).length;
      const activeBlue = room.teams.blue.filter(p => p.connected).length;

      if (activeRed < 1 || activeBlue < 1) {
        // Pausar juego
        stopTimer(room);
        room.status = 'paused';
        broadcastRoomState(room);
        return;
      }

      // Notificar al nuevo descriptor
      const newDescriber = getCurrentDescriber(room);
      if (newDescriber) {
        io.to(newDescriber.id).emit('your-turn', {
          phase: room.game.currentPhase,
          phaseRule: getPhaseRule(room.game.currentPhase)
        });
      }
    }

    // Verificar si algún equipo se quedó con <2 jugadores
    const activeRed = room.teams.red.filter(p => p.connected).length;
    const activeBlue = room.teams.blue.filter(p => p.connected).length;
    if (activeRed < 2 || activeBlue < 2) {
      stopTimer(room);
      room.status = 'paused';
    }
  }

  broadcastRoomState(room);
}

function removePlayer(room, socketId) {
  const result = findPlayerById(room, socketId);
  if (!result) return;

  const { player, team } = result;

  // Eliminar de la lista del equipo
  room.teams[team] = room.teams[team].filter(p => p.id !== socketId);

  // Actualizar turn order si hay juego activo
  if (room.game) {
    room.game.turnOrder[team] = room.game.turnOrder[team].filter(n => n !== player.nickname);
    // Ajustar el índice si es necesario
    if (room.game.currentDescriberIndex[team] >= room.game.turnOrder[team].length) {
      room.game.currentDescriberIndex[team] = 0;
    }
  }

  // Si era admin, transferir
  if (room.admin === socketId) {
    transferAdmin(room);
  }

  // Limpiar mapa de socket
  socketRoomMap.delete(socketId);

  // Si la sala quedó vacía, eliminarla
  const totalPlayers = room.teams.red.length + room.teams.blue.length;
  if (totalPlayers === 0) {
    if (room.game && room.game.timerInterval) {
      clearInterval(room.game.timerInterval);
    }
    rooms.delete(room.code);
    return;
  }

  broadcastRoomState(room);
}

function transferAdmin(room) {
  // Buscar el jugador conectado más antiguo
  const allPlayers = [...room.teams.red, ...room.teams.blue].filter(p => p.connected);
  if (allPlayers.length === 0) return;

  const newAdmin = allPlayers[0];
  room.admin = newAdmin.id;

  io.to(newAdmin.id).emit('new-admin', { nickname: newAdmin.nickname });
  broadcastRoomState(room);
}

// ─────────────────────────────────────────────────
// Socket.IO: manejo de conexiones
// ─────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Rastrear última vez que se pulsó "correcto" para rate limiting
  let lastCorrectTime = 0;

  // ─── Crear Sala ───
  socket.on('create-room', ({ nickname }, callback) => {
    if (!nickname || nickname.trim().length < 2 || nickname.trim().length > 20) {
      socket.emit('error', { message: 'Takma ad 2-20 karakter olmalıdır.' });
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      admin: socket.id,
      settings: {
        wordsPerPlayer: 5,
        turnDuration: 60
      },
      status: 'lobby',
      teams: {
        red: [{
          id: socket.id,
          nickname: nickname.trim(),
          wordsSubmitted: false,
          words: [],
          connected: true,
          disconnectTimer: null
        }],
        blue: []
      },
      game: null
    };

    rooms.set(code, room);
    socketRoomMap.set(socket.id, code);
    socket.join(code);

    socket.emit('room-created', { roomCode: code });
    broadcastRoomState(room);
  });

  // ─── Katılma ───
  socket.on('join-room', ({ roomCode, nickname, team }, callback) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', { message: 'Oda bulunamadı.' });
      return;
    }

    if (room.status !== 'lobby') {
      // Comprobar si es reconexión
      const existingPlayer = [...room.teams.red, ...room.teams.blue]
        .find(p => p.nickname === nickname.trim() && !p.connected);

      if (existingPlayer) {
        // Reconexión exitosa
        clearTimeout(existingPlayer.disconnectTimer);
        existingPlayer.id = socket.id;
        existingPlayer.connected = true;
        existingPlayer.disconnectTimer = null;
        socketRoomMap.set(socket.id, code);
        socket.join(code);
        broadcastRoomState(room);

        // Si es el descriptor actual y el juego está en progreso
        if (room.game && room.status === 'playing') {
          const describer = getCurrentDescriber(room);
          if (describer && describer.id === socket.id) {
            socket.emit('your-turn', {
              phase: room.game.currentPhase,
              phaseRule: getPhaseRule(room.game.currentPhase)
            });
            if (room.game.currentWord) {
              socket.emit('new-word', { word: room.game.currentWord });
            }
          }
        }
        return;
      }

      socket.emit('error', { message: 'Oyun zaten başladı.' });
      return;
    }

    if (!nickname || nickname.trim().length < 2 || nickname.trim().length > 20) {
      socket.emit('error', { message: 'Takma ad 2-20 karakter olmalıdır.' });
      return;
    }

    if (!team || (team !== 'red' && team !== 'blue')) {
      socket.emit('error', { message: 'Geçersiz takım.' });
      return;
    }

    // Comprobar duplicado de nombre
    const allPlayers = [...room.teams.red, ...room.teams.blue];
    if (allPlayers.some(p => p.nickname.toLowerCase() === nickname.trim().toLowerCase())) {
      socket.emit('error', { message: 'Bu takma ad zaten kullanılıyor.' });
      return;
    }

    room.teams[team].push({
      id: socket.id,
      nickname: nickname.trim(),
      wordsSubmitted: false,
      words: [],
      connected: true,
      disconnectTimer: null
    });

    socketRoomMap.set(socket.id, code);
    socket.join(code);
    broadcastRoomState(room);
  });

  // ─── Takım değiştirme ───
  socket.on('switch-team', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.status !== 'lobby') return;

    const result = findPlayerById(room, socket.id);
    if (!result) return;

    const { player, team } = result;
    const newTeam = getOtherTeam(team);

    // Mover jugador al otro equipo
    room.teams[team] = room.teams[team].filter(p => p.id !== socket.id);
    room.teams[newTeam].push(player);

    broadcastRoomState(room);
  });

  // ─── Enviar palabras ───
  socket.on('submit-words', ({ words }) => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const result = findPlayerById(room, socket.id);
    if (!result) return;

    const { player } = result;

    if (player.wordsSubmitted) {
      socket.emit('error', { message: 'Kelimelerin zaten gönderildi.' });
      return;
    }

    // Validación
    if (!Array.isArray(words) || words.length !== room.settings.wordsPerPlayer) {
      socket.emit('error', { message: `Tam olarak ${room.settings.wordsPerPlayer} kelime yazmalısın.` });
      return;
    }

    const validatedWords = [];
    for (const word of words) {
      const trimmed = (word || '').trim();
      if (trimmed.length < 1 || trimmed.length > 40) {
        socket.emit('error', { message: 'Her kelime 1-40 karakter arası olmalıdır.' });
        return;
      }
      validatedWords.push(trimmed);
    }

    player.words = validatedWords;
    player.wordsSubmitted = true;

    broadcastRoomState(room);
  });

  // ─── Actualizar ajustes (solo admin) ───
  socket.on('update-settings', ({ wordsPerPlayer, turnDuration }) => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.admin !== socket.id || room.status !== 'lobby') return;

    if (wordsPerPlayer !== undefined) {
      const wpn = parseInt(wordsPerPlayer, 10);
      if (wpn >= 5 && wpn <= 10) {
        room.settings.wordsPerPlayer = wpn;
        // Reiniciar estado de envío de palabras si cambió
        [...room.teams.red, ...room.teams.blue].forEach(p => {
          p.wordsSubmitted = false;
          p.words = [];
        });
      }
    }

    if (turnDuration !== undefined) {
      const td = parseInt(turnDuration, 10);
      if (td >= 30 && td <= 120) {
        room.settings.turnDuration = td;
      }
    }

    broadcastRoomState(room);
  });

  // ─── Iniciar juego (solo admin) ───
  socket.on('start-game', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.admin !== socket.id) return;

    if (!canStartGame(room)) {
      socket.emit('error', { message: 'Oyun başlatılamıyor. Tüm oyuncular kelimelerini göndermiş ve her takımda en az 2 kişi olmalıdır.' });
      return;
    }

    // Recoger todas las palabras en el pool
    const allWords = [];
    [...room.teams.red, ...room.teams.blue].forEach(p => {
      allWords.push(...p.words);
    });

    // Moneda al aire para decidir equipo inicial
    const startingTeam = Math.random() < 0.5 ? 'red' : 'blue';

    room.status = 'playing';
    room.game = {
      currentPhase: 1,
      wordPool: shuffleArray([...allWords]),
      allWords: [...allWords],
      currentDescriberTeam: startingTeam,
      currentDescriberIndex: { red: 0, blue: 0 },
      currentWord: null,
      timeRemaining: room.settings.turnDuration,
      timerRunning: false,
      timerInterval: null,
      lastTickTime: null,
      scores: { red: 0, blue: 0 },
      phaseScores: {
        1: { red: 0, blue: 0 },
        2: { red: 0, blue: 0 },
        3: { red: 0, blue: 0 },
        4: { red: 0, blue: 0 }
      },
      turnOrder: {
        red: room.teams.red.map(p => p.nickname),
        blue: room.teams.blue.map(p => p.nickname)
      },
      describerReady: false,
      savedTimeRemaining: 0,
      phaseCountdown: 0
    };

    io.to(room.code).emit('game-started', {
      startingTeam,
      phase: 1,
      phaseRule: getPhaseRule(1)
    });

    // Notificar al primer descriptor
    const describer = getCurrentDescriber(room);
    if (describer) {
      io.to(describer.id).emit('your-turn', {
        phase: 1,
        phaseRule: getPhaseRule(1)
      });
    }

    broadcastRoomState(room);
  });

  // ─── Descriptor listo ───
  socket.on('describer-ready', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing' || !room.game) return;

    const describer = getCurrentDescriber(room);
    if (!describer || describer.id !== socket.id) return;
    if (room.game.timerRunning) return; // Ya está corriendo

    room.game.describerReady = true;

    // Seleccionar primera palabra
    const word = pickNextWord(room, null);
    if (!word) return;

    room.game.currentWord = word;

    // Enviar palabra solo al descriptor
    socket.emit('new-word', { word });

    // Iniciar temporizador
    startTimer(room);

    broadcastRoomState(room);
  });

  // ─── Palabra correcta ───
  socket.on('word-correct', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing' || !room.game) return;
    if (!room.game.timerRunning) return; // El temporizador ya expiró

    const describer = getCurrentDescriber(room);
    if (!describer || describer.id !== socket.id) return;

    // Rate limiting: máximo 2 por segundo
    const now = Date.now();
    if (now - lastCorrectTime < 500) return;
    lastCorrectTime = now;

    // Otorgar punto
    const team = room.game.currentDescriberTeam;
    room.game.scores[team]++;
    room.game.phaseScores[room.game.currentPhase][team]++;

    // Eliminar solo UNA instancia de la palabra del pool (soporta duplicados)
    const guessedWord = room.game.currentWord;
    const wordIndex = room.game.wordPool.indexOf(guessedWord);
    if (wordIndex !== -1) {
      room.game.wordPool.splice(wordIndex, 1);
    }

    io.to(room.code).emit('word-guessed', {
      newScore: { ...room.game.scores },
      wordsRemaining: room.game.wordPool.length
    });

    io.to(room.code).emit('play-sound', { soundType: 'ding' });

    // ¿Pool vacío? → fin de fase
    if (room.game.wordPool.length === 0) {
      room.game.currentWord = null;
      handlePhaseEnd(room);
      return;
    }

    // Siguiente palabra
    const nextWord = pickNextWord(room, null);
    room.game.currentWord = nextWord;
    socket.emit('new-word', { word: nextWord });

    broadcastRoomState(room);
  });

  // ─── Siguiente fase (solo admin) ───
  socket.on('next-phase', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.admin !== socket.id || room.status !== 'phase-transition') return;

    const nextPhase = room.game.currentPhase + 1;
    if (nextPhase > 4) return;

    room.game.currentPhase = nextPhase;
    room.game.wordPool = shuffleArray([...room.game.allWords]);
    room.status = 'playing';

    // Determinar si el descriptor continúa con tiempo restante o el siguiente empieza
    const savedTime = room.game.savedTimeRemaining || 0;

    if (savedTime > 0) {
      // El mismo descriptor continúa con el tiempo restante
      room.game.timeRemaining = savedTime;
      room.game.savedTimeRemaining = 0;

      // Geri sayım 3-2-1 antes de continuar
      room.game.phaseCountdown = 3;
      broadcastRoomState(room);

      let count = 3;
      const countdownInterval = setInterval(() => {
        count--;
        room.game.phaseCountdown = count;

        if (count <= 0) {
          clearInterval(countdownInterval);
          room.game.phaseCountdown = 0;

          // Seleccionar palabra y empezar
          const word = pickNextWord(room, null);
          room.game.currentWord = word;
          room.game.describerReady = true;

          const describer = getCurrentDescriber(room);
          if (describer) {
            io.to(describer.id).emit('new-word', { word });
          }

          startTimer(room);
          broadcastRoomState(room);
        } else {
          broadcastRoomState(room);
        }
      }, 1000);
    } else {
      // Tiempo se agotó → siguiente descriptor con tiempo completo
      const nextTeam = getOtherTeam(room.game.currentDescriberTeam);
      advanceDescriberIndex(room, nextTeam);
      room.game.currentDescriberTeam = nextTeam;
      room.game.timeRemaining = room.settings.turnDuration;
      room.game.describerReady = false;

      const describer = getCurrentDescriber(room);
      if (describer) {
        io.to(describer.id).emit('your-turn', {
          phase: nextPhase,
          phaseRule: getPhaseRule(nextPhase)
        });
      }

      broadcastRoomState(room);
    }
  });

  // ─── Expulsar jugador (solo admin) ───
  socket.on('kick-player', ({ targetNickname }) => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.admin !== socket.id) return;

    const target = findPlayerByNickname(room, targetNickname);
    if (!target || target.id === socket.id) return; // No auto-expulsión

    // Notificar al jugador expulsado
    io.to(target.id).emit('error', { message: 'Odadan çıkarıldın.' });

    // Desconectar de la sala
    const targetSocket = io.sockets.sockets.get(target.id);
    if (targetSocket) {
      targetSocket.leave(code);
    }

    removePlayer(room, target.id);
  });

  // ─── Volver al lobby (admin reinicia juego) ───
  socket.on('return-to-lobby', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.admin !== socket.id) return;

    stopTimer(room);
    room.status = 'lobby';
    room.game = null;

    // Reiniciar estado de palabras
    [...room.teams.red, ...room.teams.blue].forEach(p => {
      p.wordsSubmitted = false;
      p.words = [];
    });

    broadcastRoomState(room);
  });

  // ─── Desconexión ───
  socket.on('disconnect', () => {
    const code = socketRoomMap.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    handleDisconnect(room, socket.id);
  });
});

// ─────────────────────────────────────────────────
// Iniciar servidor
// ─────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Kelime Havuzu sunucusu çalışıyor: http://localhost:${PORT}`);
});
