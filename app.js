/* ==========================================================================
   1. REAL-TIME SOCKET & MATCHMAKING SYSTEM INTEGRATION
   ========================================================================== */
let socket = null;
let matchmakingTimer = null;
let matchmakingCountdown = 10;

function getPlayerToken() {
  let token = localStorage.getItem('NYASATECH1_PLAYER_TOKEN');
  if (!token) {
    token = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('NYASATECH1_PLAYER_TOKEN', token);
  }
  GAME_STATE.playerToken = token;
  return token;
}

try {
  socket = io(); // Connects to backend host (see server/server.js)
  getPlayerToken();

  socket.on('connect', () => {
    // Reconnect flow: if a match was active when we dropped, ask the
    // server to re-seat us in the same room with the same token.
    if (GAME_STATE.matchActive && GAME_STATE.roomId) {
      socket.emit('rejoin_room', { roomId: GAME_STATE.roomId, playerToken: GAME_STATE.playerToken });
    }
  });

  socket.on('match_found', (data) => {
    stopMatchmakingTimer();
    startGame({
      mode: 'online',
      opponent: data.opponentName,
      roomId: data.roomId,
      assignedColor: data.assignedColor || 'black'
    });
  });

  // ---- Private room system ----
  socket.on('room_created', (data) => {
    showRoomInviteModal(data.roomCode, data.inviteLink);
  });

  socket.on('room_join_error', (data) => {
    alert(data && data.message ? data.message : 'Could not join that room.');
  });

  socket.on('room_ready', (data) => {
    // Both players present — match starts automatically.
    closeModal();
    startGame({
      mode: 'online',
      opponent: data.opponentName,
      roomId: data.roomId,
      assignedColor: data.assignedColor || 'black'
    });
  });

  socket.on('opponent_moved', (data) => {
    if (data.gameType === GAME_STATE.type && GAME_STATE.mode === 'online') {
      executeMove(data.move);
    }
  });

  // ---- Disconnect / reconnect handling ----
  socket.on('opponent_reconnecting', () => {
    document.getElementById('aiThinkingBanner').innerText = 'Opponent disconnected \u2014 waiting for them to reconnect\u2026';
    document.getElementById('aiThinkingBanner').style.display = 'block';
  });

  socket.on('opponent_back', () => {
    document.getElementById('aiThinkingBanner').style.display = 'none';
  });

  socket.on('opponent_forfeited', () => {
    alert("Your opponent didn't reconnect in time. Victory awarded by forfeit.");
    finishMatch(GAME_STATE.myColor === 'white' ? 'White' : 'Black');
  });

  socket.on('state_sync', (data) => {
    // Authoritative resync after a reconnect.
    GAME_STATE.board = data.board;
    GAME_STATE.turn = data.turn;
    if (GAME_STATE.type === 'chess' && GAME_STATE.chessInstance && data.fen) {
      GAME_STATE.chessInstance.load(data.fen);
    }
    renderBoard();
  });
} catch (e) {
  console.log("Socket connection deferred (offline mode active)");
}

/* ---- Private room UI helpers ---- */
function createPrivateRoom() {
  if (!socket || !socket.connected) { alert('Not connected to the multiplayer server yet. Try again in a moment.'); return; }
  socket.emit('create_room', { gameType: GAME_STATE.type, playerToken: getPlayerToken(), playerName: userProgress.displayName || 'Player' });
}

function joinPrivateRoom(codeFromInput) {
  const code = (codeFromInput || document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) { alert('Enter a room code first.'); return; }
  if (!socket || !socket.connected) { alert('Not connected to the multiplayer server yet. Try again in a moment.'); return; }
  socket.emit('join_room', { roomCode: code, gameType: GAME_STATE.type, playerToken: getPlayerToken(), playerName: userProgress.displayName || 'Player' });
}

function showRoomInviteModal(roomCode, inviteLink) {
  document.getElementById('modalTitle').innerText = 'Room Created';
  document.getElementById('modalBody').innerHTML =
    'Share this code or link with a friend. The match starts automatically once they join.<br><br>' +
    '<div style="font-family:var(--font-heading); font-size:1.6rem; letter-spacing:0.2em; text-align:center; margin:0.5rem 0;">' + roomCode + '</div>' +
    '<input readonly value="' + inviteLink + '" onclick="this.select()" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid var(--border-color); background:#020617; color:#e2e8f0; font-size:0.75rem;" />';
  document.getElementById('modalOverlay').classList.add('active');
}

function checkRoomCodeInUrl() {
  const match = window.location.pathname.match(/\/room\/([A-Za-z0-9]{4,8})/);
  if (match) {
    const code = match[1].toUpperCase();
    setTimeout(() => {
      if (confirm('Join room ' + code + '?')) {
        selectModeView(GAME_STATE.type || 'checkers');
        joinPrivateRoom(code);
      }
    }, 1200);
  }
}

/* ==========================================================================
   2. PLAYER DATA & LOCAL STORAGE PERSISTENCE (LOCALSTORAGE / INDEXEDDB)
   ========================================================================== */
const POLICY_VERSION = "1.0.0";

