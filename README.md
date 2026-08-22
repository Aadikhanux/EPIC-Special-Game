# EPIC Special Photobooth Puzzle — Live Tournament 🏆
#test 
A real-time, 500+ player multiplayer AI face detection photobooth puzzle tournament engine. Built with MediaPipe Neural Vision, WebSockets, HTML5 Canvas 2D physics, and Web Audio API.

---

## 🌟 Key Features

- **🎮 Live Multiplayer Tournament Engine:** Supports 500+ concurrent players with live ranking updates, sub-second sync, and real-time scoreboards via WebSockets.
- **👤 AI Face Tracking & Viewfinder:** MediaPipe BlazeFace auto-detects and smoothly locks onto your face portrait with an interactive cyber viewfinder.
- **👌 Air-Gesture Pinch Controls:** Solve the 3×3 puzzle entirely with touchless camera air gestures. Features adaptive palm-scale distance normalization, hysteresis enter/exit thresholds, and exponential landmark smoothing.
- **📱 Fully Mobile-Optimized:**
  - **Full-Screen Camera:** The game viewport occupies 100% of the screen on mobile devices.
  - **Slide-up Leaderboard Drawer:** Open rankings via the top HUD trophy button with a backdrop tap-to-dismiss.
  - Pure vision-based gesture solving without screen touch interference.
- **🔒 Privacy & Battery Conscious:** Camera hardware tracks and vision neural models immediately stop running once a player completes their puzzle or when the tournament ends.
- **🎛️ Admin Mission Control (`/admin`):**
  - Live tournament state machine (`LOBBY` → `ACTIVE` → `ENDED`).
  - Real-time player telemetry, connected counts, average/fastest solve times.
  - Broadcast live announcements to all players in real time.
  - Tournament countdown timer configuration.
  - One-click CSV export of tournament results.
  - Player management and kick controls.
- **🔊 Procedural Sound Design:** Full audio synthesizer powered by Web Audio API — countdown beeps, snap clicks, piece locking, completion chimes, and celebration bursts with zero audio file downloads.

---

## Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or newer recommended)

### 2. Install & Run
```bash
# Clone the repository
git clone https://github.com/Aadikhanux/EPIC-Special-Game.git
cd EPIC-Special-Game

# Install dependencies
npm install

# Start the tournament server
npm start
# or: node server.js
```

### 3. Access URLs
- **Player Interface:** `http://localhost:8080`
- **Admin Mission Control:** `http://localhost:8080/admin`
---

## 🎮 How to Play

| Step | Action | Description |
|---|---|---|
| **1** | **Join Lobby** | Enter your name and wait in the lobby until the host begins the contest. |
| **2** | **Frame Face & Snap** | Center your face in the AI viewfinder and tap **SNAP PHOTO** (or pinch in air). A 3-second countdown will capture and photobooth-process your photo. |
| **3** | **Solve 3×3 Puzzle** | Pinch your thumb and index finger in front of the camera (`👌`) to grab, drag, and drop tiles into the correct slots. |
| **4** | **Submit & Lock Rank** | Once all 9 tiles are solved, your time is automatically submitted to the live tournament leaderboard and your camera turns off. |

---

## 🛠️ Architecture & Tech Stack

- **Frontend:** Vanilla JavaScript (ES Modules), HTML5, Custom CSS3 Design System.
- **Vision Models:** MediaPipe Tasks Vision (`@mediapipe/tasks-vision` 0.10.14) — BlazeFace & HandLandmarker.
- **Backend:** Node.js, Express, `ws` (High-performance WebSocket Server).
- **Audio:** Web Audio API procedural synthesis (Sine, Sawtooth, Square oscillators & gain envelopes).
- **FX:** Canvas 2D particle physics (confetti explosions & shattering puzzle fragments).

---

## 🌐 Browser Support

| Browser / Device | Status | Notes |
|---|---|---|
| **Chrome / Edge (Desktop & Mobile)** | 🟢 Recommended | Hardware-accelerated WebAssembly & WebGL. |
| **Firefox** | 🟢 Fully Supported | Full camera & gesture support. |
| **Safari / iOS** | 🟢 Fully Supported | WebRTC & full mobile responsive drawer. |
| **Android Chrome** | 🟢 Fully Supported | High performance live vision tracking. |

---

## 📄 License

MIT License — Free to use, customize, and deploy.
