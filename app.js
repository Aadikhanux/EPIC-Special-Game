import {
  FilesetResolver,
  FaceDetector,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ── Landmark constants (Hand) ────────────────────────────────────────────────
const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  PINKY_MCP: 17,
};

const PINCH_THRESHOLD = 0.055;
const COUNTDOWN_SECONDS = 3;
const FIST_HOLD_FRAMES = 12;
const GRID = 3;
const LOAD_TIMEOUT_MS = 20000;

const PHOTOBOOTH_CONTRAST_ALPHA = 1.3;
const PHOTOBOOTH_BRIGHTNESS_BETA = 10;
const PHOTOBOOTH_NOISE_STD = 15;

// ── DOM Elements ──────────────────────────────────────────────────────────────
const videoEl = document.getElementById("webcam");
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const fxCanvas = document.getElementById("fxCanvas");
const fxCtx = fxCanvas.getContext("2d");

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");
const loaderRetry = document.getElementById("loaderRetry");
const errorBanner = document.getElementById("errorBanner");
const progressBadge = document.getElementById("progressBadge");
const progressText = document.getElementById("progressText");
const puzzleTimerText = document.getElementById("puzzleTimerText");

const rankBadge = document.getElementById("rankBadge");
const rankValue = document.getElementById("rankValue");

const gestureIcon = document.getElementById("gestureIcon");
const gestureTitle = document.getElementById("gestureTitle");
const gestureHint = document.getElementById("gestureHint");
const saveSolveBtn = document.getElementById("saveSolveBtn");

const galleryStrip = document.getElementById("galleryStrip");
const galleryEmpty = document.getElementById("galleryEmpty");
const galleryCount = document.getElementById("galleryCount");
const downloadStripBtn = document.getElementById("downloadStripBtn");
const flashOverlay = document.getElementById("flashOverlay");

const snapBtn = document.getElementById("snapBtn");
const mobileSnapBtn = document.getElementById("mobileSnapBtn");
const retakeBtn = document.getElementById("retakeBtn");
const soundToggleBtn = document.getElementById("soundToggleBtn");
const soundIconOn = document.getElementById("soundIconOn");
const soundIconOff = document.getElementById("soundIconOff");
const helpBtn = document.getElementById("helpBtn");
const mobileLbToggleBtn = document.getElementById("mobileLbToggleBtn");
const closeDrawerBtn = document.getElementById("closeDrawerBtn");
const sidebarDrawer = document.getElementById("gallery");

const nameEntryModal = document.getElementById("nameEntryModal");
const playerNameInput = document.getElementById("playerNameInput");
const startGameBtn = document.getElementById("startGameBtn");

const lobbyModal = document.getElementById("lobbyModal");
const lobbyTitle = document.getElementById("lobbyTitle");
const lobbySubtitle = document.getElementById("lobbySubtitle");
const lobbyPlayerCount = document.getElementById("lobbyPlayerCount");
const lobbyAnnounce = document.getElementById("lobbyAnnounce");
const lobbyAnnounceText = document.getElementById("lobbyAnnounceText");

const announceBanner = document.getElementById("announceBanner");
const announceText = document.getElementById("announceText");

const leaderboardModal = document.getElementById("leaderboardModal");
const leaderboardEntries = document.getElementById("leaderboardEntries");
const leaderboardWinner = document.getElementById("leaderboardWinner");

const solveResultModal = document.getElementById("solveResultModal");
const solveResultEmoji = document.getElementById("solveResultEmoji");
const solveResultTitle = document.getElementById("solveResultTitle");
const solveResultTime = document.getElementById("solveResultTime");
const solveResultRank = document.getElementById("solveResultRank");
const solveResultViewLB = document.getElementById("solveResultViewLB");
const solveResultClose = document.getElementById("solveResultClose");

const endedModal = document.getElementById("endedModal");
const endedWinner = document.getElementById("endedWinner");
const endedEntries = document.getElementById("endedEntries");
const endedCloseBtn = document.getElementById("endedCloseBtn");

const helpModal = document.getElementById("helpModal");
const helpModalClose = document.getElementById("helpModalClose");
const helpModalCloseIcon = document.getElementById("helpModalCloseIcon");

const lobbyPlayerName = document.getElementById("lobbyPlayerName");

const tsState = document.getElementById("tsState");
const tsPlayers = document.getElementById("tsPlayers");
const tsElapsed = document.getElementById("tsElapsed");
const tsElapsedRow = document.getElementById("tsElapsedRow");

// ── Audio engine ──────────────────────────────────────────────────────────────
let soundMuted = false;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function resumeAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone({ freq = 440, type = "sine", gain = 0.18, attack = 0.005, decay = 0.12, duration = 0.15 } = {}) {
  if (soundMuted) return;
  resumeAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + attack);
  env.gain.exponentialRampToValueAtTime(0.001, now + attack + decay);
  osc.connect(env);
  env.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playNoise({ gain = 0.25, duration = 0.18, freq = 800 } = {}) {
  if (soundMuted) return;
  resumeAudio();
  const now = audioCtx.currentTime;
  const bufSize = Math.floor(audioCtx.sampleRate * duration);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const env = audioCtx.createGain();
  env.gain.setValueAtTime(gain, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filter);
  filter.connect(env);
  env.connect(audioCtx.destination);
  src.start(now);
  src.stop(now + duration);
}

function soundCountdownBeep(number) {
  const freqs = { 3: 660, 2: 880, 1: 1100 };
  playTone({ freq: freqs[number] || 660, gain: 0.22, decay: 0.18, duration: 0.22 });
}

function soundSnap() {
  playTone({ freq: 1400, type: "square", gain: 0.1, attack: 0.001, decay: 0.06, duration: 0.08 });
}

function soundShatter() {
  playNoise({ gain: 0.35, duration: 0.25, freq: 400 });
  playTone({ freq: 90, type: "sawtooth", gain: 0.3, attack: 0.001, decay: 0.22, duration: 0.25 });
}

function soundComplete() {
  [523, 659, 784, 1047].forEach((freq, i) => {
    const now = audioCtx.currentTime + i * 0.1;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.18, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(env);
    env.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  });
}

function soundSaved() {
  playTone({ freq: 880, gain: 0.12, decay: 0.3, duration: 0.32 });
}

function triggerFlash() {
  flashOverlay.classList.add("flash");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flashOverlay.classList.remove("flash");
    });
  });
}

function applyVignette(canvasEl) {
  const ctx2 = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;
  const grad = ctx2.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx2.fillStyle = grad;
  ctx2.fillRect(0, 0, w, h);
}