const DEFAULT_PROFILE = {
  policyAccepted: false,
  policyVersion: "",
  profileCreated: false,
  welcomeBonusClaimed: false,
  displayName: "",
  email: "",
  avatar: "",
  xp: 0,
  level: 1,
  wins: 0,
  losses: 0,
  completedMatches: 0,
  theme: "classic",
  aiDifficulty: "Hard",
  aiPersonality: "Random Human",
  coins: 0,
  achievements: [],
  preferences: {}
};

let userProgress = {};
let currentView = 'homeView';
let previousViewStack = [];

function initStorage() {
  try {
    const raw = localStorage.getItem("NYASATECH1_USER_DATA");
    if (raw) {
      userProgress = JSON.parse(raw);
    } else {
      userProgress = { ...DEFAULT_PROFILE };
    }
  } catch (err) {
    console.warn("Storage warning. Resetting user profile safely.");
    userProgress = { ...DEFAULT_PROFILE };
    saveProgress();
  }
  applyLoadedUserData();
}

function saveProgress() {
  try {
    localStorage.setItem("NYASATECH1_USER_DATA", JSON.stringify(userProgress));
  } catch (e) {
    console.error("Storage write exception", e);
  }
}

function calculateLevel(xp) {
  return Math.floor(xp / 100) + 1;
}

function addXP(amount, reason = "") {
  userProgress.xp = (userProgress.xp || 0) + amount;
  userProgress.level = calculateLevel(userProgress.xp);
  saveProgress();
  applyLoadedUserData();
}

function applyLoadedUserData() {
  document.getElementById('navXpDisplay').innerText = `${userProgress.xp || 0} XP`;
  document.getElementById('profXp').innerText = `${userProgress.xp || 0} XP`;
  document.getElementById('profLevel').innerText = `Lvl ${calculateLevel(userProgress.xp || 0)}`;
  document.getElementById('profMatches').innerText = userProgress.completedMatches || 0;
  document.getElementById('profRecord').innerText = `${userProgress.wins || 0}W - ${userProgress.losses || 0}L`;
  document.getElementById('profileNameInput').value = userProgress.displayName || "";
  document.getElementById('profileEmailInput').value = userProgress.email || "";
  document.getElementById('themeSelector').value = userProgress.theme || "classic";
  document.getElementById('aiHardnessSelector').value = userProgress.aiDifficulty || "Hard";
  document.getElementById('aiPersonalitySelector').value = userProgress.aiPersonality || "Random Human";
  updateTheme(userProgress.theme || "classic", false);
}

function saveProfileData() {
  userProgress.displayName = document.getElementById('profileNameInput').value;
  userProgress.email = document.getElementById('profileEmailInput').value;
  saveProgress();
}

function updateTheme(themeName, save = true) {
  document.body.className = `theme-${themeName}`;
  if (save) {
    userProgress.theme = themeName;
    saveProgress();
  }
}

function updateAiLevel(level) {
  userProgress.aiDifficulty = level;
  saveProgress();
}

function updateAiPersonality(personality) {
  userProgress.aiPersonality = personality;
  saveProgress();
}

/* ==========================================================================
   3. ONBOARDING & FIRST LOGIN BONUS
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  initStorage();
  getPlayerToken();

  // STEP 1: 5-Second Splash Screen
  setTimeout(() => {
    const splash = document.getElementById('splashScreen');
    splash.classList.add('fade-out');
    
    setTimeout(() => {
      splash.style.display = 'none';
      checkOnboardingFlow();
      checkRoomCodeInUrl();
    }, 800);
  }, 5000);
});

function checkOnboardingFlow() {
  // STEP 2: Privacy Gate
  if (!userProgress.policyAccepted || userProgress.policyVersion !== POLICY_VERSION) {
    document.getElementById('privacyScreen').classList.add('active');
  } else {
    checkProfileCreationGate();
  }
}

function acceptTerms() {
  userProgress.policyAccepted = true;
  userProgress.policyVersion = POLICY_VERSION;
  saveProgress();
  document.getElementById('privacyScreen').classList.remove('active');
  checkProfileCreationGate();
}

function declineTerms() {
  alert("You must accept the terms and privacy policy to continue.");
}

function checkProfileCreationGate() {
  // STEP 3: Profile Creation Setup
  if (!userProgress.profileCreated) {
    document.getElementById('profileSetupScreen').classList.add('active');
  }
}

function completeProfileSetup() {
  const name = document.getElementById('setupDisplayName').value.trim();
  if (!name) {
    alert("Display Name is required!");
    return;
  }

  userProgress.displayName = name;
  userProgress.email = document.getElementById('setupEmail').value.trim();
  userProgress.avatar = document.getElementById('setupAvatar').value.trim();
  userProgress.profileCreated = true;

  document.getElementById('profileSetupScreen').classList.remove('active');

  // Claim 50 XP Welcome Bonus (Claimable once)
  if (!userProgress.welcomeBonusClaimed) {
    userProgress.welcomeBonusClaimed = true;
    addXP(50, "First Login Bonus");
    document.getElementById('celebrationModal').classList.add('active');
  } else {
    saveProgress();
    applyLoadedUserData();
  }
}

function closeCelebrationModal() {
  document.getElementById('celebrationModal').classList.remove('active');
}

/* ==========================================================================
   4. NAVIGATION & MATCH LOCK CONTROLS
   ========================================================================== */
