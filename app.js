import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ── Landmark constants ────────────────────────────────────────────────────────
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
const FRAME_PADDING = 28;
const FREEZE_HOLD_MS = 250;
const COUNTDOWN_SECONDS = 3;
const FIST_HOLD_FRAMES = 12;
const GRID = 3;
const LOAD_TIMEOUT_MS = 20000;
const SWAP_ANIM_MS = 180;

const PHOTOBOOTH_CONTRAST_ALPHA = 1.3;
const PHOTOBOOTH_BRIGHTNESS_BETA = 10;
const PHOTOBOOTH_NOISE_STD = 15;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

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

const turnIndicator = document.getElementById("turnIndicator");
const turnAvatar = document.getElementById("turnAvatar");
const turnText = document.getElementById("turnText");

const gestureIcon = document.getElementById("gestureIcon");
const gestureTitle = document.getElementById("gestureTitle");
const gestureHint = document.getElementById("gestureHint");
const saveSolveBtn = document.getElementById("saveSolveBtn");

const galleryStrip = document.getElementById("galleryStrip");
const galleryEmpty = document.getElementById("galleryEmpty");
const galleryCount = document.getElementById("galleryCount");
const downloadStripBtn = document.getElementById("downloadStripBtn");
const downloadVideoBtn = document.getElementById("downloadVideoBtn");
const resetAllBtn = document.getElementById("resetAllBtn");
const stripCompleteMsg = document.getElementById("stripCompleteMsg");
const recIndicator = document.getElementById("recIndicator");
const flashOverlay = document.getElementById("flashOverlay");

const retakeBtn = document.getElementById("retakeBtn");
const soundToggleBtn = document.getElementById("soundToggleBtn");
const soundIconOn = document.getElementById("soundIconOn");
const soundIconOff = document.getElementById("soundIconOff");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const helpBtn = document.getElementById("helpBtn");

const stripModal = document.getElementById("stripModal");
const stripPreviewCanvas = document.getElementById("stripPreviewCanvas");
const stripModalDownload = document.getElementById("stripModalDownload");
const stripModalClose = document.getElementById("stripModalClose");
const stripModalCloseIcon = document.getElementById("stripModalCloseIcon");

const nameEntryModal = document.getElementById("nameEntryModal");
const startGameBtn = document.getElementById("startGameBtn");

const leaderboardModal = document.getElementById("leaderboardModal");
const leaderboardEntries = document.getElementById("leaderboardEntries");
const leaderboardWinner = document.getElementById("leaderboardWinner");
const leaderboardSubtitle = document.getElementById("leaderboardSubtitle");
const playAgainBtn = document.getElementById("playAgainBtn");
const viewStripBtn = document.getElementById("viewStripBtn");

const helpModal = document.getElementById("helpModal");
const helpModalClose = document.getElementById("helpModalClose");
const helpModalCloseIcon = document.getElementById("helpModalCloseIcon");

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

// ── Video recorder ────────────────────────────────────────────────────────────
const recorder = {
  instance: null,
  chunks: [],
  blob: null,
};

function startRecording() {
  recorder.chunks = [];
  recorder.blob = null;
  downloadVideoBtn.disabled = true;
  try {
    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    recorder.instance = new MediaRecorder(stream, { mimeType });
    recorder.instance.ondataavailable = (e) => {
      if (e.data.size > 0) recorder.chunks.push(e.data);
    };
    recorder.instance.onstop = () => {
      recorder.blob = new Blob(recorder.chunks, { type: "video/webm" });
      downloadVideoBtn.disabled = false;
      recIndicator.classList.add("hidden");
    };
    recorder.instance.start();
    recIndicator.classList.remove("hidden");
  } catch (err) {
    console.warn("[EPIC Special Puzzle] MediaRecorder start warning:", err);
  }
}

function stopRecording() {
  if (recorder.instance && recorder.instance.state !== "inactive") {
    try {
      recorder.instance.stop();
    } catch (e) {}
  }
}