// ── Confetti Particle FX ──────────────────────────────────────────────────────
const confettiParticles = [];
function spawnConfetti(count = 50) {
  const colors = ["#f5c518", "#00e5ff", "#10b981", "#ff4757", "#ffffff", "#ffd700"];
  for (let i = 0; i < count; i++) {
    confettiParticles.push({
      x: fxCanvas.width / 2 + (Math.random() - 0.5) * 300,
      y: fxCanvas.height / 2 - 100,
      w: Math.random() * 8 + 4,
      h: Math.random() * 8 + 4,
      vx: (Math.random() - 0.5) * 16,
      vy: Math.random() * -12 - 4,
      gravity: 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      life: 1,
      decay: Math.random() * 0.015 + 0.01,
    });
  }
}

function updateAndDrawConfetti() {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const p = confettiParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.rotation += p.rotSpeed;
    p.life -= p.decay;
    if (p.life <= 0 || p.y > fxCanvas.height) {
      confettiParticles.splice(i, 1);
      continue;
    }
    fxCtx.save();
    fxCtx.globalAlpha = Math.max(0, p.life);
    fxCtx.translate(p.x, p.y);
    fxCtx.rotate((p.rotation * Math.PI) / 180);
    fxCtx.fillStyle = p.color;
    fxCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    fxCtx.restore();
  }
}

// ── Hand / Finger Skeleton Rendering Engine ──────────────────────────────────
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm webbing
  [5, 9], [9, 13], [13, 17]
];