const menuToggleBtn = document.getElementById('menuToggleBtn');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const drawerOverlay = document.getElementById('drawerOverlay');
const drawer = document.getElementById('drawer');

function toggleDrawer(open) {
  if (GAME_STATE.matchActive && open) {
    alert("Match in progress! Settings and navigation are locked until the game ends or you resign.");
    return;
  }
  drawerOverlay.classList.toggle('active', open);
  drawer.classList.toggle('active', open);
}

menuToggleBtn.addEventListener('click', () => toggleDrawer(true));
drawerCloseBtn.addEventListener('click', () => toggleDrawer(false));
drawerOverlay.addEventListener('click', () => toggleDrawer(false));

function switchView(targetViewId) {
  if (GAME_STATE.matchActive) {
    alert("Match in progress! Settings and navigation are locked until the game ends or you resign.");
    return;
  }

  toggleDrawer(false);
  if (currentView !== targetViewId) {
    previousViewStack.push(currentView);
    currentView = targetViewId;
  }

  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(targetViewId).classList.add('active');

  updateNavigationButtons();
}

function goBackView() {
  if (GAME_STATE.matchActive) {
    alert("Match in progress! Settings and navigation are locked until the game ends or you resign.");
    return;
  }

  if (previousViewStack.length > 0) {
    currentView = previousViewStack.pop();
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(currentView).classList.add('active');
  } else {
    switchView('homeView');
  }

  updateNavigationButtons();
}

function updateNavigationButtons() {
  const globalBackBtn = document.getElementById('globalBackBtn');
  const isMatchLocked = GAME_STATE.matchActive;

  if (previousViewStack.length > 0 && currentView !== 'homeView' && !isMatchLocked) {
    globalBackBtn.style.display = 'inline-flex';
  } else {
    globalBackBtn.style.display = 'none';
  }

  // Lock interactions during matches
  document.getElementById('brandLogoLink').style.pointerEvents = isMatchLocked ? 'none' : 'auto';
  document.getElementById('navCoinsBtn').style.pointerEvents = isMatchLocked ? 'none' : 'auto';
  document.getElementById('menuToggleBtn').style.opacity = isMatchLocked ? '0.5' : '1';
  
  // Lock Settings inputs during active matches
  const matchSettingsPanel = id => document.getElementById(id);
  if (matchSettingsPanel('matchSettingsPanel')) {
    matchSettingsPanel('aiHardnessSelector').disabled = isMatchLocked;
    matchSettingsPanel('aiPersonalitySelector').disabled = isMatchLocked;
    matchSettingsPanel('themeSelector').disabled = isMatchLocked;
    matchSettingsPanel('startAiMatchBtn').disabled = isMatchLocked;
  }
}

function selectModeView(gameType) {
  GAME_STATE.type = gameType;
  document.getElementById('selectedGameTitle').innerText = gameType === 'checkers' ? 'Malawi Checkers' : 'Standard Chess';
  switchView('modeSelectView');
}