function downloadVideo() {
  if (!recorder.blob) return;
  const url = URL.createObjectURL(recorder.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `epic_puzzle_solve_${Date.now()}.webm`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── App state ─────────────────────────────────────────────────────────────────
let appState = "tracking"; // 'tracking' | 'countdown' | 'puzzle' | 'shattering'
let gamePhase = "names"; // 'names' | 'playing' | 'results'

const players = [
  { name: "Player 1", time: null, photo: null },
  { name: "Player 2", time: null, photo: null },
  { name: "Player 3", time: null, photo: null },
];
let currentPlayerIndex = 0;

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

const SHATTER_COLS = 6;
const SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 850;
const shatter = {
  active: false,
  startedAt: 0,
  fragments: [],
  pendingCanvas: null,
};

const STRIP_MAX_PHOTOS = 3;
const galleryEntries = [];

function addToGallery(snapshotCanvas) {
  if (galleryEntries.length >= STRIP_MAX_PHOTOS) return;
  galleryEntries.push({
    canvas: snapshotCanvas,
    time: Date.now(),
    playerName: players[currentPlayerIndex]?.name || `Player ${currentPlayerIndex + 1}`,
    playerTime: players[currentPlayerIndex]?.time || 0,
  });
  renderGalleryThumb(snapshotCanvas, galleryEntries.length, players[currentPlayerIndex]?.name);
  galleryCount.textContent = `${galleryEntries.length} / ${STRIP_MAX_PHOTOS}`;
  if (galleryEmpty) galleryEmpty.style.display = "none";
  if (galleryEntries.length >= STRIP_MAX_PHOTOS) showStripComplete();
  players[currentPlayerIndex].photo = snapshotCanvas;
}

function isStripFull() {
  return galleryEntries.length >= STRIP_MAX_PHOTOS;
}

function showStripComplete() {
  if (stripCompleteMsg) stripCompleteMsg.classList.add("visible");
  updateStripDownloadAvailability();
  spawnConfetti(120);
  setTimeout(() => showStripModal(), 1000);
}

function hideStripComplete() {
  if (stripCompleteMsg) stripCompleteMsg.classList.remove("visible");
}

function updateStripDownloadAvailability() {
  if (!downloadStripBtn) return;
  downloadStripBtn.disabled = galleryEntries.length === 0;
}

const STRIP_FILE_BORDER = 28;
const STRIP_FILE_GAP = 20;

function buildStripCanvas() {
  if (galleryEntries.length === 0) return null;
  const polaroids = galleryEntries.map((entry, i) =>
    makePolaroid(entry.canvas, i + 1, entry.playerName, entry.playerTime)
  );
  const totalW = polaroids[0].width + STRIP_FILE_BORDER * 2;
  const totalH =
    STRIP_FILE_BORDER * 2 +
    polaroids.reduce((sum, p) => sum + p.height, 0) +
    STRIP_FILE_GAP * (polaroids.length - 1) +
    40;

  const sc = document.createElement("canvas");
  sc.width = totalW;
  sc.height = totalH;
  const sCtx = sc.getContext("2d");

  // Vintage cream photobooth card
  sCtx.fillStyle = "#fcfaf6";
  sCtx.fillRect(0, 0, totalW, totalH);

  // Subtle border outline
  sCtx.strokeStyle = "#e2ded4";
  sCtx.lineWidth = 2;
  sCtx.strokeRect(4, 4, totalW - 8, totalH - 8);

  let cursorY = STRIP_FILE_BORDER;
  polaroids.forEach((p) => {
    sCtx.drawImage(p, STRIP_FILE_BORDER, cursorY);
    cursorY += p.height + STRIP_FILE_GAP;
  });

  // Footer stamp
  sCtx.fillStyle = "#9a9486";
  sCtx.font = "bold 11px 'IBM Plex Mono', monospace";
  sCtx.textAlign = "center";
  sCtx.fillText("★ EPIC SPECIAL PHOTOBOOTH STRIP ★", totalW / 2, totalH - 18);

  return sc;
}

function downloadPhotoStrip() {
  const sc = buildStripCanvas();
  if (!sc) return;
  sc.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `epic_special_photostrip_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

function showStripModal() {
  const sc = buildStripCanvas();
  if (!sc) return;
  stripPreviewCanvas.width = sc.width;
  stripPreviewCanvas.height = sc.height;
  stripPreviewCanvas.getContext("2d").drawImage(sc, 0, 0);
  stripModal.classList.remove("hidden");
}

function resetEverything() {
  galleryEntries.length = 0;
  galleryStrip.innerHTML = "";
  galleryCount.textContent = `0 / ${STRIP_MAX_PHOTOS}`;
  if (galleryEmpty) {
    galleryEmpty.style.display = "flex";
    galleryStrip.appendChild(galleryEmpty);
  }
  hideStripComplete();
  updateStripDownloadAvailability();
  resetPuzzleOnly();
  gamePhase = "names";
  currentPlayerIndex = 0;
  turnIndicator.classList.add("hidden");
  players.forEach((p) => {
    p.time = null;
    p.photo = null;
  });
  hideLeaderboard();
  statusText.textContent = "enter player names to begin";
  nameEntryModal.classList.remove("hidden");
}

function makePolaroid(snapshotCanvas, index, playerName = "Player", solveTime = 0) {
  const BORDER = 12;
  const BOTTOM = 44;
  const THUMB_W = 220;
  const scale = THUMB_W / snapshotCanvas.width;
  const imgH = Math.round(snapshotCanvas.height * scale);

  const pc = document.createElement("canvas");
  pc.width = THUMB_W + BORDER * 2;
  pc.height = imgH + BORDER + BOTTOM;
  const pCtx = pc.getContext("2d");

  // Polaroid white frame
  pCtx.fillStyle = "#ffffff";
  pCtx.fillRect(0, 0, pc.width, pc.height);

  // Polaroid stroke
  pCtx.strokeStyle = "#e8e5dc";
  pCtx.lineWidth = 1;
  pCtx.strokeRect(0, 0, pc.width, pc.height);

  // Photo
  pCtx.drawImage(snapshotCanvas, BORDER, BORDER, THUMB_W, imgH);

  // Player Name & Solve Time Stamp
  pCtx.fillStyle = "#1c1a16";
  pCtx.font = "bold 11px 'Plus Jakarta Sans', sans-serif";
  pCtx.textAlign = "left";
  pCtx.fillText(`${playerName}`, BORDER + 2, imgH + BORDER + 18);

  pCtx.fillStyle = "#f5c518";
  pCtx.font = "bold 10px 'IBM Plex Mono', monospace";
  pCtx.textAlign = "right";
  pCtx.fillText(solveTime ? formatTime(solveTime) : `#${index}`, pc.width - BORDER - 2, imgH + BORDER + 18);

  // Timestamp subtext
  pCtx.fillStyle = "#8a857a";
  pCtx.font = "9px 'IBM Plex Mono', monospace";
  pCtx.textAlign = "left";
  const now = new Date();
  const ts = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()} PHOTO #${String(index).padStart(2, "0")}`;
  pCtx.fillText(ts, BORDER + 2, imgH + BORDER + 32);

  return pc;
}

function renderGalleryThumb(snapshotCanvas, index, playerName) {
  const print = document.createElement("div");
  print.className = "print";
  const pc = makePolaroid(snapshotCanvas, index, playerName, players[currentPlayerIndex]?.time);
  pc.style.width = "100%";
  print.appendChild(pc);
  galleryStrip.insertBefore(print, galleryStrip.firstChild);
}

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
  lastSeenFrame.box = null;
  lastSeenFrame.at = 0;
  lastCountdownN = -1;
  freezeGate.holding = false;
  saveSolveBtn.classList.add("hidden");
  stopRecording();
  recIndicator.classList.add("hidden");
  updateProgressBadge();
  updateGestureHUD();
}

function updateTurnIndicator() {
  if (gamePhase === "playing") {
    turnIndicator.classList.remove("hidden");
    const p = players[currentPlayerIndex];
    turnText.textContent = p?.name || `Player ${currentPlayerIndex + 1}`;
    turnAvatar.textContent = `P${currentPlayerIndex + 1}`;
  } else {
    turnIndicator.classList.add("hidden");
  }
}