function drawHandSkeleton(ctx, landmarks, isPinching = false) {
  if (!landmarks || landmarks.length < 21) return;

  const points = landmarks.map((lm) => ({
    x: (1 - lm.x) * canvas.width,
    y: lm.y * canvas.height,
  }));

  ctx.save();

  // 1. Draw Bones with neon cyber glow
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  HAND_CONNECTIONS.forEach(([i, j]) => {
    const p1 = points[i];
    const p2 = points[j];

    // Outer glow
    ctx.strokeStyle = isPinching ? "rgba(245, 197, 24, 0.45)" : "rgba(0, 229, 255, 0.4)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Inner core bone line
    ctx.strokeStyle = isPinching ? "#f5c518" : "#00e5ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });

  // 2. Draw Joint Nodes
  points.forEach((pt, idx) => {
    const isTip = (idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20);
    const isIndexOrThumb = (idx === 4 || idx === 8);

    const radius = isIndexOrThumb ? (isPinching ? 8 : 6) : isTip ? 5 : 4;
    const nodeColor = isIndexOrThumb
      ? (isPinching ? "#f5c518" : "#00e5ff")
      : (isTip ? "#ffffff" : "rgba(0, 229, 255, 0.9)");

    // Joint aura
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = isPinching ? "rgba(245, 197, 24, 0.3)" : "rgba(0, 229, 255, 0.25)";
    ctx.fill();

    // Joint center
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor;
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // 3. Pinching connection line & target indicator
  if (isPinching) {
    const thumb = points[4];
    const index = points[8];
    const midX = (thumb.x + index.x) / 2;
    const midY = (thumb.y + index.y) / 2;

    ctx.beginPath();
    ctx.moveTo(thumb.x, thumb.y);
    ctx.lineTo(index.x, index.y);
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(midX, midY, 14, 0, Math.PI * 2);
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── WebSocket Tournament Client ───────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
const wsSendQueue = [];

let myPlayer = {
  id: null,
  name: "",
  solveTime: null,
  rank: null,
  photoCanvas: null,
};

let serverTournamentState = "LOBBY"; // LOBBY | ACTIVE | ENDED
let globalLeaderboard = [];

function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    console.log("[Tournament WS] Connected.");
    flushWSSendQueue();
    if (myPlayer.name) {
      ws.send(JSON.stringify({ type: "PLAYER_JOIN", name: myPlayer.name }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error("[Tournament WS] Parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("[Tournament WS] Disconnected. Reconnecting in 2s…");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.warn("[Tournament WS] Error:", err);
  };
}

function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    wsSendQueue.push(data);
  }
}

function flushWSSendQueue() {
  while (wsSendQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    const data = wsSendQueue.shift();
    ws.send(JSON.stringify(data));
  }
}

function handleServerMessage(msg) {
  console.log("[Tournament WS] Message:", msg.type, msg);
  switch (msg.type) {
    case "PLAYER_REGISTERED":
      myPlayer.id = msg.playerId;
      myPlayer.name = msg.name;
      if (lobbyPlayerName) lobbyPlayerName.textContent = msg.name;
      serverTournamentState = msg.tournamentState || "LOBBY";
      updateTournamentStateUI(serverTournamentState, msg.stats, msg.elapsed);
      if (msg.leaderboard) {
        globalLeaderboard = msg.leaderboard;
        renderSidebarLeaderboard(globalLeaderboard);
      }

      // Show Lobby modal only if name entry is closed and contest is NOT active
      if (serverTournamentState !== "ACTIVE") {
        if (nameEntryModal.classList.contains("hidden")) {
          lobbyModal.classList.remove("hidden");
        }
        statusDot.className = "status-dot";
        statusText.textContent = "🚀 Contest about to start — waiting for admin";
      } else {
        lobbyModal.classList.add("hidden");
        statusDot.className = "status-dot live";
        statusText.textContent = `${myPlayer.name} — Contest Live! Align face & SNAP`;
        ensureCameraAndModelsReady();
      }
      break;

    case "TOURNAMENT_STATE":
      serverTournamentState = msg.state;
      updateTournamentStateUI(serverTournamentState, msg.stats, msg.elapsed);
      if (msg.leaderboard) {
        globalLeaderboard = msg.leaderboard;
        renderSidebarLeaderboard(globalLeaderboard);
      }
      if (msg.announcement) showAnnouncement(msg.announcement);

      // Only show lobby modal if name entry was completed and not in puzzle
      if (serverTournamentState !== "ACTIVE" && appState !== "puzzle" && appState !== "shattering") {
        if (nameEntryModal.classList.contains("hidden") && myPlayer.name) {
          lobbyModal.classList.remove("hidden");
        }
        statusDot.className = "status-dot";
        statusText.textContent = "🔒 Contest locked — waiting for admin";
      } else if (serverTournamentState === "ACTIVE" && nameEntryModal.classList.contains("hidden")) {
        ensureCameraAndModelsReady();
      }
      break;

    case "TOURNAMENT_START":
      serverTournamentState = "ACTIVE";
      myPlayer.solveTime = null;
      myPlayer.rank = null;
      rankBadge.classList.add("hidden");
      solveResultModal.classList.add("hidden");
      endedModal.classList.add("hidden");
      lobbyModal.classList.add("hidden");

      if (appState === "puzzle" || appState === "shattering" || puzzle.solved) {
        resetPuzzleOnly();
      }

      ensureCameraAndModelsReady();
      updateTournamentStateUI("ACTIVE");
      playTone({ freq: 880, type: "sine", gain: 0.2, duration: 0.3 });
      soundComplete();
      statusDot.className = "status-dot live";
      statusText.textContent = `${myPlayer.name || "Player"} — Contest live! Align face & SNAP`;
      break;

    case "TOURNAMENT_END":
      serverTournamentState = "ENDED";
      if (appState === "countdown") {
        countdown.active = false;
        appState = "tracking";
        updateGestureHUD();
      }
      updateTournamentStateUI("ENDED", msg.stats, msg.elapsed);
      if (msg.leaderboard) {
        globalLeaderboard = msg.leaderboard;
        renderSidebarLeaderboard(globalLeaderboard);
        renderEndedModal(globalLeaderboard);
      }
      endedModal.classList.remove("hidden");
      statusDot.className = "status-dot";
      statusText.textContent = "Contest ended!";
      break;

    case "TOURNAMENT_RESET":
      serverTournamentState = "LOBBY";
      myPlayer.solveTime = null;
      myPlayer.rank = null;
      rankBadge.classList.add("hidden");
      solveResultModal.classList.add("hidden");
      endedModal.classList.add("hidden");
      resetPuzzleOnly();
      updateTournamentStateUI("LOBBY", msg.stats);
      if (msg.leaderboard) {
        globalLeaderboard = msg.leaderboard;
        renderSidebarLeaderboard(globalLeaderboard);
      }
      if (nameEntryModal.classList.contains("hidden") && myPlayer.name) {
        lobbyModal.classList.remove("hidden");
      }
      statusDot.className = "status-dot";
      statusText.textContent = "🔒 Contest reset — waiting in lobby";
      break;

    case "LEADERBOARD_UPDATE":
      globalLeaderboard = msg.leaderboard || [];
      renderSidebarLeaderboard(globalLeaderboard);
      updateTournamentStateUI(serverTournamentState, msg.stats, msg.elapsed);

      const myEntry = globalLeaderboard.find((e) => e.id === myPlayer.id);
      if (myEntry && myEntry.rank != null) {
        myPlayer.rank = myEntry.rank;
        rankBadge.classList.remove("hidden");
        rankValue.textContent = `#${myEntry.rank}`;
      }
      break;

    case "SOLVE_CONFIRMED":
      myPlayer.solveTime = msg.solveTime;
      myPlayer.rank = msg.rank;
      rankBadge.classList.remove("hidden");
      rankValue.textContent = `#${msg.rank}`;

      solveResultEmoji.textContent = msg.rank === 1 ? "👑" : msg.rank <= 3 ? "🏆" : "🎉";
      solveResultTitle.textContent = msg.rank === 1 ? "1st PLACE!" : `RANK #${msg.rank}`;
      solveResultTime.textContent = formatTime(msg.solveTime);
      solveResultRank.textContent = `Global Rank: #${msg.rank} of ${msg.totalSolved} solvers`;
      solveResultModal.classList.remove("hidden");
      spawnConfetti(120);
      soundComplete();
      break;

    case "ANNOUNCEMENT":
      showAnnouncement(msg.message);
      break;

    case "KICKED":
      alert("You have been disconnected by the tournament admin.");
      location.reload();
      break;
  }
}

function updateTournamentStateUI(state, stats, elapsed) {
  console.log("[Tournament UI] State:", state, "Connected players:", stats?.connected, "Total registered:", stats?.totalPlayers);
  if (tsState) {
    tsState.textContent = state;
    tsState.className = `ts-value ts-${state.toLowerCase()}`;
  }
  if (stats) {
    if (tsPlayers) tsPlayers.textContent = `${stats.connected} (${stats.solved} solved)`;
    if (lobbyPlayerCount) lobbyPlayerCount.textContent = stats.connected;
  }
  if (elapsed != null && elapsed > 0) {
    if (tsElapsedRow) tsElapsedRow.style.display = "flex";
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    if (tsElapsed) tsElapsed.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  } else {
    if (tsElapsedRow) tsElapsedRow.style.display = "none";
  }
}

function showAnnouncement(msg) {
  if (!msg) return;
  announceText.textContent = msg;
  announceBanner.classList.remove("hidden");
  lobbyAnnounceText.textContent = msg;
  lobbyAnnounce.classList.remove("hidden");
  setTimeout(() => announceBanner.classList.add("hidden"), 8000);
}

function renderSidebarLeaderboard(entries) {
  galleryCount.textContent = `${entries.filter(e => e.solveTime != null).length} solved`;
  if (entries.length === 0) {
    if (galleryEmpty) galleryEmpty.style.display = "flex";
    return;
  }
  if (galleryEmpty) galleryEmpty.style.display = "none";

  const container = document.getElementById("galleryStrip");
  container.innerHTML = "";

  entries.slice(0, 30).forEach((e) => {
    const row = document.createElement("div");
    let medalClass = "";
    if (e.rank === 1) medalClass = "gold-row";
    else if (e.rank === 2) medalClass = "silver-row";
    else if (e.rank === 3) medalClass = "bronze-row";
    if (e.id === myPlayer.id) medalClass += " self-row";

    row.className = `lb-sidebar-row ${medalClass}`;
    const rankDisplay = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `#${e.rank || "-"}`;

    row.innerHTML = `
      <span class="lb-rank">${rankDisplay}</span>
      <div class="lb-info">
        <span class="lb-name">${escapeHtml(e.name)}${e.id === myPlayer.id ? " (You)" : ""}</span>
        <span class="lb-time">${e.solveTime != null ? formatTime(e.solveTime) : "Playing…"}</span>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderEndedModal(entries) {
  endedEntries.innerHTML = "";
  const medals = ["gold", "silver", "bronze"];
  const sorted = entries.filter((e) => e.solveTime != null);

  if (sorted.length === 0) {
    endedWinner.textContent = "Tournament Ended";
    return;
  }

  sorted.slice(0, 10).forEach((p, i) => {
    const row = document.createElement("div");
    row.className = `leaderboard-row ${medals[i] || ""}`;
    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = p.name;
    const time = document.createElement("span");
    time.className = "leaderboard-time";
    time.textContent = formatTime(p.solveTime);
    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(time);
    endedEntries.appendChild(row);
  });

  const winner = sorted[0];
  endedWinner.textContent = `🏆 WINNER: ${winner.name} with ${formatTime(winner.solveTime)}!`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── App state ─────────────────────────────────────────────────────────────────
let appState = "tracking"; // 'tracking' | 'countdown' | 'puzzle' | 'shattering'

const puzzle = {
  boardBox: null,
  pieces: [],
  solved: false,
  tileW: 0,
  tileH: 0,
  timerStartedAt: 0,
  timerElapsed: 0,
  fullPhotoboothCanvas: null,
};

const smoothFaceBox = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  initialized: false,
  detected: false,
  lastSeenAt: 0,
};

const countdown = { active: false, startedAt: 0 };
let lastCountdownN = -1;

const SHATTER_COLS = 6;
const SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 850;
const shatter = {
  active: false,
  startedAt: 0,
  fragments: [],
  pendingCanvas: null,
};

function resetPuzzleOnly() {
  puzzle.boardBox = null;
  puzzle.pieces = [];
  puzzle.solved = false;
  puzzle.fullPhotoboothCanvas = null;
  puzzle.timerStartedAt = 0;
  puzzle.timerElapsed = 0;
  appState = "tracking";
  countdown.active = false;
  drag.activeHand = null;
  drag.piece = null;
  pointerDrag.active = false;
  pointerDrag.piece = null;
  shatter.active = false;
  shatter.fragments = [];
  shatter.pendingCanvas = null;
  fistHoldCounter = 0;
  lastCountdownN = -1;
  smoothFaceBox.initialized = false;
  smoothFaceBox.detected = false;
  saveSolveBtn.classList.add("hidden");
  updateProgressBadge();
  updateGestureHUD();
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 10) % 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
}

function updateGestureHUD() {
  if (gestureIcon) {
    if (appState === "tracking") {
      gestureIcon.textContent = "👤";
      if (gestureTitle) gestureTitle.textContent = "AI FACE TRACKING";
      if (gestureHint) gestureHint.textContent = "Center face & click SNAP PHOTO when ready";
    } else if (appState === "countdown") {
      gestureIcon.textContent = "⏱️";
      if (gestureTitle) gestureTitle.textContent = "SMILE & HOLD STILL";
      if (gestureHint) gestureHint.textContent = "Capturing photobooth portrait in 3 seconds…";
    } else if (appState === "puzzle") {
      if (puzzle.solved) {
        gestureIcon.textContent = "🏆";
        if (gestureTitle) gestureTitle.textContent = "SOLVED!";
        if (gestureHint) gestureHint.textContent = "Click SUBMIT TIME button";
      } else {
        gestureIcon.textContent = "🧩";
        if (gestureTitle) gestureTitle.textContent = "SOLVE PUZZLE";
        if (gestureHint) gestureHint.textContent = "Use pinch gesture to drag pieces";
      }
    }
  }
  if (saveSolveBtn) {
    if (appState === "puzzle" && puzzle.solved) {
      saveSolveBtn.classList.remove("hidden");
    } else {
      saveSolveBtn.classList.add("hidden");
    }
  }
}

// ── RECAPTURE CROP HANDLER ────────────────────────────────────────────────────
function handleRetakeCrop() {
  if (serverTournamentState !== "ACTIVE") {
    alert("The contest has not been started by the host yet!");
    return;
  }
  resetPuzzleOnly();
  triggerFlash();
  playTone({ freq: 660, type: "square", gain: 0.14, attack: 0.001, decay: 0.08, duration: 0.1 });
  statusText.textContent = `${myPlayer.name || "Player"} — align face & SNAP`;
  updateGestureHUD();
}

function fitCanvasToWindow() {
  const stageEl = document.getElementById("stage");
  const vw = stageEl.clientWidth;
  const vh = stageEl.clientHeight;
  const videoAspect = canvas.width / (canvas.height || 1);
  const containerAspect = vw / (vh || 1);
  let cssWidth, cssHeight;
  if (containerAspect > videoAspect) {
    cssWidth = vw;
    cssHeight = vw / videoAspect;
  } else {
    cssHeight = vh;
    cssWidth = vh * videoAspect;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  fxCanvas.width = vw;
  fxCanvas.height = vh;
}

window.addEventListener("resize", fitCanvasToWindow);

async function initWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support getUserMedia camera access.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 720;
  fitCanvasToWindow();
}

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── MediaPipe Vision Models ───────────────────────────────────────────────────
let faceDetector = null;
let handLandmarker = null;

async function initFaceDetector(vision) {
  try {
    return await withTimeout(
      FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          delegate: "GPU",
        },
        runningMode: "video",
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      }),
      LOAD_TIMEOUT_MS,
      "Timed out loading FaceDetector model."
    );
  } catch (gpuErr) {
    console.warn("[EPIC Special Puzzle] GPU delegate failed for FaceDetector, retrying CPU…", gpuErr);
  }

  return await withTimeout(
    FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "CPU",
      },
      runningMode: "video",
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    }),
    LOAD_TIMEOUT_MS,
    "Timed out loading FaceDetector model on CPU."
  );
}

async function initHandLandmarker(vision) {
  try {
    return await withTimeout(
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "video",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      }),
      LOAD_TIMEOUT_MS,
      "Timed out loading HandLandmarker model."
    );
  } catch (gpuErr) {
    console.warn("[EPIC Special Puzzle] GPU delegate failed for HandLandmarker, retrying CPU…", gpuErr);
  }

  return await withTimeout(
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "video",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    }),
    LOAD_TIMEOUT_MS,
    "Timed out loading HandLandmarker model on CPU."
  );
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPinching(landmarks) {
  return dist2D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < PINCH_THRESHOLD;
}

function isFist(landmarks) {
  const wrist = landmarks[LM.WRIST];
  const pairs = [
    [LM.INDEX_TIP, LM.INDEX_MCP],
    [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
    [LM.RING_TIP, LM.RING_MCP],
    [LM.PINKY_TIP, LM.PINKY_MCP],
  ];
  let curled = 0;
  for (const [tipIdx, mcpIdx] of pairs) {
    if (dist2D(landmarks[tipIdx], wrist) < dist2D(landmarks[mcpIdx], wrist)) curled++;
  }
  return curled >= 4;
}

function computeFacePortraitFrame(detection) {
  const bb = detection.boundingBox;
  if (!bb) return null;

  const mirroredX = canvas.width - (bb.originX + bb.width);
  const faceY = bb.originY;
  const faceW = bb.width;
  const faceH = bb.height;

  const targetSize = Math.max(160, Math.min(canvas.height * 0.88, Math.max(faceW, faceH) * 1.55));
  const faceCenterX = mirroredX + faceW / 2;
  const faceCenterY = faceY + faceH / 2;

  const targetCenterX = faceCenterX;
  const targetCenterY = faceCenterY + faceH * 0.08;

  let x = targetCenterX - targetSize / 2;
  let y = targetCenterY - targetSize / 2;

  x = Math.max(8, Math.min(canvas.width - targetSize - 8, x));
  y = Math.max(8, Math.min(canvas.height - targetSize - 8, y));

  return {
    x,
    y,
    width: targetSize,
    height: targetSize,
    rawFace: { x: mirroredX, y: faceY, width: faceW, height: faceH },
    keypoints: detection.keypoints || [],
  };
}

function updateSmoothFaceBox(targetBox, lerpFactor = 0.22) {
  if (!smoothFaceBox.initialized) {
    smoothFaceBox.x = targetBox.x;
    smoothFaceBox.y = targetBox.y;
    smoothFaceBox.width = targetBox.width;
    smoothFaceBox.height = targetBox.height;
    smoothFaceBox.rawFace = targetBox.rawFace ? { ...targetBox.rawFace } : null;
    smoothFaceBox.initialized = true;
  } else {
    smoothFaceBox.x += (targetBox.x - smoothFaceBox.x) * lerpFactor;
    smoothFaceBox.y += (targetBox.y - smoothFaceBox.y) * lerpFactor;
    smoothFaceBox.width += (targetBox.width - smoothFaceBox.width) * lerpFactor;
    smoothFaceBox.height += (targetBox.height - smoothFaceBox.height) * lerpFactor;
    if (targetBox.rawFace) {
      if (!smoothFaceBox.rawFace) {
        smoothFaceBox.rawFace = { ...targetBox.rawFace };
      } else {
        smoothFaceBox.rawFace.x += (targetBox.rawFace.x - smoothFaceBox.rawFace.x) * lerpFactor;
        smoothFaceBox.rawFace.y += (targetBox.rawFace.y - smoothFaceBox.rawFace.y) * lerpFactor;
        smoothFaceBox.rawFace.width += (targetBox.rawFace.width - smoothFaceBox.rawFace.width) * lerpFactor;
        smoothFaceBox.rawFace.height += (targetBox.rawFace.height - smoothFaceBox.rawFace.height) * lerpFactor;
      }
    }
  }
  smoothFaceBox.keypoints = targetBox.keypoints || [];
  smoothFaceBox.detected = true;
  smoothFaceBox.lastSeenAt = performance.now();
}

function startCountdown(frameBox) {
  // STRICT CONTEST LOCK CHECK
  if (serverTournamentState !== "ACTIVE") {
    lobbyModal.classList.remove("hidden");
    statusText.textContent = "🔒 Contest locked — waiting for admin to start";
    return;
  }

  puzzle.boardBox = {
    x: Math.round(frameBox.x),
    y: Math.round(frameBox.y),
    width: Math.round(frameBox.width),
    height: Math.round(frameBox.height),
  };
  appState = "countdown";
  countdown.active = true;
  countdown.startedAt = performance.now();
  lastCountdownN = -1;
  updateGestureHUD();
}

function triggerManualSnap() {
  if (serverTournamentState !== "ACTIVE") {
    lobbyModal.classList.remove("hidden");
    statusText.textContent = "🔒 Contest locked — waiting for admin to start";
    return;
  }
  if (appState !== "tracking") return;

  let box = null;
  if (smoothFaceBox.detected && smoothFaceBox.initialized) {
    box = { ...smoothFaceBox };
  } else {
    const size = Math.min(canvas.width, canvas.height) * 0.65;
    box = {
      x: (canvas.width - size) / 2,
      y: (canvas.height - size) / 2,
      width: size,
      height: size,
    };
  }
  startCountdown(box);
}

function drawCountdownOverlay(box) {
  const elapsed = (performance.now() - countdown.startedAt) / 1000;
  const remaining = COUNTDOWN_SECONDS - elapsed;

  if (remaining <= 0) {
    finishCountdownAndCapture(box);
    return;
  }

  applyColorInsideBox(box);

  ctx.save();
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  const n = Math.ceil(remaining);
  if (n !== lastCountdownN) {
    lastCountdownN = n;
    soundCountdownBeep(n);
  }

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  ctx.fillStyle = "rgba(10,12,18,0.55)";
  ctx.fillRect(box.x, box.y, box.width, box.height);

  const radius = Math.max(30, Math.min(box.width, box.height) * 0.22);
  const frac = (COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = `bold ${Math.max(48, Math.min(box.width, box.height) * 0.35)}px 'Outfit', sans-serif`;
  ctx.fillStyle = "#f5c518";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), cx, cy);
  ctx.restore();
}

function finishCountdownAndCapture(box) {
  countdown.active = false;
  triggerFlash();
  soundSnap();

  const cropped = captureBoxToCanvas(box);
  const styledCanvas = applyPhotoboothProcessing(cropped);

  puzzle.fullPhotoboothCanvas = styledCanvas;
  myPlayer.photoCanvas = styledCanvas;

  initPuzzleBoard(styledCanvas, box);
  appState = "puzzle";
  puzzle.timerStartedAt = performance.now();
  updateProgressBadge();
  updateGestureHUD();
  statusText.textContent = `${myPlayer.name || "Player"} — solve your 3x3 face puzzle!`;
}

function captureBoxToCanvas(box) {
  const c = document.createElement("canvas");
  c.width = box.width;
  c.height = box.height;
  const cCtx = c.getContext("2d");
  cCtx.save();
  cCtx.translate(box.width, 0);
  cCtx.scale(-1, 1);
  cCtx.drawImage(
    videoEl,
    box.x * (videoEl.videoWidth / canvas.width),
    box.y * (videoEl.videoHeight / canvas.height),
    box.width * (videoEl.videoWidth / canvas.width),
    box.height * (videoEl.videoHeight / canvas.height),
    0,
    0,
    box.width,
    box.height
  );
  cCtx.restore();
  return c;
}

function applyPhotoboothProcessing(sourceCanvas) {
  const sc = document.createElement("canvas");
  sc.width = sourceCanvas.width;
  sc.height = sourceCanvas.height;
  const sCtx = sc.getContext("2d");
  sCtx.drawImage(sourceCanvas, 0, 0);

  const imgData = sCtx.getImageData(0, 0, sc.width, sc.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    r = PHOTOBOOTH_CONTRAST_ALPHA * (r - 128) + 128 + PHOTOBOOTH_BRIGHTNESS_BETA;
    g = PHOTOBOOTH_CONTRAST_ALPHA * (g - 128) + 128 + PHOTOBOOTH_BRIGHTNESS_BETA;
    b = PHOTOBOOTH_CONTRAST_ALPHA * (b - 128) + 128 + PHOTOBOOTH_BRIGHTNESS_BETA;

    const noise = (Math.random() - 0.5) * PHOTOBOOTH_NOISE_STD;
    r += noise; g += noise; b += noise;

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  sCtx.putImageData(imgData, 0, 0);
  applyVignette(sc);
  return sc;
}

function initPuzzleBoard(styledCanvas, box) {
  puzzle.boardBox = { ...box };
  puzzle.tileW = box.width / GRID;
  puzzle.tileH = box.height / GRID;
  puzzle.solved = false;

  const targetCoords = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      targetCoords.push({
        correctRow: row,
        correctCol: col,
        targetX: box.x + col * puzzle.tileW,
        targetY: box.y + row * puzzle.tileH,
      });
    }
  }

  let shuffled = [...targetCoords];
  do {
    shuffled.sort(() => Math.random() - 0.5);
  } while (shuffled.every((item, idx) => item.correctRow === targetCoords[idx].correctRow && item.correctCol === targetCoords[idx].correctCol));

  puzzle.pieces = shuffled.map((item, i) => {
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = puzzle.tileW;
    tileCanvas.height = puzzle.tileH;
    const tCtx = tileCanvas.getContext("2d");
    tCtx.drawImage(
      styledCanvas,
      item.correctCol * puzzle.tileW,
      item.correctRow * puzzle.tileH,
      puzzle.tileW,
      puzzle.tileH,
      0,
      0,
      puzzle.tileW,
      puzzle.tileH
    );

    const slotRow = Math.floor(i / GRID);
    const slotCol = i % GRID;
    const currentX = box.x + slotCol * puzzle.tileW;
    const currentY = box.y + slotRow * puzzle.tileH;

    return {
      id: i,
      canvas: tileCanvas,
      correctRow: item.correctRow,
      correctCol: item.correctCol,
      currentSlot: i,
      x: currentX,
      y: currentY,
      animating: false,
    };
  });

  checkPuzzleSolvedState();
}

function checkPuzzleSolvedState() {
  let placedCount = 0;
  puzzle.pieces.forEach((p) => {
    const slotRow = Math.floor(p.currentSlot / GRID);
    const slotCol = p.currentSlot % GRID;
    if (slotRow === p.correctRow && slotCol === p.correctCol) {
      placedCount++;
    }
  });

  const wasSolved = puzzle.solved;
  puzzle.solved = placedCount === GRID * GRID;

  if (puzzle.solved && !wasSolved) {
    puzzle.timerElapsed = (performance.now() - puzzle.timerStartedAt) / 1000;
    soundComplete();
    spawnConfetti(80);
    submitSolve(puzzle.timerElapsed);
  }

  updateProgressBadge(placedCount);
  updateGestureHUD();
}

function submitSolve(solveTime) {
  if (serverTournamentState !== "ACTIVE") return;
  sendWS({
    type: "PLAYER_SOLVED",
    solveTime,
  });
}

function updateProgressBadge(placedCount = 0) {
  if (appState === "puzzle") {
    progressBadge.classList.add("visible");
    if (puzzle.solved) {
      progressBadge.classList.add("solved");
      progressText.textContent = "9 / 9 (COMPLETE)";
    } else {
      progressBadge.classList.remove("solved");
      progressText.textContent = `${placedCount} / 9`;
    }
  } else {
    progressBadge.classList.remove("visible");
  }
}

// ── Air Gesture Dragging logic (MediaPipe Hand Tracking Only) ─────────────────
const drag = { activeHand: null, piece: null };

function getPieceUnderPoint(px, py) {
  const pad = 16;
  return puzzle.pieces.find((p) => px >= p.x - pad && px <= p.x + puzzle.tileW + pad && py >= p.y - pad && py <= p.y + puzzle.tileH + pad);
}

function swapPieces(p1, p2) {
  const tempSlot = p1.currentSlot;
  p1.currentSlot = p2.currentSlot;
  p2.currentSlot = tempSlot;

  const slot1Row = Math.floor(p1.currentSlot / GRID);
  const slot1Col = p1.currentSlot % GRID;
  const slot2Row = Math.floor(p2.currentSlot / GRID);
  const slot2Col = p2.currentSlot % GRID;

  p1.x = puzzle.boardBox.x + slot1Col * puzzle.tileW;
  p1.y = puzzle.boardBox.y + slot1Row * puzzle.tileH;
  p2.x = puzzle.boardBox.x + slot2Col * puzzle.tileW;
  p2.y = puzzle.boardBox.y + slot2Row * puzzle.tileH;

  playTone({ freq: 784, type: "sine", gain: 0.12, decay: 0.08, duration: 0.1 });
  checkPuzzleSolvedState();
}

function snapPieceToSlot(piece) {
  const cx = piece.x + puzzle.tileW / 2;
  const cy = piece.y + puzzle.tileH / 2;

  let targetSlot = piece.currentSlot;
  let minDist = Infinity;

  for (let i = 0; i < GRID * GRID; i++) {
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    const slotCx = puzzle.boardBox.x + c * puzzle.tileW + puzzle.tileW / 2;
    const slotCy = puzzle.boardBox.y + r * puzzle.tileH + puzzle.tileH / 2;
    const d = Math.hypot(cx - slotCx, cy - slotCy);
    if (d < minDist) {
      minDist = d;
      targetSlot = i;
    }
  }

  const otherPiece = puzzle.pieces.find((p) => p.id !== piece.id && p.currentSlot === targetSlot);
  if (otherPiece) {
    swapPieces(piece, otherPiece);
  } else {
    piece.currentSlot = targetSlot;
    const r = Math.floor(targetSlot / GRID);
    const c = targetSlot % GRID;
    piece.x = puzzle.boardBox.x + c * puzzle.tileW;
    piece.y = puzzle.boardBox.y + r * puzzle.tileH;
    checkPuzzleSolvedState();
  }
}

// ── Shatter Animation ─────────────────────────────────────────────────────────
let fistHoldCounter = 0;

function startShatter(styledCanvas, box) {
  shatter.active = true;
  shatter.startedAt = performance.now();
  shatter.fragments = [];

  const fragW = box.width / SHATTER_COLS;
  const fragH = box.height / SHATTER_ROWS;

  for (let r = 0; r < SHATTER_ROWS; r++) {
    for (let c = 0; c < SHATTER_COLS; c++) {
      const fc = document.createElement("canvas");
      fc.width = fragW;
      fc.height = fragH;
      const fCtx = fc.getContext("2d");
      fCtx.drawImage(styledCanvas, c * fragW, r * fragH, fragW, fragH, 0, 0, fragW, fragH);

      const angle = Math.atan2((r - SHATTER_ROWS / 2), (c - SHATTER_COLS / 2)) + (Math.random() - 0.5) * 0.5;
      const speed = Math.random() * 12 + 6;

      shatter.fragments.push({
        canvas: fc,
        x: box.x + c * fragW,
        y: box.y + r * fragH,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        rot: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 20,
        w: fragW,
        h: fragH,
      });
    }
  }

  soundShatter();
  appState = "shattering";
}

function updateAndDrawShatter() {
  const elapsed = performance.now() - shatter.startedAt;
  const progress = elapsed / SHATTER_DURATION_MS;

  if (progress >= 1) {
    shatter.active = false;
    soundSaved();
    statusText.textContent = `${myPlayer.name} — Solve Submitted! Check leaderboard`;
    return;
  }

  ctx.save();
  shatter.fragments.forEach((frag) => {
    frag.x += frag.vx;
    frag.y += frag.vy;
    frag.vy += 0.4;
    frag.rot += frag.vRot;

    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.translate(frag.x + frag.w / 2, frag.y + frag.h / 2);
    ctx.rotate((frag.rot * Math.PI) / 180);
    ctx.drawImage(frag.canvas, -frag.w / 2, -frag.h / 2);
    ctx.restore();
  });
  ctx.restore();
}

// ── Render & Detection Loop ───────────────────────────────────────────────────
function drawLiveFaceViewfinder(box, isLive = true) {
  ctx.save();
  ctx.strokeStyle = isLive ? "#10b981" : "#606d86";
  ctx.lineWidth = isLive ? 3 : 1.5;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  const bracket = Math.min(28, box.width * 0.15);
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 4;

  ctx.beginPath(); ctx.moveTo(box.x, box.y + bracket); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + bracket, box.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(box.x + box.width - bracket, box.y); ctx.lineTo(box.x + box.width, box.y); ctx.lineTo(box.x + box.width, box.y + bracket); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(box.x, box.y + box.height - bracket); ctx.lineTo(box.x, box.y + box.height); ctx.lineTo(box.x + bracket, box.y + box.height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(box.x + box.width - bracket, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height - bracket); ctx.stroke();

  if (isLive) {
    ctx.fillStyle = "rgba(16, 185, 129, 0.9)";
    ctx.fillRect(box.x, box.y - 30, 150, 24);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px 'Outfit', sans-serif";
    ctx.fillText("🟢 FACE DETECTED", box.x + 10, box.y - 14);
  }
  ctx.restore();
}

function applyColorInsideBox(box) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();

  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.restore();
}

function renderPuzzleBoard() {
  if (!puzzle.boardBox) return;

  ctx.save();
  ctx.fillStyle = "rgba(9, 12, 16, 0.85)";
  ctx.fillRect(puzzle.boardBox.x, puzzle.boardBox.y, puzzle.boardBox.width, puzzle.boardBox.height);

  ctx.strokeStyle = "rgba(245, 197, 24, 0.35)";
  ctx.lineWidth = 1;

  for (let r = 0; r <= GRID; r++) {
    const y = puzzle.boardBox.y + r * puzzle.tileH;
    ctx.beginPath(); ctx.moveTo(puzzle.boardBox.x, y); ctx.lineTo(puzzle.boardBox.x + puzzle.boardBox.width, y); ctx.stroke();
  }
  for (let c = 0; c <= GRID; c++) {
    const x = puzzle.boardBox.x + c * puzzle.tileW;
    ctx.beginPath(); ctx.moveTo(x, puzzle.boardBox.y); ctx.lineTo(x, puzzle.boardBox.y + puzzle.boardBox.height); ctx.stroke();
  }

  puzzle.pieces.forEach((p) => {
    ctx.save();
    ctx.drawImage(p.canvas, p.x, p.y, puzzle.tileW, puzzle.tileH);

    const slotRow = Math.floor(p.currentSlot / GRID);
    const slotCol = p.currentSlot % GRID;
    const isCorrect = slotRow === p.correctRow && slotCol === p.correctCol;

    ctx.strokeStyle = isCorrect ? "#10b981" : "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = isCorrect ? 3 : 1;
    ctx.strokeRect(p.x, p.y, puzzle.tileW, puzzle.tileH);
    ctx.restore();
  });

  if (puzzle.timerStartedAt && !puzzle.solved) {
    puzzle.timerElapsed = (performance.now() - puzzle.timerStartedAt) / 1000;
  }
  puzzleTimerText.textContent = formatTime(puzzle.timerElapsed);
  ctx.restore();
}

function processFrame(nowMs) {
  ctx.save();
  ctx.fillStyle = "#090c10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (serverTournamentState !== "ACTIVE") {
    ctx.restore();
    if (snapBtn) snapBtn.classList.add("hidden");
    return;
  }

  // Draw video feed
  if (videoEl.readyState >= 2) {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  let detections = [];
  let handsLandmarks = [];

  if (videoEl.readyState >= 2) {
    if (faceDetector && (appState === "tracking" || appState === "countdown")) {
      try {
        const res = faceDetector.detectForVideo(videoEl, nowMs);
        if (res?.detections) detections = res.detections;
      } catch (e) {}
    }
    if (handLandmarker && (appState === "tracking" || appState === "puzzle")) {
      try {
        const res = handLandmarker.detectForVideo(videoEl, nowMs);
        if (res?.landmarks) handsLandmarks = res.landmarks;
      } catch (e) {}
    }
  }

  // Update snapBtn visibility
  if (snapBtn) {
    if (appState === "tracking") {
      snapBtn.classList.remove("hidden");
    } else {
      snapBtn.classList.add("hidden");
    }
  }

  // ── TRACKING PHASE ──
  if (appState === "tracking") {
    if (detections.length > 0) {
      const primaryDetection = detections.reduce((best, cur) => {
        const areaBest = (best.boundingBox?.width || 0) * (best.boundingBox?.height || 0);
        const areaCur = (cur.boundingBox?.width || 0) * (cur.boundingBox?.height || 0);
        return areaCur > areaBest ? cur : best;
      }, detections[0]);

      const portraitFrame = computeFacePortraitFrame(primaryDetection);
      if (portraitFrame) {
        updateSmoothFaceBox(portraitFrame);
        drawLiveFaceViewfinder(smoothFaceBox, true);
        statusDot.className = "status-dot live";
        statusText.textContent = `${myPlayer.name || "Player"} — Face Detected! Click SNAP PHOTO`;
      }
    } else {
      const sinceLastSeen = nowMs - smoothFaceBox.lastSeenAt;
      if (smoothFaceBox.initialized && sinceLastSeen < 700) {
        drawLiveFaceViewfinder(smoothFaceBox, false);
      }
      statusDot.className = "status-dot live";
      statusText.textContent = `${myPlayer.name || "Player"} — Face camera to frame portrait`;
    }

    if (handsLandmarks.length >= 1) {
      handsLandmarks.forEach((lm) => drawHandSkeleton(ctx, lm, isPinching(lm)));
      const anyPinch = handsLandmarks.some((lm) => isPinching(lm));
      if (anyPinch && smoothFaceBox.initialized) {
        triggerManualSnap();
      }
    }
  }

  // ── COUNTDOWN PHASE ──
  else if (appState === "countdown") {
    if (smoothFaceBox.initialized) {
      drawCountdownOverlay(smoothFaceBox);
    } else if (puzzle.boardBox) {
      drawCountdownOverlay(puzzle.boardBox);
    }
  }

  // ── PUZZLE PHASE ──
  else if (appState === "puzzle") {
    applyColorInsideBox(puzzle.boardBox);
    renderPuzzleBoard();

    if (handsLandmarks.length >= 1) {
      handsLandmarks.forEach((lm) => {
        const indexPt = { x: (1 - lm[LM.INDEX_TIP].x) * canvas.width, y: lm[LM.INDEX_TIP].y * canvas.height };
        const pinching = isPinching(lm);

        // Draw finger skeleton
        drawHandSkeleton(ctx, lm, pinching);

        if (pinching && !drag.piece && !puzzle.solved) {
          const target = getPieceUnderPoint(indexPt.x, indexPt.y);
          if (target) {
            drag.piece = target;
          }
        }

        if (pinching && drag.piece && !puzzle.solved) {
          drag.piece.x = indexPt.x - puzzle.tileW / 2;
          drag.piece.y = indexPt.y - puzzle.tileH / 2;

          ctx.save();
          ctx.beginPath();
          ctx.arc(indexPt.x, indexPt.y, 14, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0, 229, 255, 0.9)";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        } else if (!pinching && drag.piece) {
          snapPieceToSlot(drag.piece);
          drag.piece = null;
        }

        if (puzzle.solved && isFist(lm)) {
          fistHoldCounter++;
          if (fistHoldCounter >= FIST_HOLD_FRAMES && puzzle.fullPhotoboothCanvas) {
            startShatter(puzzle.fullPhotoboothCanvas, puzzle.boardBox);
            fistHoldCounter = 0;
          }
        } else {
          fistHoldCounter = 0;
        }
      });
    }
  }

  // ── SHATTERING PHASE ──
  else if (appState === "shattering") {
    updateAndDrawShatter();
  }

  ctx.restore();
  updateAndDrawConfetti();
}

function renderLoop(nowMs) {
  processFrame(nowMs);
  requestAnimationFrame(renderLoop);
}



function resetLoaderUI() {
  if (loadingOverlay) loadingOverlay.classList.add("hidden");
  if (loaderText) {
    loaderText.style.color = "";
    loaderText.textContent = "Loading AI neural models…";
  }
  if (loaderRetry) loaderRetry.classList.add("hidden");
  if (errorBanner) errorBanner.style.display = "none";
}

function showLoaderError(msg) {
  if (loadingOverlay) loadingOverlay.classList.remove("hidden");
  if (loaderText) {
    loaderText.style.color = "var(--coral)";
    loaderText.textContent = msg;
  }
  if (loaderRetry) loaderRetry.classList.remove("hidden");
}

let cameraAndModelsReady = false;
let initializingModels = false;

async function ensureCameraAndModelsReady() {
  if (cameraAndModelsReady || initializingModels) return;
  initializingModels = true;
  if (loadingOverlay) loadingOverlay.classList.remove("hidden");
  if (loaderText) loaderText.textContent = "Loading camera & AI vision models…";

  try {
    if (!videoEl.srcObject) await initWebcam();
    const vision = await withTimeout(
      FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"),
      LOAD_TIMEOUT_MS,
      "Timed out loading MediaPipe WASM."
    );
    faceDetector = await initFaceDetector(vision);
    handLandmarker = await initHandLandmarker(vision);

    cameraAndModelsReady = true;
    initializingModels = false;
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
  } catch (err) {
    initializingModels = false;
    console.error("Camera/model load error:", err);
    showLoaderError("Camera access required for tournament. Enable access and click retry.");
  }
}

function boot() {
  resetLoaderUI();
  connectWebSocket();
  requestAnimationFrame(renderLoop);
  if (nameEntryModal) nameEntryModal.classList.remove("hidden");
}

// ── Event Listeners ───────────────────────────────────────────────────────────
if (loaderRetry) loaderRetry.addEventListener("click", () => ensureCameraAndModelsReady());

if (snapBtn) snapBtn.addEventListener("click", triggerManualSnap);

if (startGameBtn) {
  startGameBtn.addEventListener("click", () => {
    const val = playerNameInput.value.trim();
    if (!val) {
      alert("Please enter your name to join the tournament!");
      playerNameInput.focus();
      return;
    }
    myPlayer.name = val;
    if (lobbyPlayerName) lobbyPlayerName.textContent = val;
    nameEntryModal.classList.add("hidden");

    if (serverTournamentState !== "ACTIVE") {
      lobbyModal.classList.remove("hidden");
      statusDot.className = "status-dot";
      statusText.textContent = "🚀 Contest about to start — waiting for admin";
    } else {
      lobbyModal.classList.add("hidden");
      statusDot.className = "status-dot live";
      statusText.textContent = `${myPlayer.name} — Contest Live! Align face & SNAP`;
    }

    sendWS({ type: "PLAYER_JOIN", name: myPlayer.name });
    playTone({ freq: 523, type: "sine", gain: 0.15, duration: 0.2 });
  });
}

if (playerNameInput) {
  playerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startGameBtn.click();
  });
}

// Mobile Leaderboard Drawer Handlers
if (mobileLbToggleBtn) {
  mobileLbToggleBtn.addEventListener("click", () => {
    sidebarDrawer.classList.toggle("open");
  });
}
if (closeDrawerBtn) {
  closeDrawerBtn.addEventListener("click", () => {
    sidebarDrawer.classList.remove("open");
  });
}

if (solveResultViewLB) {
  solveResultViewLB.addEventListener("click", () => {
    solveResultModal.classList.add("hidden");
    sidebarDrawer.classList.add("open");
  });
}
if (solveResultClose) {
  solveResultClose.addEventListener("click", () => solveResultModal.classList.add("hidden"));
}

if (endedCloseBtn) {
  endedCloseBtn.addEventListener("click", () => endedModal.classList.add("hidden"));
}

if (retakeBtn) {
  retakeBtn.addEventListener("click", handleRetakeCrop);
}

if (saveSolveBtn) {
  saveSolveBtn.addEventListener("click", () => {
    if (puzzle.solved && puzzle.fullPhotoboothCanvas) {
      startShatter(puzzle.fullPhotoboothCanvas, puzzle.boardBox);
    }
  });
}

if (soundToggleBtn) {
  soundToggleBtn.addEventListener("click", () => {
    soundMuted = !soundMuted;
    soundIconOn.classList.toggle("hidden", soundMuted);
    soundIconOff.classList.toggle("hidden", !soundMuted);
    if (!soundMuted) {
      playTone({ freq: 880, gain: 0.1, duration: 0.1 });
    }
  });
}

if (helpBtn) {
  helpBtn.addEventListener("click", () => helpModal.classList.remove("hidden"));
}
if (helpModalClose) {
  helpModalClose.addEventListener("click", () => helpModal.classList.add("hidden"));
}
if (helpModalCloseIcon) {
  helpModalCloseIcon.addEventListener("click", () => helpModal.classList.add("hidden"));
}

window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "s" || e.key === "S") {
    if (appState === "tracking" && nameEntryModal.classList.contains("hidden") && lobbyModal.classList.contains("hidden")) {
      e.preventDefault();
      triggerManualSnap();
    }
  } else if (e.key === "r" || e.key === "R") {
    if (nameEntryModal.classList.contains("hidden") && lobbyModal.classList.contains("hidden")) {
      handleRetakeCrop();
    }
  } else if (e.key === "Escape") {
    sidebarDrawer.classList.remove("open");
    solveResultModal.classList.add("hidden");
    endedModal.classList.add("hidden");
    helpModal.classList.add("hidden");
  }
});

window.addEventListener("click", () => resumeAudio(), { once: true });
window.addEventListener("touchstart", () => resumeAudio(), { once: true });

boot();