function showComingSoonModal(feature) {
  document.getElementById('modalTitle').innerText = feature;
  document.getElementById('modalBody').innerText = "Coming Soon! Feature locked until future updates.";
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

/* ==========================================================================
   5. MATCHMAKING & FALSE PLAYER SUBSTITUTION ENGINE
   ========================================================================== */
const FALSE_PLAYERS = [
  { name: "LilongweKing", winRate: "68%", rank: "Diamond" },
  { name: "MzuzuChampion", winRate: "72%", rank: "Master" },
  { name: "NyasaMaster", winRate: "81%", rank: "Grandmaster" },
  { name: "FlyingKingPro", winRate: "75%", rank: "Master" },
  { name: "CheckmateHunter", winRate: "64%", rank: "Platinum" }
];

function selectBotByXp(xp) {
  if (xp < 200) return { diff: "Easy", bot: FALSE_PLAYERS[0] };
  if (xp < 500) return { diff: "Hard", bot: FALSE_PLAYERS[1] };
  if (xp < 1000) return { diff: "Expert", bot: FALSE_PLAYERS[2] };
  return { diff: "Grandmaster", bot: FALSE_PLAYERS[3] };
}

function startOnlineSearch() {
  switchView('matchmakingView');
  matchmakingCountdown = 10;
  document.getElementById('matchTimer').innerText = "10s";

  matchmakingTimer = setInterval(() => {
    matchmakingCountdown--;
    document.getElementById('matchTimer').innerText = `${matchmakingCountdown}s`;

    if (matchmakingCountdown <= 0) {
      stopMatchmakingTimer();
      // BOT SUBSTITUTION TRIGGER
      const botConfig = selectBotByXp(userProgress.xp || 0);
      startGame({
        mode: 'bot_matchmaking',
        opponent: botConfig.bot.name,
        difficulty: botConfig.diff,
        assignedColor: 'white'
      });
    }
  }, 1000);

  if (socket && socket.connected) {
    socket.emit('find_match', {
      gameType: GAME_STATE.type,
      playerToken: getPlayerToken(),
      playerName: userProgress.displayName || 'Player',
      rating: computePlayerRating()
    });
  }
}

/* Rough client-side skill proxy sent to the server's matchmaking queue —
   real Elo (server-tracked, persisted) is covered separately in
   UPGRADE_PLAN.md as a database-backed follow-up; this keeps today's
   localStorage-only profile useful for matching in the meantime. */
function computePlayerRating() {
  const xp = userProgress.xp || 0;
  const wins = userProgress.wins || 0;
  const losses = userProgress.losses || 0;
  return Math.round(1000 + xp * 2 + wins * 12 - losses * 6);
}

function cancelMatchmaking() {
  stopMatchmakingTimer();
  if (socket && socket.connected) {
    socket.emit('cancel_matchmaking');
  }
  goBackView();
}

function stopMatchmakingTimer() {
  if (matchmakingTimer) {
    clearInterval(matchmakingTimer);
    matchmakingTimer = null;
  }
}

function launchDirectAiGame() {
  startGame({
    mode: 'ai_direct',
    opponent: `AI (${userProgress.aiDifficulty})`,
    difficulty: userProgress.aiDifficulty,
    assignedColor: 'white'
  });
}

function startGame(config) {
  GAME_STATE.mode = config.mode;
  GAME_STATE.difficulty = config.difficulty || userProgress.aiDifficulty;
  GAME_STATE.myColor = config.assignedColor || 'white';
  GAME_STATE.roomId = config.roomId || null;
  GAME_STATE.matchActive = true;

  const userTitle = userProgress.displayName ? userProgress.displayName : 'You';
  document.getElementById('p1NameDisplay').innerText = `${userTitle} (${GAME_STATE.myColor})`;
  
  if (config.mode === 'online' || config.mode === 'bot_matchmaking') {
    document.getElementById('p2NameDisplay').innerText = config.opponent;
    document.getElementById('p2ActiveDot').classList.add('visible');
    document.getElementById('undoBtn').style.display = 'none';
  } else {
    document.getElementById('p2NameDisplay').innerText = config.opponent;
    document.getElementById('p2ActiveDot').classList.remove('visible');
    document.getElementById('undoBtn').style.display = 'inline-flex';
  }

  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById('arenaView').classList.add('active');
  updateNavigationButtons();

  resetGame();
}

function resignMatch() {
  if (confirm("Are you sure you want to resign?")) {
    alert("Match resigned. Opponent awarded victory.");
    finishMatch('Black');
  }
}

function finishMatch(winner) {
  GAME_STATE.matchActive = false;
  document.getElementById('p2ActiveDot').classList.remove('visible');

  const isWin = (winner.toLowerCase() === GAME_STATE.myColor.toLowerCase());

  let xpAwarded = 10; // Complete Match Base
  if (isWin) {
    xpAwarded += 30; // Win Match
    if (GAME_STATE.difficulty === "Hard") xpAwarded += 15;
    if (GAME_STATE.difficulty === "Expert") xpAwarded += 25;
    if (GAME_STATE.difficulty === "Grandmaster" || GAME_STATE.difficulty === "Impossible") xpAwarded += 50;
    userProgress.wins = (userProgress.wins || 0) + 1;
  } else {
    userProgress.losses = (userProgress.losses || 0) + 1;
  }

  userProgress.completedMatches = (userProgress.completedMatches || 0) + 1;
  addXP(xpAwarded, isWin ? "Victory Bonus" : "Match Participation");

  updateNavigationButtons();

  setTimeout(() => {
    switchView('homeView');
  }, 300);
}

/* ==========================================================================
   6. DECOUPLED GAME ARCHITECTURE (CHESS.JS & MALAWI CHECKERS ENGINES)
   ========================================================================== */
const GAME_STATE = {
  type: 'checkers',
  mode: 'ai_direct',
  difficulty: 'Hard',
  turn: 'white',
  myColor: 'white',
  board: [],
  chessInstance: null, // chess.js instance
  selectedSquare: null,
  validMoves: [],
  activeMultiJumpSquare: null,
  roomId: null,
  matchActive: false,
  aiPlannedChain: null,   // full multi-jump chain chosen by the checkers AI for the current turn
  aiPlannedIndex: 0,      // which step of that chain we're currently executing
  playerToken: null,      // persisted id used to reconnect into an online match
  lastMove: null,         // { from:[r,c], to:[r,c] } — drives the last-move highlight
  capturedByWhite: [],    // pieces white has captured, for the captured-piece tray
  capturedByBlack: []     // pieces black has captured, for the captured-piece tray
};

function createCheckersSVG(color, isKing) {
  const fill = color === 'white' ? '#f8fafc' : '#0f172a';
  const stroke = color === 'white' ? '#cbd5e1' : '#334155';
  const crown = isKing ? `<polygon points="12,6 14.5,11 18,8 16,14 8,14 6,8 9.5,11" fill="#f59e0b"/>` : '';
  return `<svg class="piece-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${crown}</svg>`;
}

function createChessSVG(type, color) {
  const fill = color === 'white' ? '#f8fafc' : '#1e293b';
  const stroke = color === 'white' ? '#0f172a' : '#f8fafc';
  const paths = {
    p: 'M12,5 A3,3 0 0,0 9,8 A3,3 0 0,0 12,11 A3,3 0 0,0 15,8 A3,3 0 0,0 12,5 M9,12 L15,12 L16,18 L8,18 Z M6,20 L18,20 L18,21 L6,21 Z',
    r: 'M7,5 L9,5 L9,8 L11,8 L11,5 L13,5 L13,8 L15,8 L15,5 L17,5 L17,10 L16,18 L8,18 L7,10 Z M6,20 L18,20 L18,21 L6,21 Z',
    n: 'M10,4 C12,4 16,6 16,10 C16,12 14,13 14,13 L17,18 L7,18 C7,14 8,11 10,9 L8,8 Z M6,20 L18,20 L18,21 L6,21 Z',
    b: 'M12,3 A2,2 0 0,0 10,5 C10,7 12,8 12,10 C10,12 8,13 8,18 L16,18 C16,13 14,12 12,10 C12,8 14,7 14,5 A2,2 0 0,0 12,3 Z M6,20 L18,20 L18,21 L6,21 Z',
    q: 'M6,8 L9,12 L12,6 L15,12 L18,8 L17,18 L7,18 Z M6,20 L18,20 L18,21 L6,21 Z',
    k: 'M11,3 L13,3 L13,5 L15,5 L15,7 L13,7 L13,9 L11,9 L11,7 L9,7 L9,5 L11,5 Z M7,11 L17,11 L16,18 L8,18 Z M6,20 L18,20 L18,21 L6,21 Z'
  };
  return `<svg class="piece-svg" viewBox="0 0 24 24"><path d="${paths[type]}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/></svg>`;
}

/* ================= MALAWI CHECKERS ENGINE RULES ================= */
function initCheckersBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) b[r][c] = { color: 'black', isKing: false };
        else if (r > 4) b[r][c] = { color: 'white', isKing: false };
      }
    }
  }
  return b;
}