function advanceToNextPlayer() {
  currentPlayerIndex++;
  if (currentPlayerIndex >= players.length) {
    gamePhase = "results";
    turnIndicator.classList.add("hidden");
    showLeaderboard();
    return;
  }
  updateTurnIndicator();
  statusText.textContent = `${players[currentPlayerIndex].name} — frame your photo`;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 10) % 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
}

function showLeaderboard() {
  const sorted = [...players].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  leaderboardEntries.innerHTML = "";
  const medals = ["gold", "silver", "bronze"];
  sorted.forEach((p, i) => {
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
    time.textContent = p.time != null ? formatTime(p.time) : "DNF";
    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(time);
    leaderboardEntries.appendChild(row);
  });
  const winner = sorted[0];
  leaderboardSubtitle.textContent = `All ${players.length} players completed the challenge!`;
  leaderboardWinner.textContent =
    winner && winner.time != null
      ? `👑 ${winner.name} won 1st Place with ${formatTime(winner.time)}!`
      : "Challenge Finished";
  leaderboardModal.classList.remove("hidden");
  spawnConfetti(100);
}

function hideLeaderboard() {
  leaderboardModal.classList.add("hidden");
}

function updateGestureHUD() {
  if (appState === "tracking") {
    gestureIcon.textContent = "✌️";
    gestureTitle.textContent = "FRAME & PINCH";
    gestureHint.textContent = "Extend index fingers to frame & pinch both hands to snap";
    saveSolveBtn.classList.add("hidden");
  } else if (appState === "countdown") {
    gestureIcon.textContent = "⏱️";
    gestureTitle.textContent = "HOLD STILL";
    gestureHint.textContent = "Capturing photo booth frame in 3 seconds…";
    saveSolveBtn.classList.add("hidden");
  } else if (appState === "puzzle") {
    if (puzzle.solved) {
      gestureIcon.textContent = "✊";
      gestureTitle.textContent = "SOLVED! MAKE FIST TO SAVE";
      gestureHint.textContent = "Hold a closed fist for 1s or click SAVE button";
      saveSolveBtn.classList.remove("hidden");
    } else {
      gestureIcon.textContent = "🤏";
      gestureTitle.textContent = "SOLVE PUZZLE";
      gestureHint.textContent = "Pinch or drag pieces into correct slots";
      saveSolveBtn.classList.add("hidden");
    }
  }
}

// ── RECAPTURE CROP HANDLER ────────────────────────────────────────────────────
function handleRetakeCrop() {
  resetPuzzleOnly();
  lastSeenFrame.box = null;
  lastSeenFrame.at = 0;
  triggerFlash();
  playTone({ freq: 660, type: "square", gain: 0.14, attack: 0.001, decay: 0.08, duration: 0.1 });
  const pName = players[currentPlayerIndex]?.name || "Player";
  statusText.textContent = gamePhase === "playing" ? `${pName} — frame your photo again` : "frame your photo again";
  updateGestureHUD();
}

