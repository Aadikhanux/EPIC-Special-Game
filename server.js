/**
 * EPIC Special Photobooth Puzzle — Tournament Server
 * Handles 500+ concurrent WebSocket connections for live multiplayer.
 *
 * Tournament State Machine: LOBBY → ACTIVE → ENDED
 * Admin commands: start, stop, reset, kick, setTime, announce
 */

const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");
const crypto = require("crypto");

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const ADMIN_PIN = process.env.ADMIN_PIN || "epic2026";
const HEARTBEAT_INTERVAL_MS = 30000;
const LEADERBOARD_BROADCAST_THROTTLE_MS = 500;

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname), {
  maxAge: 0,
  setHeaders(res, filePath) {
    // No cache for HTML files during dev
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store");
    }
  },
}));

const server = http.createServer(app);

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

// ── Tournament State ──────────────────────────────────────────────────────────
let tournamentState = "LOBBY"; // LOBBY | ACTIVE | ENDED
let tournamentStartedAt = null;
let tournamentEndedAt = null;
let tournamentTimerDuration = 0; // 0 = no time limit (seconds)
let tournamentTimerInterval = null;
let adminAnnouncement = "";

// Player registry: Map<playerId, playerData>
const players = new Map();
// Admin connections set
const adminClients = new Set();
// Player connections: Map<ws, playerId>
const wsToPlayer = new Map();

let nextPlayerId = 1;
let lastLeaderboardBroadcast = 0;
let pendingLeaderboardBroadcast = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function generatePlayerId() {
  return `P${String(nextPlayerId++).padStart(4, "0")}`;
}