function getCheckersMoves(board, player, lockedSquare = null) {
  let captures = [];
  let normalMoves = [];

  const checkSquare = (r, c) => {
    const p = board[r][c];
    if (p && p.color === player) {
      const caps = getPieceCaptures(board, r, c);
      if (caps.length > 0) captures.push(...caps);
      else if (captures.length === 0) normalMoves.push(...getPieceNormals(board, r, c));
    }
  };

  if (lockedSquare) {
    checkSquare(lockedSquare[0], lockedSquare[1]);
  } else {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) checkSquare(r, c);
    }
  }

  // Mandatory captures enforced
  return captures.length > 0 ? captures : normalMoves;
}

function getPieceCaptures(board, r, c) {
  const p = board[r][c];
  const moves = [];
  const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];

  if (!p.isKing) {
    dirs.forEach(([dr, dc]) => {
      const mr = r + dr, mc = c + dc;
      const er = r + dr * 2, ec = c + dc * 2;
      if (er >= 0 && er < 8 && ec >= 0 && ec < 8) {
        const victim = board[mr][mc];
        if (victim && victim.color !== p.color && !board[er][ec]) {
          moves.push({ from: [r, c], to: [er, ec], captured: [mr, mc] });
        }
      }
    });
  } else {
    // Flying King long-range capture implementation
    dirs.forEach(([dr, dc]) => {
      let step = 1;
      let victimPos = null;
      while (true) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
        const sq = board[nr][nc];

        if (sq) {
          if (sq.color === p.color || victimPos) break;
          victimPos = [nr, nc];
        } else if (victimPos) {
          moves.push({ from: [r, c], to: [nr, nc], captured: victimPos });
        }
        step++;
      }
    });
  }
  return moves;
}

function getPieceNormals(board, r, c) {
  const p = board[r][c];
  const moves = [];

  if (!p.isKing) {
    const fwdDirs = p.color === 'white' ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
    fwdDirs.forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr][nc]) {
        moves.push({ from: [r, c], to: [nr, nc], captured: null });
      }
    });
  } else {
    // Flying Kings long-range diagonal movement
    const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
    dirs.forEach(([dr, dc]) => {
      let step = 1;
      while (true) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8 || board[nr][nc]) break;
        moves.push({ from: [r, c], to: [nr, nc], captured: null });
        step++;
      }
    });
  }
  return moves;
}

/* ================= CHESS INTEGRATION (CHESS.JS REFUGE) ================= */
function initChessEngine() {
  if (typeof Chess !== 'undefined') {
    GAME_STATE.chessInstance = new Chess();
  }
}

function resetGame() {
  GAME_STATE.turn = 'white';
  GAME_STATE.selectedSquare = null;
  GAME_STATE.validMoves = [];
  GAME_STATE.activeMultiJumpSquare = null;
  GAME_STATE.aiPlannedChain = null;
  GAME_STATE.aiPlannedIndex = 0;
  GAME_STATE.lastMove = null;
  GAME_STATE.capturedByWhite = [];
  GAME_STATE.capturedByBlack = [];

  if (GAME_STATE.type === 'checkers') {
    GAME_STATE.board = initCheckersBoard();
  } else {
    initChessEngine();
    syncChessJsToBoard();
  }
  renderBoard();
}