function startNewGame() {
  players.forEach((p) => {
    p.time = null;
    p.photo = null;
  });
  currentPlayerIndex = 0;
  gamePhase = "playing";
  galleryEntries.length = 0;
  galleryStrip.innerHTML = "";
  galleryCount.textContent = `0 / ${STRIP_MAX_PHOTOS}`;
  if (galleryEmpty) {
    galleryEmpty.style.display = "flex";
    galleryStrip.appendChild(galleryEmpty);
  }
  hideStripComplete();
  updateStripDownloadAvailability();
  hideLeaderboard();
  resetPuzzleOnly();
  updateTurnIndicator();
  statusText.textContent = `${players[0].name} — frame your photo`;
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

async function initHandLandmarker() {
  const vision = await withTimeout(
    FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"),
    LOAD_TIMEOUT_MS,
    "Timed out loading MediaPipe WASM runtime. Check your internet connection."
  );

  try {
    const handLandmarker = await withTimeout(
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
      "Timed out downloading HandLandmarker model with GPU."
    );
    return handLandmarker;
  } catch (gpuErr) {
    console.warn("[EPIC Special Puzzle] GPU delegate failed, retrying with CPU…", gpuErr);
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
    "Timed out downloading HandLandmarker model with CPU."
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

function toPixel(landmarkNorm) {
  return { x: landmarkNorm.x * canvas.width, y: landmarkNorm.y * canvas.height };
}

function mirrorLandmarkX(landmark) {
  return { x: 1 - landmark.x, y: landmark.y };
}

function computeHandFrame(indexTipA, indexTipB) {
  const a = toPixel(indexTipA);
  const b = toPixel(indexTipB);
  const minX = Math.min(a.x, b.x) - FRAME_PADDING;
  const maxX = Math.max(a.x, b.x) + FRAME_PADDING;
  const minY = Math.min(a.y, b.y) - FRAME_PADDING;
  const maxY = Math.max(a.y, b.y) + FRAME_PADDING;
  const x = Math.max(0, minX);
  const y = Math.max(0, minY);
  const width = Math.min(canvas.width, maxX) - x;
  const height = Math.min(canvas.height, maxY) - y;
  return { x, y, width, height };
}

const freezeGate = { holding: false, since: 0 };
const FRAME_GRACE_MS = 450;
const lastSeenFrame = { box: null, at: 0 };
const countdown = { active: false, startedAt: 0 };
let lastCountdownN = -1;

function startCountdown(frameBox) {
  puzzle.boardBox = { ...frameBox };
  appState = "countdown";
  countdown.active = true;
  countdown.startedAt = performance.now();
  lastCountdownN = -1;
  updateGestureHUD();
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

  // Circular progress ring around countdown number
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
  ctx.shadowColor = "rgba(245,197,24,0.8)";
  ctx.shadowBlur = 16;
  ctx.fillText(String(n), cx, cy);
  ctx.restore();

  statusText.textContent = `${players[currentPlayerIndex]?.name || "Player"} — capturing in ${n}…`;
}

function gaussianNoise(std) {
  const u1 = Math.random() || 1e-6;
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * std;
}

function applyPhotoboothEffect(imageData, bw = false) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const noise = gaussianNoise(PHOTOBOOTH_NOISE_STD);
    if (bw) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, gray * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA + noise));
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      d[i] = Math.max(0, Math.min(255, d[i] * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA + noise));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA + noise));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA + noise));
    }
  }
  return imageData;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function finishCountdownAndCapture(box) {
  countdown.active = false;

  const mirroredFrame = document.createElement("canvas");
  mirroredFrame.width = canvas.width;
  mirroredFrame.height = canvas.height;
  const mirroredCtx = mirroredFrame.getContext("2d");
  mirroredCtx.save();
  mirroredCtx.translate(mirroredFrame.width, 0);
  mirroredCtx.scale(-1, 1);
  mirroredCtx.drawImage(videoEl, 0, 0, mirroredFrame.width, mirroredFrame.height);
  mirroredCtx.restore();

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.round(box.width));
  cropCanvas.height = Math.max(1, Math.round(box.height));
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(mirroredFrame, box.x, box.y, box.width, box.height, 0, 0, cropCanvas.width, cropCanvas.height);

  triggerFlash();

  // Color version for polaroid
  const colorImageData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  applyPhotoboothEffect(colorImageData, false);
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = cropCanvas.width;
  colorCanvas.height = cropCanvas.height;
  colorCanvas.getContext("2d").putImageData(colorImageData, 0, 0);
  applyVignette(colorCanvas);

  // B&W version for puzzle solving
  const bwImageData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  applyPhotoboothEffect(bwImageData, true);
  cropCtx.putImageData(bwImageData, 0, 0);
  applyVignette(cropCanvas);

  puzzle.fullPhotoboothCanvas = colorCanvas;

  const tileW = Math.floor(cropCanvas.width / GRID);
  const tileH = Math.floor(cropCanvas.height / GRID);
  const pieces = [];

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const sx = col * tileW;
      const sy = row * tileH;
      const w = col === GRID - 1 ? cropCanvas.width - sx : tileW;
      const h = row === GRID - 1 ? cropCanvas.height - sy : tileH;
      const pieceCanvas = document.createElement("canvas");
      pieceCanvas.width = w;
      pieceCanvas.height = h;
      pieceCanvas.getContext("2d").drawImage(cropCanvas, sx, sy, w, h, 0, 0, w, h);
      pieces.push({
        id: row * GRID + col,
        row,
        col,
        currentGridRow: row,
        currentGridCol: col,
        canvas: pieceCanvas,
        w,
        h,
        x: box.x + col * tileW,
        y: box.y + row * tileH,
        placed: false,
        dragging: false,
        animating: false,
      });
    }
  }

  // Generate a valid shuffle where pieces are NOT in their solved positions
  let slotIndices = Array.from({ length: GRID * GRID }, (_, i) => i);
  let attempts = 0;
  do {
    slotIndices = shuffle([...slotIndices]);
    attempts++;
  } while (
    attempts < 30 &&
    slotIndices.filter((slotIdx, i) => slotIdx === i).length > 2
  );

  pieces.forEach((piece, i) => {
    const slotIdx = slotIndices[i];
    const targetRow = Math.floor(slotIdx / GRID);
    const targetCol = slotIdx % GRID;
    piece.currentGridRow = targetRow;
    piece.currentGridCol = targetCol;
    piece.x = box.x + targetCol * tileW;
    piece.y = box.y + targetRow * tileH;
    piece.placed = piece.currentGridRow === piece.row && piece.currentGridCol === piece.col;
  });

  puzzle.boardBox = box;
  puzzle.pieces = pieces;
  puzzle.tileW = tileW;
  puzzle.tileH = tileH;
  puzzle.solved = checkPuzzleSolved();
  puzzle.timerStartedAt = performance.now();
  puzzle.timerElapsed = 0;
  appState = "puzzle";
  fistHoldCounter = 0;

  updateProgressBadge();
  updateGestureHUD();
  playTone({ freq: 220, type: "sine", gain: 0.15, attack: 0.001, decay: 0.08, duration: 0.1 });
  startRecording();
}

// ── Strict Puzzle Validation & Swapping Mechanics ─────────────────────────────
const drag = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };
const pointerDrag = { active: false, piece: null, offsetX: 0, offsetY: 0 };

function checkPuzzleSolved() {
  if (!puzzle.pieces || puzzle.pieces.length !== GRID * GRID) return false;
  // Strict rule: No piece is dragging or animating, and EVERY piece must be in its home slot
  const anyDragging = puzzle.pieces.some((p) => p.dragging);
  const anyAnimating = puzzle.pieces.some((p) => p.animating);
  if (anyDragging || anyAnimating) return false;

  return puzzle.pieces.every(
    (p) => p.currentGridRow === p.row && p.currentGridCol === p.col
  );
}

function animatePieceToSlot(piece, targetX, targetY) {
  const startX = piece.x;
  const startY = piece.y;
  const startedAt = performance.now();
  piece.animating = true;

  function step() {
    const elapsed = performance.now() - startedAt;
    const t = Math.min(1, elapsed / SWAP_ANIM_MS);
    const eased = 1 - Math.pow(1 - t, 3); // Smooth cubic ease-out
    piece.x = startX + (targetX - startX) * eased;
    piece.y = startY + (targetY - startY) * eased;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      piece.x = targetX;
      piece.y = targetY;
      piece.animating = false;
      piece.placed = piece.currentGridRow === piece.row && piece.currentGridCol === piece.col;
      const wasSolved = puzzle.solved;
      puzzle.solved = checkPuzzleSolved();
      if (!wasSolved && puzzle.solved) {
        soundComplete();
        spawnConfetti(60);
      }
      updateProgressBadge();
      updateGestureHUD();
    }
  }
  requestAnimationFrame(step);
}