function getUniquePlayerName(requestedName, excludePlayerId = null) {
  let base = (requestedName || "Player").trim().slice(0, 24);
  if (!base) base = "Player";

  const existingNames = new Set();
  for (const [id, p] of players) {
    if (id !== excludePlayerId && p.name) {
      existingNames.add(p.name.toLowerCase());
    }
  }

  if (!existingNames.has(base.toLowerCase())) {
    return base;
  }

  let counter = 2;
  let candidate = `${base} ${counter}`;
  while (existingNames.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${base} ${counter}`;
  }
  return candidate;
}

function getLeaderboard() {
  const entries = [];
  for (const [id, p] of players) {
    entries.push({
      id,
      name: p.name,
      solveTime: p.solveTime,
      status: p.status, // waiting | playing | solved | disconnected
      connected: p.connected,
    });
  }
  // Sort: solved players first (by solveTime asc), then playing, then waiting
  entries.sort((a, b) => {
    if (a.solveTime != null && b.solveTime != null) return a.solveTime - b.solveTime;
    if (a.solveTime != null) return -1;
    if (b.solveTime != null) return 1;
    return 0;
  });
  // Assign ranks
  let rank = 0;
  entries.forEach((e) => {
    if (e.solveTime != null) {
      rank++;
      e.rank = rank;
    } else {
      e.rank = null;
    }
  });
  return entries;
}

function getTournamentStats() {
  let connected = 0;
  let solved = 0;
  let playing = 0;
  let fastestTime = null;
  let totalTime = 0;
  let totalSolved = 0;

  for (const [, p] of players) {
    if (p.connected) connected++;
    if (p.solveTime != null) {
      solved++;
      totalSolved++;
      totalTime += p.solveTime;
      if (fastestTime == null || p.solveTime < fastestTime) {
        fastestTime = p.solveTime;
      }
    }
    if (p.status === "playing") playing++;
  }

  return {
    totalPlayers: players.size,
    connected,
    solved,
    playing,
    waiting: players.size - solved - playing,
    fastestTime,
    avgTime: totalSolved > 0 ? totalTime / totalSolved : null,
  };
}

function getElapsedSeconds() {
  if (!tournamentStartedAt) return 0;
  const endTime = tournamentEndedAt || Date.now();
  return Math.floor((endTime - tournamentStartedAt) / 1000);
}

function getRemainingSeconds() {
  if (!tournamentTimerDuration || !tournamentStartedAt) return null;
  const elapsed = getElapsedSeconds();
  return Math.max(0, tournamentTimerDuration - elapsed);
}

// ── Broadcasting ──────────────────────────────────────────────────────────────
function broadcast(data, targetSet = null) {
  const msg = JSON.stringify(data);
  const clients = targetSet || wss.clients;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastToAdmins(data) {
  const msg = JSON.stringify(data);
  for (const client of adminClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastTournamentState() {
  const stats = getTournamentStats();
  const leaderboard = getLeaderboard();
  const stateMsg = {
    type: "TOURNAMENT_STATE",
    state: tournamentState,
    elapsed: getElapsedSeconds(),
    remaining: getRemainingSeconds(),
    timerDuration: tournamentTimerDuration,
    stats,
    leaderboard,
    announcement: adminAnnouncement,
  };
  broadcast(stateMsg);
}

function scheduleLeaderboardBroadcast() {
  const now = Date.now();
  if (now - lastLeaderboardBroadcast >= LEADERBOARD_BROADCAST_THROTTLE_MS) {
    doLeaderboardBroadcast();
  } else if (!pendingLeaderboardBroadcast) {
    pendingLeaderboardBroadcast = true;
    setTimeout(() => {
      pendingLeaderboardBroadcast = false;
      doLeaderboardBroadcast();
    }, LEADERBOARD_BROADCAST_THROTTLE_MS - (now - lastLeaderboardBroadcast));
  }
}

function doLeaderboardBroadcast() {
  lastLeaderboardBroadcast = Date.now();
  const leaderboard = getLeaderboard();
  const stats = getTournamentStats();
  broadcast({
    type: "LEADERBOARD_UPDATE",
    leaderboard: leaderboard.slice(0, 100), // Top 100 for perf
    stats,
    elapsed: getElapsedSeconds(),
    remaining: getRemainingSeconds(),
  });
}

// ── Tournament Controls ───────────────────────────────────────────────────────
function startTournament() {
  if (tournamentState === "ACTIVE") return;
  const wasEnded = (tournamentState === "ENDED");
  tournamentState = "ACTIVE";
  tournamentStartedAt = Date.now();
  tournamentEndedAt = null;

  // Set all connected players to "playing" (and reset solveTime if restarted after end)
  for (const [, p] of players) {
    if (p.connected) {
      p.status = "playing";
      if (wasEnded) {
        p.solveTime = null;
      }
    }
  }

  if (tournamentTimerInterval) {
    clearInterval(tournamentTimerInterval);
    tournamentTimerInterval = null;
  }

  broadcast({ type: "TOURNAMENT_START", timestamp: tournamentStartedAt });
  doLeaderboardBroadcast();
  broadcastTournamentState();

  // Timer broadcast & auto-stop interval (ticks every 1s)
  tournamentTimerInterval = setInterval(() => {
    if (tournamentState !== "ACTIVE") {
      if (tournamentTimerInterval) clearInterval(tournamentTimerInterval);
      tournamentTimerInterval = null;
      return;
    }
    const remaining = getRemainingSeconds();
    if (tournamentTimerDuration > 0 && remaining != null && remaining <= 0) {
      stopTournament();
    } else {
      broadcastTournamentState();
    }
  }, 1000);

  console.log(`[TOURNAMENT] Started! ${players.size} players registered.`);
}

function stopTournament() {
  if (tournamentState === "ENDED") return;
  tournamentState = "ENDED";
  tournamentEndedAt = Date.now();

  if (tournamentTimerInterval) {
    clearInterval(tournamentTimerInterval);
    tournamentTimerInterval = null;
  }

  // Mark remaining playing players as waiting
  for (const [, p] of players) {
    if (p.status === "playing") {
      p.status = "waiting"; // didn't finish
    }
  }

  const leaderboard = getLeaderboard();
  const stats = getTournamentStats();
  const elapsed = getElapsedSeconds();

  broadcast({
    type: "TOURNAMENT_END",
    leaderboard,
    stats,
    elapsed,
  });
  doLeaderboardBroadcast();
  broadcastTournamentState();

  console.log(`[TOURNAMENT] Ended. ${stats.solved} players solved.`);
}

function resetTournament() {
  tournamentState = "LOBBY";
  tournamentStartedAt = null;
  tournamentEndedAt = null;
  adminAnnouncement = "";

  if (tournamentTimerInterval) {
    clearInterval(tournamentTimerInterval);
    tournamentTimerInterval = null;
  }

  // Reset all player solve data but keep registrations
  for (const [, p] of players) {
    p.solveTime = null;
    p.status = p.connected ? "waiting" : "disconnected";
  }

  const leaderboard = getLeaderboard();
  const stats = getTournamentStats();

  broadcast({ type: "TOURNAMENT_RESET", leaderboard, stats });
  doLeaderboardBroadcast();
  broadcastTournamentState();
  console.log(`[TOURNAMENT] Reset. ${players.size} players back to lobby.`);
}

function fullReset() {
  tournamentState = "LOBBY";
  tournamentStartedAt = null;
  tournamentEndedAt = null;
  adminAnnouncement = "";
  nextPlayerId = 1;

  if (tournamentTimerInterval) {
    clearInterval(tournamentTimerInterval);
    tournamentTimerInterval = null;
  }

  // Disconnect all players
  players.clear();
  wsToPlayer.clear();

  broadcast({ type: "FULL_RESET" });
  console.log("[TOURNAMENT] Full reset. All players cleared.");
}

// ── WebSocket Connection Handler ──────────────────────────────────────────────
wss.on("connection", (ws, req) => {
  let playerId = null;
  let isAdmin = false;

  // Heartbeat
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch (e) {
      return;
    }

    switch (msg.type) {
      // ── Player Registration ──
      case "PLAYER_JOIN": {
        const rawName = (msg.name || "Player").trim().slice(0, 24);
        if (!playerId || !players.has(playerId)) {
          playerId = generatePlayerId();
        }
        const name = getUniquePlayerName(rawName, playerId);
        players.set(playerId, {
          name,
          solveTime: null,
          status: tournamentState === "ACTIVE" ? "playing" : "waiting",
          connected: true,
          joinedAt: Date.now(),
        });
        wsToPlayer.set(ws, playerId);

        const stats = getTournamentStats();
        const leaderboard = getLeaderboard();

        ws.send(JSON.stringify({
          type: "PLAYER_REGISTERED",
          playerId,
          name,
          tournamentState,
          elapsed: getElapsedSeconds(),
          remaining: getRemainingSeconds(),
          timerDuration: tournamentTimerDuration,
          stats,
          leaderboard,
          announcement: adminAnnouncement,
        }));

        // Broadcast updated stats & leaderboard to everyone immediately
        doLeaderboardBroadcast();
        broadcastTournamentState();
        console.log(`[PLAYER] "${name}" (${playerId}) joined lobby. Connected: ${stats.connected}/${players.size}`);
        break;
      }

      // ── Player Solve Submission ──
      case "PLAYER_SOLVED": {
        if (!playerId || !players.has(playerId)) break;
        const player = players.get(playerId);
        if (player.solveTime != null) break; // Already solved

        const solveTime = parseFloat(msg.solveTime);
        if (isNaN(solveTime) || solveTime <= 0) break;

        player.solveTime = solveTime;
        player.status = "solved";

        const leaderboard = getLeaderboard();
        const rank = leaderboard.find((e) => e.id === playerId)?.rank || null;

        ws.send(JSON.stringify({
          type: "SOLVE_CONFIRMED",
          rank,
          solveTime,
          totalSolved: getTournamentStats().solved,
        }));

        scheduleLeaderboardBroadcast();
        console.log(`[SOLVE] ${player.name} (${playerId}) solved in ${solveTime.toFixed(1)}s — Rank #${rank}`);
        break;
      }

      // ── Player Heartbeat ──
      case "PLAYER_PING": {
        ws.send(JSON.stringify({ type: "PLAYER_PONG", timestamp: Date.now() }));
        break;
      }

      // ── Admin Authentication ──
      case "ADMIN_AUTH": {
        const inputPin = (msg.pin || "").trim().toLowerCase();
        const validPin = (ADMIN_PIN || "epic2026").trim().toLowerCase();
        if (inputPin === validPin) {
          isAdmin = true;
          adminClients.add(ws);
          ws.send(JSON.stringify({
            type: "ADMIN_AUTH_OK",
            tournamentState,
            stats: getTournamentStats(),
            leaderboard: getLeaderboard(),
            elapsed: getElapsedSeconds(),
            remaining: getRemainingSeconds(),
            timerDuration: tournamentTimerDuration,
            announcement: adminAnnouncement,
          }));
          console.log("[ADMIN] Admin authenticated successfully.");
        } else {
          ws.send(JSON.stringify({ type: "ADMIN_AUTH_FAIL" }));
        }
        break;
      }

      // ── Admin Commands ──
      case "ADMIN_START": {
        if (!isAdmin) break;
        startTournament();
        break;
      }

      case "ADMIN_STOP": {
        if (!isAdmin) break;
        stopTournament();
        break;
      }

      case "ADMIN_RESET": {
        if (!isAdmin) break;
        resetTournament();
        break;
      }

      case "ADMIN_FULL_RESET": {
        if (!isAdmin) break;
        fullReset();
        break;
      }

      case "ADMIN_SET_TIMER": {
        if (!isAdmin) break;
        tournamentTimerDuration = Math.max(0, parseInt(msg.duration) || 0);
        broadcastTournamentState();
        console.log(`[ADMIN] Timer set to ${tournamentTimerDuration}s`);
        break;
      }

      case "ADMIN_ANNOUNCE": {
        if (!isAdmin) break;
        adminAnnouncement = (msg.message || "").trim().slice(0, 200);
        broadcast({ type: "ANNOUNCEMENT", message: adminAnnouncement });
        console.log(`[ADMIN] Announcement: "${adminAnnouncement}"`);
        break;
      }

      case "ADMIN_KICK": {
        if (!isAdmin || !msg.playerId) break;
        const kickedPlayer = players.get(msg.playerId);
        if (kickedPlayer) {
          players.delete(msg.playerId);
          // Find and close the player's WS
          for (const [clientWs, pid] of wsToPlayer) {
            if (pid === msg.playerId) {
              clientWs.send(JSON.stringify({ type: "KICKED" }));
              clientWs.close();
              wsToPlayer.delete(clientWs);
              break;
            }
          }
          scheduleLeaderboardBroadcast();
          broadcastTournamentState();
          console.log(`[ADMIN] Kicked player ${msg.playerId} (${kickedPlayer.name})`);
        }
        break;
      }

      case "ADMIN_GET_CSV": {
        if (!isAdmin) break;
        const leaderboard = getLeaderboard();
        const csvRows = ["Rank,Player ID,Name,Solve Time (s),Status"];
        leaderboard.forEach((e) => {
          csvRows.push(`${e.rank || "-"},${e.id},"${e.name}",${e.solveTime != null ? e.solveTime.toFixed(1) : "DNF"},${e.status}`);
        });
        ws.send(JSON.stringify({ type: "CSV_DATA", csv: csvRows.join("\n") }));
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    if (playerId && players.has(playerId)) {
      const player = players.get(playerId);
      player.connected = false;
      if (player.status === "waiting" || player.status === "playing") {
        player.status = "disconnected";
      }
      scheduleLeaderboardBroadcast();
      broadcastTournamentState();
    }
    wsToPlayer.delete(ws);
    adminClients.delete(ws);
  });

  ws.on("error", () => {
    ws.close();
  });
});

// ── Heartbeat interval to detect dead connections ─────────────────────────────
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

// ── Periodic leaderboard sync for active tournament ───────────────────────────
setInterval(() => {
  if (tournamentState === "ACTIVE") {
    broadcastTournamentState();
  }
}, 5000);

// ── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎯 EPIC SPECIAL PHOTOBOOTH PUZZLE — TOURNAMENT SERVER   ║
╠══════════════════════════════════════════════════════════════╣
║  Player URL:   http://localhost:${PORT}                       ║
║  Admin Panel:  http://localhost:${PORT}/admin.html             ║
║  Admin PIN:    ${ADMIN_PIN}                                       ║
║  Max Players:  500+                                          ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