function syncChessJsToBoard() {
  const rawBoard = GAME_STATE.chessInstance.board();
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = rawBoard[r][c];
      if (p) {
        b[r][c] = { type: p.type, color: p.color === 'w' ? 'white' : 'black' };
      }
    }
  }
  GAME_STATE.board = b;
}

function getChessJsMoves() {
  const legal = GAME_STATE.chessInstance.moves({ verbose: true });
  return legal.map(m => {
    const fromCol = m.from.charCodeAt(0) - 97;
    const fromRow = 8 - parseInt(m.from[1]);
    const toCol = m.to.charCodeAt(0) - 97;
    const toRow = 8 - parseInt(m.to[1]);
    return {
      from: [fromRow, fromCol],
      to: [toRow, toCol],
      san: m.san,
      flags: m.flags
    };
  });
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  boardEl.classList.add('board-wood');
  boardEl.classList.remove('checkmate-flash');

  const movesForTurn = GAME_STATE.type === 'checkers'
    ? getCheckersMoves(GAME_STATE.board, GAME_STATE.turn, GAME_STATE.activeMultiJumpSquare)
    : getChessJsMoves();

  const isCheckmate = GAME_STATE.type === 'chess' && GAME_STATE.chessInstance &&
    GAME_STATE.chessInstance.game_over() && GAME_STATE.matchActive &&
    GAME_STATE.chessInstance.in_checkmate();

  if (GAME_STATE.type === 'chess' && GAME_STATE.chessInstance && GAME_STATE.chessInstance.game_over() && GAME_STATE.matchActive) {
    let winner = 'Draw';
    if (isCheckmate) {
      winner = GAME_STATE.turn === 'white' ? 'Black' : 'White';
    }
    renderCheckersOrChessBoard(movesForTurn, isCheckmate);
    if (isCheckmate) boardEl.classList.add('checkmate-flash');
    setTimeout(() => {
      alert(`Game Over! ${winner === 'Draw' ? 'Stalemate / Draw' : winner + ' Wins!'}`);
      finishMatch(winner);
    }, isCheckmate ? 900 : 100);
    return;
  }

  if (movesForTurn.length === 0 && GAME_STATE.matchActive) {
    const winner = GAME_STATE.turn === 'white' ? 'Black' : 'White';
    setTimeout(() => {
      alert(`Game Over! ${winner} Wins!`);
      finishMatch(winner);
    }, 100);
    return;
  }

  if (GAME_STATE.activeMultiJumpSquare) {
    GAME_STATE.selectedSquare = GAME_STATE.activeMultiJumpSquare;
    GAME_STATE.validMoves = movesForTurn;
  }

  renderCheckersOrChessBoard(movesForTurn, false);

  document.getElementById('p1Pill').classList.toggle('active', GAME_STATE.turn === 'white');
  document.getElementById('p2Pill').classList.toggle('active', GAME_STATE.turn === 'black');
  renderCapturedTrays();

  // Trigger Human-Like AI turn execution
  if (GAME_STATE.turn === 'black' && GAME_STATE.matchActive) {
    triggerAiTurn();
  }
}

function findKingInCheckSquare() {
  if (GAME_STATE.type !== 'chess' || !GAME_STATE.chessInstance) return null;
  if (!GAME_STATE.chessInstance.in_check || !GAME_STATE.chessInstance.in_check()) return null;
  const turnColor = GAME_STATE.chessInstance.turn(); // 'w' | 'b'
  const board = GAME_STATE.chessInstance.board();
  for (let rr = 0; rr < 8; rr++) {
    for (let cc = 0; cc < 8; cc++) {
      const cell = board[rr][cc];
      if (cell && cell.type === 'k' && cell.color === turnColor) return [rr, cc];
    }
  }
  return null;
}

function renderCheckersOrChessBoard(movesForTurn, forceNoInteraction) {
  const boardEl = document.getElementById('board');
  const checkSquare = findKingInCheckSquare();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;

      if (GAME_STATE.selectedSquare && GAME_STATE.selectedSquare[0] === r && GAME_STATE.selectedSquare[1] === c) {
        sq.classList.add('selected');
      }

      if (GAME_STATE.lastMove) {
        if (GAME_STATE.lastMove.from[0] === r && GAME_STATE.lastMove.from[1] === c) sq.classList.add('last-move-from');
        if (GAME_STATE.lastMove.to[0] === r && GAME_STATE.lastMove.to[1] === c) sq.classList.add('last-move-to');
      }

      if (checkSquare && checkSquare[0] === r && checkSquare[1] === c) {
        sq.classList.add('king-in-check');
      }

      if (!forceNoInteraction) {
        const targetMove = GAME_STATE.validMoves.find(m => m.to[0] === r && m.to[1] === c);
        if (targetMove) {
          if (targetMove.captured || GAME_STATE.board[r][c]) {
            sq.classList.add('highlight-capture');
          } else {
            sq.classList.add('highlight');
          }
        }
      }

      const p = GAME_STATE.board[r][c];
      if (p) {
        sq.innerHTML = GAME_STATE.type === 'checkers' ? createCheckersSVG(p.color, p.isKing) : createChessSVG(p.type, p.color);
      }

      if (!forceNoInteraction) {
        sq.addEventListener('click', () => handleSquareClick(r, c, movesForTurn));
      }
      boardEl.appendChild(sq);
    }
  }
}