function dropPieceAtPosition(piece) {
  const box = puzzle.boardBox;
  if (!box) return;

  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;
  const targetCol = Math.min(GRID - 1, Math.max(0, Math.floor((cx - box.x) / puzzle.tileW)));
  const targetRow = Math.min(GRID - 1, Math.max(0, Math.floor((cy - box.y) / puzzle.tileH)));

  const sourceRow = piece.currentGridRow;
  const sourceCol = piece.currentGridCol;

  if (targetRow === sourceRow && targetCol === sourceCol) {
    // Snapped back to original slot
    piece.x = box.x + sourceCol * puzzle.tileW;
    piece.y = box.y + sourceRow * puzzle.tileH;
    piece.placed = piece.currentGridRow === piece.row && piece.currentGridCol === piece.col;
  } else {
    // Find occupant in target slot to swap with
    const otherPiece = puzzle.pieces.find(
      (p) => p !== piece && p.currentGridRow === targetRow && p.currentGridCol === targetCol
    );

    if (otherPiece) {
      // Clean 2-way swap
      otherPiece.currentGridRow = sourceRow;
      otherPiece.currentGridCol = sourceCol;
      animatePieceToSlot(
        otherPiece,
        box.x + sourceCol * puzzle.tileW,
        box.y + sourceRow * puzzle.tileH
      );
    }

    piece.currentGridRow = targetRow;
    piece.currentGridCol = targetCol;
    piece.x = box.x + targetCol * puzzle.tileW;
    piece.y = box.y + targetRow * puzzle.tileH;
    piece.placed = piece.currentGridRow === piece.row && piece.currentGridCol === piece.col;
  }

  // Update all placed statuses
  puzzle.pieces.forEach((p) => {
    p.placed = p.currentGridRow === p.row && p.currentGridCol === p.col;
  });

  const wasSolved = puzzle.solved;
  puzzle.solved = checkPuzzleSolved();

  if (piece.placed) soundSnap();
  if (!wasSolved && puzzle.solved) {
    soundComplete();
    spawnConfetti(60);
  }
  updateProgressBadge();
  updateGestureHUD();
}

function findNearestPiece(px, py) {
  let best = null;
  let bestDist = Infinity;
  for (const piece of puzzle.pieces) {
    if (piece.animating) continue;
    const cx = piece.x + piece.w / 2;
    const cy = piece.y + piece.h / 2;
    const d = Math.hypot(px - cx, py - cy);
    if (d < Math.max(piece.w, piece.h) * 0.85 && d < bestDist) {
      best = piece;
      bestDist = d;
    }
  }
  return best;
}

function handleDragForHand(handLabel, pinching, indexPx) {
  if (pinching) {
    if (drag.activeHand === null) {
      const candidate = findNearestPiece(indexPx.x, indexPx.y);
      if (candidate) {
        drag.activeHand = handLabel;
        drag.piece = candidate;
        drag.offsetX = indexPx.x - candidate.x;
        drag.offsetY = indexPx.y - candidate.y;
        candidate.dragging = true;
        candidate.placed = false;
      }
    } else if (drag.activeHand === handLabel && drag.piece) {
      drag.piece.x = indexPx.x - drag.offsetX;
      drag.piece.y = indexPx.y - drag.offsetY;
    }
  } else {
    if (drag.activeHand === handLabel && drag.piece) {
      const piece = drag.piece;
      piece.dragging = false;
      drag.activeHand = null;
      drag.piece = null;
      dropPieceAtPosition(piece);
    }
  }
}

// ── Mouse / Touch Pointer Fallback for Dragging Pieces ────────────────────────
function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  if (appState !== "puzzle" || !puzzle.boardBox) return;
  const pt = getCanvasPoint(e);
  const candidate = findNearestPiece(pt.x, pt.y);
  if (candidate) {
    pointerDrag.active = true;
    pointerDrag.piece = candidate;
    pointerDrag.offsetX = pt.x - candidate.x;
    pointerDrag.offsetY = pt.y - candidate.y;
    candidate.dragging = true;
    candidate.placed = false;
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointerDrag.active || !pointerDrag.piece) return;
  const pt = getCanvasPoint(e);
  pointerDrag.piece.x = pt.x - pointerDrag.offsetX;
  pointerDrag.piece.y = pt.y - pointerDrag.offsetY;
});

function endPointerDrag(e) {
  if (!pointerDrag.active || !pointerDrag.piece) return;
  const piece = pointerDrag.piece;
  piece.dragging = false;
  pointerDrag.active = false;
  pointerDrag.piece = null;
  dropPieceAtPosition(piece);
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (err) {}
}

canvas.addEventListener("pointerup", endPointerDrag);
canvas.addEventListener("pointercancel", endPointerDrag);

function drawBoardAndPieces() {
  const box = puzzle.boardBox;
  if (!box) return;

  // Board background
  ctx.save();
  ctx.fillStyle = "#0c0e14";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.restore();

  // Grid guidelines
  ctx.save();
  ctx.strokeStyle = "rgba(245, 197, 24, 0.2)";
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(box.x + i * puzzle.tileW, box.y);
    ctx.lineTo(box.x + i * puzzle.tileW, box.y + box.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + i * puzzle.tileH);
    ctx.lineTo(box.x + box.width, box.y + i * puzzle.tileH);
    ctx.stroke();
  }
  ctx.restore();

  // Draw pieces (dragging pieces on top)
  const sorted = [...puzzle.pieces].sort((a, b) => (a.dragging ? 1 : 0) - (b.dragging ? 1 : 0));
  for (const piece of sorted) {
    ctx.save();
    if (piece.dragging) {
      ctx.shadowColor = "rgba(245, 197, 24, 0.95)";
      ctx.shadowBlur = 20;
    }
    ctx.drawImage(piece.canvas, piece.x, piece.y, piece.w, piece.h);

    // Green border ONLY when correctly placed in home slot
    const isCorrect = piece.currentGridRow === piece.row && piece.currentGridCol === piece.col && !piece.dragging;
    ctx.strokeStyle = piece.dragging
      ? "#f5c518"
      : isCorrect
      ? "#10b981"
      : "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = piece.dragging ? 3.5 : isCorrect ? 2.5 : 1.5;
    ctx.strokeRect(piece.x, piece.y, piece.w, piece.h);
    ctx.restore();
  }

  // Board outer frame
  ctx.save();
  ctx.strokeStyle = puzzle.solved ? "#10b981" : "#f5c518";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();

  // Solved victory overlay on board
  if (puzzle.solved) {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.font = `bold ${Math.max(22, box.width * 0.08)}px 'Outfit', sans-serif`;
    ctx.fillStyle = "#10b981";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(16, 185, 129, 0.8)";
    ctx.shadowBlur = 14;
    const pname = players[currentPlayerIndex]?.name || "Player";
    ctx.fillText(`${pname} — SOLVED!`, box.x + box.width / 2, box.y + box.height / 2 - box.height * 0.05);

    ctx.font = `bold ${Math.max(13, box.width * 0.04)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = "#fff";
    ctx.fillText(`Time: ${formatTime(puzzle.timerElapsed)}`, box.x + box.width / 2, box.y + box.height / 2 + box.height * 0.05);

    ctx.font = `bold ${Math.max(11, box.width * 0.032)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("HOLD FIST ✊ TO SAVE", box.x + box.width / 2, box.y + box.height / 2 + box.height * 0.12);
    ctx.restore();
  }

  if (!puzzle.solved && puzzle.timerStartedAt) {
    puzzle.timerElapsed = (performance.now() - puzzle.timerStartedAt) / 1000;
  }
  puzzleTimerText.textContent = formatTime(puzzle.timerElapsed);
}