function renderCapturedTrays() {
  const p1Tray = document.getElementById('capturedByP1');
  const p2Tray = document.getElementById('capturedByP2');
  if (!p1Tray || !p2Tray) return;

  const mine = GAME_STATE.myColor === 'white' ? GAME_STATE.capturedByWhite : GAME_STATE.capturedByBlack;
  const theirs = GAME_STATE.myColor === 'white' ? GAME_STATE.capturedByBlack : GAME_STATE.capturedByWhite;

  const renderPieceIcon = (item) => GAME_STATE.type === 'checkers'
    ? createCheckersSVG(item.color, item.isKing)
    : createChessSVG(item.type, item.color);

  p1Tray.innerHTML = mine.map(renderPieceIcon).join('');
  p2Tray.innerHTML = theirs.map(renderPieceIcon).join('');
}

function handleSquareClick(r, c, legalMoves) {
  if (GAME_STATE.turn !== GAME_STATE.myColor) return;

  if (GAME_STATE.selectedSquare) {
    const move = GAME_STATE.validMoves.find(m => m.to[0] === r && m.to[1] === c);
    if (move) {
      executeMove(move);
      return;
    }
  }

  if (GAME_STATE.activeMultiJumpSquare) return;

  const p = GAME_STATE.board[r][c];
  if (p && p.color === GAME_STATE.turn) {
    GAME_STATE.selectedSquare = [r, c];
    GAME_STATE.validMoves = legalMoves.filter(m => m.from[0] === r && m.from[1] === c);
  } else {
    GAME_STATE.selectedSquare = null;
    GAME_STATE.validMoves = [];
  }
  renderBoard();
}

function executeMove(move) {
  GAME_STATE.lastMove = { from: move.from, to: move.to };

  if (GAME_STATE.type === 'checkers') {
    const p = GAME_STATE.board[move.from[0]][move.from[1]];
    GAME_STATE.board[move.from[0]][move.from[1]] = null;

    if (move.captured) {
      const victim = GAME_STATE.board[move.captured[0]][move.captured[1]];
      if (victim) {
        const tray = p.color === 'white' ? GAME_STATE.capturedByWhite : GAME_STATE.capturedByBlack;
        tray.push({ color: victim.color, isKing: victim.isKing });
      }
      GAME_STATE.board[move.captured[0]][move.captured[1]] = null;
    }

    if ((p.color === 'white' && move.to[0] === 0) || (p.color === 'black' && move.to[0] === 7)) {
      p.isKing = true;
    }

    GAME_STATE.board[move.to[0]][move.to[1]] = p;

    if (move.captured) {
      const subCaptures = getPieceCaptures(GAME_STATE.board, move.to[0], move.to[1]);
      if (subCaptures.length > 0) {
        GAME_STATE.activeMultiJumpSquare = move.to;
        GAME_STATE.selectedSquare = move.to;
        GAME_STATE.validMoves = subCaptures;
        renderBoard();
        return;
      }
    }
  } else {
    // Execute Chess move via chess.js
    const fromSquare = String.fromCharCode(97 + move.from[1]) + (8 - move.from[0]);
    const toSquare = String.fromCharCode(97 + move.to[1]) + (8 - move.to[0]);
    const mover = GAME_STATE.turn;
    const result = GAME_STATE.chessInstance.move({ from: fromSquare, to: toSquare, promotion: move.promotion || 'q' });
    if (result && result.captured) {
      const tray = mover === 'white' ? GAME_STATE.capturedByWhite : GAME_STATE.capturedByBlack;
      tray.push({ color: mover === 'white' ? 'black' : 'white', type: result.captured });
    }
    syncChessJsToBoard();
  }

  if (GAME_STATE.mode === 'online' && GAME_STATE.turn === GAME_STATE.myColor && socket) {
    socket.emit('make_move', { roomId: GAME_STATE.roomId, move: move, gameType: GAME_STATE.type });
  }

  GAME_STATE.activeMultiJumpSquare = null;
  GAME_STATE.selectedSquare = null;
  GAME_STATE.validMoves = [];
  GAME_STATE.turn = GAME_STATE.turn === 'white' ? 'black' : 'white';
  renderBoard();
}

/* ==========================================================================
   7. SEPARATED CUSTOM AI ENGINE & HUMAN THINKING BEHAVIOR
   ========================================================================== */
function calculateHumanThinkingDelay(moveCategory) {
  switch (moveCategory) {
    case 'fast':
      return Math.floor(Math.random() * 500) + 300;
    case 'simple':
      return Math.floor(Math.random() * 1200) + 800; // 0.8s to 2s
    case 'difficult':
      return Math.floor(Math.random() * 5000) + 3000; // 3s to 8s
    case 'critical':
      return Math.floor(Math.random() * 7000) + 5000; // 5s to 12s
    default:
      return Math.floor(Math.random() * 1500) + 1000;
  }
}

function triggerAiTurn() {
  document.getElementById('aiThinkingBanner').style.display = 'block';
  if (GAME_STATE.type === 'checkers') {
    triggerCheckersAiTurn();
  } else {
    triggerChessAiTurn();
  }
}

/* ---- Checkers AI turn: plans the FULL capture chain once via
   NyasaCheckersAI (js/checkers-engine.js), then plays it back one jump
   at a time through the existing executeMove()/animation pipeline so a
   multi-jump still looks and behaves exactly like before. ---- */
function triggerCheckersAiTurn() {
  // Continuing a previously-planned multi-jump: just play the next step.
  if (GAME_STATE.aiPlannedChain && GAME_STATE.aiPlannedIndex < GAME_STATE.aiPlannedChain.length) {
    const step = GAME_STATE.aiPlannedChain[GAME_STATE.aiPlannedIndex];
    GAME_STATE.aiPlannedIndex++;
    setTimeout(() => {
      executeMove({ from: step.from, to: step.to, captured: step.captured });
      document.getElementById('aiThinkingBanner').style.display = 'none';
    }, calculateHumanThinkingDelay('fast'));
    return;
  }

  GAME_STATE.aiPlannedChain = null;
  GAME_STATE.aiPlannedIndex = 0;

  const legacyMoves = getCheckersMoves(GAME_STATE.board, 'black', GAME_STATE.activeMultiJumpSquare);
  if (legacyMoves.length === 0) { document.getElementById('aiThinkingBanner').style.display = 'none'; return; }

  let moveCategory = legacyMoves.length > 8 ? 'difficult' : 'simple';
  if (legacyMoves.some(m => m.captured)) moveCategory = 'critical';

  const delay = calculateHumanThinkingDelay(moveCategory);

  setTimeout(() => {
    let chain = null;
    if (typeof NyasaCheckersAI !== 'undefined') {
      chain = NyasaCheckersAI.chooseChain(GAME_STATE.board, 'black', userProgress.aiDifficulty);
    }
    document.getElementById('aiThinkingBanner').style.display = 'none';

    if (chain && chain.length > 0) {
      GAME_STATE.aiPlannedChain = chain;
      GAME_STATE.aiPlannedIndex = 1;
      const step = chain[0];
      executeMove({ from: step.from, to: step.to, captured: step.captured });
    } else {
      // Fallback (engine script failed to load) — old single-ply heuristic.
      executeMove(selectBestAiMove(legacyMoves));
    }
  }, delay);
}

/* ---- Chess AI turn: delegates to NyasaChessAI (js/chess-engine.js),
   a minimax/alpha-beta/iterative-deepening engine, then converts its
   chess.js verbose move back into the app's internal {from:[r,c],
   to:[r,c]} format so executeMove() needs no chess-specific changes. ---- */
function triggerChessAiTurn() {
  const legacyMoves = getChessJsMoves();
  if (legacyMoves.length === 0) { document.getElementById('aiThinkingBanner').style.display = 'none'; return; }

  let moveCategory = legacyMoves.length > 20 ? 'difficult' : 'simple';
  if (GAME_STATE.chessInstance.in_check && GAME_STATE.chessInstance.in_check()) moveCategory = 'critical';

  const delay = calculateHumanThinkingDelay(moveCategory);

  setTimeout(() => {
    let verboseMove = null;
    if (typeof NyasaChessAI !== 'undefined') {
      verboseMove = NyasaChessAI.chooseMove(GAME_STATE.chessInstance, userProgress.aiDifficulty);
    }
    document.getElementById('aiThinkingBanner').style.display = 'none';

    if (verboseMove) {
      executeMove(chessVerboseToInternal(verboseMove));
    } else {
      // Fallback (engine script failed to load) — old single-ply heuristic.
      executeMove(selectBestAiMove(legacyMoves));
    }
  }, delay);
}

function chessVerboseToInternal(m) {
  const fromCol = m.from.charCodeAt(0) - 97;
  const fromRow = 8 - parseInt(m.from[1]);
  const toCol = m.to.charCodeAt(0) - 97;
  const toRow = 8 - parseInt(m.to[1]);
  return { from: [fromRow, fromCol], to: [toRow, toCol], san: m.san, flags: m.flags, promotion: m.promotion };
}

function selectBestAiMove(moves) {
  // AI evaluation completely decoupled from chess.js logic
  if (userProgress.aiDifficulty === 'Beginner' || userProgress.aiDifficulty === 'Easy') {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (let move of moves) {
    let score = evaluateMoveHeuristic(move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function evaluateMoveHeuristic(move) {
  let score = 0;
  if (move.captured) score += 50;
  if (move.flags && move.flags.includes('c')) score += 40;
  // Positional center bias
  score += (4 - Math.abs(3.5 - move.to[0])) + (4 - Math.abs(3.5 - move.to[1]));
  return score;
}

function undoMove() {
  if (GAME_STATE.mode === 'online' || GAME_STATE.mode === 'bot_matchmaking') {
    alert("Undo disabled during ranked matchmaking.");
    return;
  }
  alert("Undo supported in single-player practice mode.");
}