function updateProgressBadge() {
  if (appState !== "puzzle" || !puzzle.pieces || puzzle.pieces.length === 0) {
    progressBadge.classList.remove("visible", "solved");
    return;
  }
  const placedCount = puzzle.pieces.filter(
    (p) => p.currentGridRow === p.row && p.currentGridCol === p.col
  ).length;
  progressText.textContent = `${placedCount} / ${puzzle.pieces.length}`;
  progressBadge.classList.add("visible");
  progressBadge.classList.toggle("solved", puzzle.solved);
}

function drawVideoFrame() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function applyColorInsideBox(box) {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.min(canvas.width - x, Math.round(box.width));
  const h = Math.min(canvas.height - y, Math.round(box.height));
  if (w <= 0 || h <= 0) return;
  const region = ctx.getImageData(x, y, w, h);
  applyPhotoboothEffect(region);
  ctx.putImageData(region, x, y);
}

function drawLiveFrameOverlay(box) {
  ctx.save();
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.setLineDash([]);

  // Corner brackets
  const cornerLen = 22;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#f5c518";
  ctx.shadowColor = "rgba(245,197,24,0.7)";
  ctx.shadowBlur = 10;
  const corners = [
    [box.x, box.y, 1, 1],
    [box.x + box.width, box.y, -1, 1],
    [box.x, box.y + box.height, 1, -1],
    [box.x + box.width, box.y + box.height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + cornerLen * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + cornerLen * dx, cy);
    ctx.stroke();
  }

  // Dimension tag
  ctx.font = "bold 10px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#f5c518";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(box.width)} × ${Math.round(box.height)}px`, box.x + 4, box.y - 6);
  ctx.restore();
}

function isPointInBoard(px, py, box) {
  if (!box) return false;
  return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
}

function drawHandSkeleton(landmarksPx) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 229, 255, 0.85)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(0, 229, 255, 0.9)";
  ctx.lineWidth = 2.5;
  for (const [iA, iB] of HAND_CONNECTIONS) {
    const a = landmarksPx[iA];
    const b = landmarksPx[iB];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff";
  for (const p of landmarksPx) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHandSkeletonsOverBoard(handsLandmarks, box) {
  if (!box || !handsLandmarks || handsLandmarks.length === 0) return;
  for (const lm of handsLandmarks) {
    const landmarksPx = lm.map((pt) => toPixel(mirrorLandmarkX(pt)));
    const overBoard = landmarksPx.some((p) => isPointInBoard(p.x, p.y, box));
    if (overBoard) drawHandSkeleton(landmarksPx);
  }
}

function startShatter(sourceCanvas, box) {
  const cols = SHATTER_COLS;
  const rows = SHATTER_ROWS;
  const fragW = sourceCanvas.width / cols;
  const fragH = sourceCanvas.height / rows;
  const fragments = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * fragW;
      const sy = row * fragH;
      const fragCanvas = document.createElement("canvas");
      fragCanvas.width = Math.ceil(fragW);
      fragCanvas.height = Math.ceil(fragH);
      fragCanvas.getContext("2d").drawImage(
        sourceCanvas,
        sx,
        sy,
        fragW,
        fragH,
        0,
        0,
        fragCanvas.width,
        fragCanvas.height
      );
      const cx = box.x + sx + fragW / 2;
      const cy = box.y + sy + fragH / 2;
      const boardCx = box.x + box.width / 2;
      const boardCy = box.y + box.height / 2;
      const dirX = cx - boardCx;
      const dirY = cy - boardCy;
      const dirLen = Math.max(1, Math.hypot(dirX, dirY));
      const speed = 90 + Math.random() * 160;
      fragments.push({
        canvas: fragCanvas,
        x: cx,
        y: cy,
        w: fragW,
        h: fragH,
        vx: (dirX / dirLen) * speed + (Math.random() - 0.5) * 40,
        vy: (dirY / dirLen) * speed + (Math.random() - 0.5) * 40 - 60,
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 6,
        gravity: 220 + Math.random() * 80,
      });
    }
  }
  shatter.fragments = fragments;
  shatter.active = true;
  shatter.startedAt = performance.now();
  appState = "shattering";
  soundShatter();
  stopRecording();
}

function updateAndDrawShatter() {
  const elapsedMs = performance.now() - shatter.startedAt;
  const t = Math.min(1, elapsedMs / SHATTER_DURATION_MS);
  if (t >= 1) {
    finishShatter();
    return;
  }
  const dt = 1 / 60;
  const fadeStart = 0.45;
  ctx.save();
  for (const frag of shatter.fragments) {
    frag.x += frag.vx * dt;
    frag.y += frag.vy * dt;
    frag.vy += frag.gravity * dt;
    frag.rotation += frag.rotationSpeed * dt;
    const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
    const scale = 1 - t * 0.25;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(frag.x, frag.y);
    ctx.rotate(frag.rotation);
    ctx.scale(scale, scale);
    ctx.drawImage(frag.canvas, -frag.w / 2, -frag.h / 2, frag.w, frag.h);
    ctx.restore();
  }
  ctx.restore();
}

function finishShatter() {
  shatter.active = false;
  shatter.fragments = [];
  players[currentPlayerIndex].time = puzzle.timerElapsed;
  if (shatter.pendingCanvas) {
    addToGallery(shatter.pendingCanvas);
    statusText.textContent = "saved to photobooth strip!";
    shatter.pendingCanvas = null;
    soundSaved();
  }
  resetPuzzleOnly();
  advanceToNextPlayer();
}

function handleFistReset() {
  if (appState !== "puzzle") {
    statusText.textContent = "reset board";
    resetPuzzleOnly();
    return;
  }
  const reallySolved = checkPuzzleSolved();
  puzzle.solved = reallySolved;
  if (reallySolved && puzzle.fullPhotoboothCanvas) {
    shatter.pendingCanvas = puzzle.fullPhotoboothCanvas;
    startShatter(puzzle.fullPhotoboothCanvas, puzzle.boardBox);
  } else {
    statusText.textContent = "puzzle not solved yet!";
    playTone({ freq: 300, type: "sawtooth", gain: 0.1, duration: 0.15 });
  }
}

let handLandmarker = null;
let fistHoldCounter = 0;

function processResults(result) {
  if (appState === "shattering") {
    updateAndDrawShatter();
    statusText.textContent = "saving polaroid…";
    return;
  }

  const handsLandmarks = result.landmarks || [];
  const noHands = handsLandmarks.length === 0;

  if (noHands) {
    statusDot.className = puzzle.solved ? "status-dot solved" : "status-dot";
    fistHoldCounter = 0;
    freezeGate.holding = false;
    if (drag.activeHand && drag.piece) {
      handleDragForHand(drag.activeHand, false, { x: drag.piece.x, y: drag.piece.y });
    }
    if (appState === "tracking") {
      const sinceLastSeen = performance.now() - lastSeenFrame.at;
      if (lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
        applyColorInsideBox(lastSeenFrame.box);
        drawLiveFrameOverlay(lastSeenFrame.box);
      }
      statusText.textContent =
        gamePhase === "playing"
          ? `${players[currentPlayerIndex]?.name || "Player"} — frame your photo`
          : isStripFull()
          ? "strip complete — download or reset"
          : "looking for hands…";
      return;
    }
    if (appState === "countdown") {
      drawCountdownOverlay(puzzle.boardBox);
      return;
    }
    if (appState === "puzzle") {
      puzzle.solved = checkPuzzleSolved();
      updateProgressBadge();
      updateGestureHUD();
      drawBoardAndPieces();
      statusText.textContent = puzzle.solved
        ? `${players[currentPlayerIndex]?.name || "Player"} — puzzle complete! make a fist or click SAVE`
        : `${players[currentPlayerIndex]?.name || "Player"} — arrange the puzzle with pinch or mouse`;
      return;
    }
    return;
  }

  statusDot.className = puzzle.solved ? "status-dot solved" : "status-dot live";

  const anyFist = handsLandmarks.some((lm) => isFist(lm));
  const draggingNow = (drag.activeHand !== null && drag.piece !== null) || pointerDrag.active;
  if (anyFist && !draggingNow && appState !== "tracking") {
    fistHoldCounter++;
    if (fistHoldCounter >= FIST_HOLD_FRAMES) {
      fistHoldCounter = 0;
      handleFistReset();
      return;
    }
  } else {
    fistHoldCounter = 0;
  }

  if (appState === "tracking") {
    if (isStripFull()) {
      statusText.textContent = "strip complete — download or reset";
      return;
    }
    if (handsLandmarks.length === 2) {
      const [handA, handB] = handsLandmarks;
      const indexA = mirrorLandmarkX(handA[LM.INDEX_TIP]);
      const indexB = mirrorLandmarkX(handB[LM.INDEX_TIP]);
      const frameBox = computeHandFrame(indexA, indexB);
      if (frameBox.width > 4 && frameBox.height > 4) {
        applyColorInsideBox(frameBox);
        drawLiveFrameOverlay(frameBox);
        lastSeenFrame.box = frameBox;
        lastSeenFrame.at = performance.now();
      }
      const bothPinching = isPinching(handA) && isPinching(handB);
      if (bothPinching && frameBox.width > 40 && frameBox.height > 40) {
        if (!freezeGate.holding) {
          freezeGate.holding = true;
          freezeGate.since = performance.now();
        }
        statusDot.className = "status-dot armed";
        statusText.textContent = "hold the pinch…";
        if (performance.now() - freezeGate.since > FREEZE_HOLD_MS) {
          freezeGate.holding = false;
          startCountdown(frameBox);
        }
      } else {
        freezeGate.holding = false;
        statusText.textContent = "hands tracking";
      }
    } else {
      freezeGate.holding = false;
      const sinceLastSeen = performance.now() - lastSeenFrame.at;
      if (lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
        applyColorInsideBox(lastSeenFrame.box);
        drawLiveFrameOverlay(lastSeenFrame.box);
      }
      statusText.textContent =
        gamePhase === "playing"
          ? `${players[currentPlayerIndex]?.name || "Player"} — show 2 hands`
          : "hands tracking";
    }
    return;
  }

  if (appState === "countdown") {
    drawCountdownOverlay(puzzle.boardBox);
    return;
  }

  if (appState === "puzzle") {
    const labelsPresent = new Set();
    handsLandmarks.forEach((lm, i) => {
      const label = i === 0 ? "A" : "B";
      labelsPresent.add(label);
      const pinching = isPinching(lm);
      const indexPx = toPixel(mirrorLandmarkX(lm[LM.INDEX_TIP]));
      handleDragForHand(label, pinching, indexPx);
    });
    if (drag.activeHand && !labelsPresent.has(drag.activeHand) && drag.piece) {
      handleDragForHand(drag.activeHand, false, { x: drag.piece.x, y: drag.piece.y });
    }
    if (!drag.piece && !pointerDrag.piece) {
      puzzle.solved = checkPuzzleSolved();
      updateProgressBadge();
      updateGestureHUD();
    }
    drawBoardAndPieces();
    drawHandSkeletonsOverBoard(handsLandmarks, puzzle.boardBox);
    statusText.textContent = puzzle.solved
      ? fistHoldCounter > 0
        ? `${players[currentPlayerIndex]?.name || "Player"} — saving… hold fist (${fistHoldCounter}/${FIST_HOLD_FRAMES})`
        : `${players[currentPlayerIndex]?.name || "Player"} — puzzle complete! make a fist or click SAVE`
      : `${players[currentPlayerIndex]?.name || "Player"} — arrange the puzzle with pinch or mouse`;
  }
}

function renderLoop() {
  if (videoEl.readyState >= 2 && handLandmarker) {
    drawVideoFrame();
    const nowMs = performance.now();
    const result = handLandmarker.detectForVideo(videoEl, nowMs);
    processResults(result);
  }
  updateAndDrawConfetti();
  requestAnimationFrame(renderLoop);
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

function showLoaderError(message) {
  loaderText.textContent = message;
  loaderText.style.color = "#ff4757";
  loaderRetry.classList.remove("hidden");
}

function resetLoaderUI() {
  loadingOverlay.classList.remove("hidden");
  loaderText.style.color = "";
  loaderText.textContent = "Loading HandLandmarker neural model…";
  loaderRetry.classList.add("hidden");
  errorBanner.style.display = "none";
}

async function boot() {
  resetLoaderUI();
  let settled = false;
  const watchdogMs = LOAD_TIMEOUT_MS * 2 + 5000;
  const watchdog = setTimeout(() => {
    if (!settled) showLoaderError("Loading is taking longer than expected. Click retry or check your connection.");
  }, watchdogMs);

  try {
    if (!videoEl.srcObject) await initWebcam();
    handLandmarker = await initHandLandmarker();
    settled = true;
    clearTimeout(watchdog);
    loadingOverlay.classList.add("hidden");
    statusText.textContent = "enter player names to begin";
    requestAnimationFrame(renderLoop);
    nameEntryModal.classList.remove("hidden");
  } catch (err) {
    settled = true;
    clearTimeout(watchdog);
    if (err && err.name === "NotAllowedError") {
      showLoaderError("Camera permission denied. Enable camera access in your browser and click retry.");
    } else if (err && err.name === "NotFoundError") {
      showLoaderError("No webcam was found on your device.");
    } else {
      showLoaderError((err && err.message) || "Error starting the application.");
    }
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
loaderRetry.addEventListener("click", () => boot());

if (downloadStripBtn) {
  updateStripDownloadAvailability();
  downloadStripBtn.addEventListener("click", showStripModal);
}

if (downloadVideoBtn) {
  downloadVideoBtn.addEventListener("click", downloadVideo);
}

if (stripModalDownload) {
  stripModalDownload.addEventListener("click", () => downloadPhotoStrip());
}

if (stripModalClose) {
  stripModalClose.addEventListener("click", () => stripModal.classList.add("hidden"));
}
if (stripModalCloseIcon) {
  stripModalCloseIcon.addEventListener("click", () => stripModal.classList.add("hidden"));
}

if (resetAllBtn) {
  resetAllBtn.addEventListener("click", () => {
    const confirmed = window.confirm("Are you sure you want to reset all players and delete the photo strip?");
    if (confirmed) resetEverything();
  });
}

if (startGameBtn) {
  startGameBtn.addEventListener("click", () => {
    const inputs = [
      document.getElementById("playerName1"),
      document.getElementById("playerName2"),
      document.getElementById("playerName3"),
    ];
    inputs.forEach((input, i) => {
      const val = input.value.trim();
      players[i].name = val || `Player ${i + 1}`;
    });
    nameEntryModal.classList.add("hidden");
    gamePhase = "playing";
    currentPlayerIndex = 0;
    updateTurnIndicator();
    statusText.textContent = `${players[0].name} — frame your photo`;
    updateGestureHUD();
    playTone({ freq: 523, type: "sine", gain: 0.15, duration: 0.2 });
  });
}

if (playAgainBtn) {
  playAgainBtn.addEventListener("click", startNewGame);
}

if (viewStripBtn) {
  viewStripBtn.addEventListener("click", () => {
    leaderboardModal.classList.add("hidden");
    showStripModal();
  });
}

// Retake Crop Click Listener
if (retakeBtn) {
  retakeBtn.addEventListener("click", handleRetakeCrop);
}

// Save & Continue Button Click (fallback for fist gesture)
if (saveSolveBtn) {
  saveSolveBtn.addEventListener("click", () => {
    if (puzzle.solved && puzzle.fullPhotoboothCanvas) {
      shatter.pendingCanvas = puzzle.fullPhotoboothCanvas;
      startShatter(puzzle.fullPhotoboothCanvas, puzzle.boardBox);
    }
  });
}

// Sound Mute Toggle
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

// Fullscreen Toggle
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

// How to play guide modal
if (helpBtn) {
  helpBtn.addEventListener("click", () => helpModal.classList.remove("hidden"));
}
if (helpModalClose) {
  helpModalClose.addEventListener("click", () => helpModal.classList.add("hidden"));
}
if (helpModalCloseIcon) {
  helpModalCloseIcon.addEventListener("click", () => helpModal.classList.add("hidden"));
}

// Keyboard shortcuts (R for Retake, Space for Retake / Solve, Esc to close modals)
window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    if (gamePhase === "playing") {
      handleRetakeCrop();
    }
  } else if (e.key === "Escape") {
    stripModal.classList.add("hidden");
    helpModal.classList.add("hidden");
  }
});

// Resume Web Audio on user gesture
window.addEventListener("click", () => resumeAudio(), { once: true });
window.addEventListener("touchstart", () => resumeAudio(), { once: true });

boot();
