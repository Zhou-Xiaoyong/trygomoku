/**
 * Gomoku Online &mdash; Game Engine, Canvas Renderer, and AI
 * 15x15 standard board with 3D stones, wood texture, 3 AI difficulty levels.
 */

// ============================================================
// CONSTANTS
// ============================================================
const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const STAR_POINTS = [
  [3, 3], [3, 7], [3, 11],
  [7, 3], [7, 7], [7, 11],
  [11, 3], [11, 7], [11, 11]
];

const DIRECTIONS = [
  [0, 1],   // horizontal
  [1, 0],   // vertical
  [1, 1],   // diagonal down-right
  [1, -1]   // diagonal down-left
];

// ============================================================
// GAME STATE
// ============================================================
let board;           // 2D array [BOARD_SIZE][BOARD_SIZE] = EMPTY|BLACK|WHITE
let moveHistory;     // [ {row, col, player} ]
let currentPlayer;   // BLACK or WHITE
let gameRule;       // 'freestyle' | 'renju'
let renjuFoul;      // null | 'overline' | 'doubleThree' | 'doubleFour'
let gameMode;        // 'pve' or 'pvp'
let difficulty;      // 'easy' | 'medium' | 'hard' | 'master'
let humanColor;      // BLACK or WHITE
let aiColor;         // opposite
let gameOver;        // boolean
let winner;          // BLACK | WHITE | null
let winLine;         // [{row, col}] for winning cells
let lastMove;        // {row, col} | null
let scores;          // { black: 0, white: 0, draw: 0 }
let soundEnabled;    // boolean
let aiThinking;      // boolean - prevent input while AI is computing

// ============================================================
// CANVAS STATE
// ============================================================
let canvas, ctx;
let overlayCanvas, overlayCtx;
let logicalSize;     // CSS pixel size
let dpr;             // device pixel ratio
let margin, cellSize, stoneRadius;
let hoverRow = null; // row of hover ghost stone
let hoverCol = null; // col of hover ghost stone
let hoverAnimId = null; // requestAnimationFrame id for ghost pulsation

// Cached offscreen canvases for performance
let woodCanvas = null;   // cached wood grain texture
let stoneCanvases = null; // { black: Canvas, white: Canvas } pre-rendered stones
let stonesCanvas = null;  // offscreen canvas for all placed stones
let stonesDirty = true;   // flag to redraw stones canvas

// ============================================================
// AUDIO CONTEXT (lazy init)
// ============================================================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, duration, type, vol) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio unavailable */ }
}

function playPlaceSound() {
  playTone(600, 0.08, 'sine', 0.12);
}

function playUndoSound() {
  playTone(300, 0.12, 'triangle', 0.1);
}

function playWinSound() {
  if (!soundEnabled) return;
  setTimeout(function () { playTone(523, 0.15, 'sine', 0.18); }, 0);
  setTimeout(function () { playTone(659, 0.15, 'sine', 0.18); }, 120);
  setTimeout(function () { playTone(784, 0.15, 'sine', 0.18); }, 240);
  setTimeout(function () { playTone(1047, 0.35, 'sine', 0.2); }, 360);
}

function playLoseSound() {
  if (!soundEnabled) return;
  setTimeout(function () { playTone(400, 0.15, 'triangle', 0.1); }, 0);
  setTimeout(function () { playTone(350, 0.2, 'triangle', 0.1); }, 150);
  setTimeout(function () { playTone(300, 0.3, 'triangle', 0.08); }, 350);
}

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  try {
  var hasGame = false;

  canvas = document.getElementById('gomokuBoard');
  if (canvas) {
    ctx = canvas.getContext('2d');
    overlayCanvas = document.getElementById('gomokuOverlay');
    overlayCtx = overlayCanvas.getContext('2d');

    setupCanvas();
    setupCanvasEvents();
    setupUI();
    initGame();
    hasGame = true;

    window.addEventListener('resize', function () {
      setupCanvas();
      drawBoard();
      drawOverlay();
    });

    // Refresh status/scores when i18n translations are loaded (Chinese page)
    // Also check if already loaded (race condition safety)
    function refreshStatusOnI18n() {
      if (typeof updateStatus === 'function') updateStatus();
      if (typeof updateScores === 'function') updateScores();
    }
    document.addEventListener('i18n-ready', refreshStatusOnI18n);
    // If i18n already finished loading before we registered the listener, trigger manually
    if (window.i18n && window.i18n.currentLang !== 'en') refreshStatusOnI18n();
  }

  // Hamburger menu toggle
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.querySelector('.nav-links');
  var siteNav = document.querySelector('.site-nav');

  if (navToggle && navLinks && siteNav) {
    function openNavMenu() {
      navLinks.classList.add('nav-open');
      navToggle.classList.add('open');
      navToggle.setAttribute('aria-expanded', 'true');
      siteNav.classList.add('menu-open');
    }

    function closeNavMenu() {
      navLinks.classList.remove('nav-open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      siteNav.classList.remove('menu-open');
    }

    navToggle.addEventListener('click', function () {
      if (navLinks.classList.contains('nav-open')) {
        closeNavMenu();
      } else {
        openNavMenu();
      }
    });

    // Click on ::after backdrop closes menu (event.target === siteNav)
    siteNav.addEventListener('click', function (e) {
      if (e.target === siteNav && navLinks.classList.contains('nav-open')) {
        closeNavMenu();
      }
    });

    // Close menu when any nav link is clicked
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        closeNavMenu();
      });
    });
  }

  // IntersectionObserver: hide sticky nav when footer is reached
  (function () {
    var sentinel = document.querySelector('.nav-sentinel');
    var nav = document.querySelector('.site-nav');
    if (!sentinel || !nav) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          // Footer is entering viewport — slide nav out
          nav.classList.add('nav-hidden');
        } else {
          // Scrolled back up — show nav again
          nav.classList.remove('nav-hidden');
        }
      });
    }, {
      rootMargin: '0px 0px 0px 0px',
      threshold: 0
    });

    observer.observe(sentinel);
  })();
  } catch(e) { console.error('Gomoku init error:', e); alert('Init error: ' + e.message); }
});

// ============================================================
// PERFORMANCE CACHE INITIALIZATION
// ============================================================

/** Build wood-grain texture once, cache to offscreen canvas */
function buildWoodCache(size) {
  woodCanvas = document.createElement('canvas');
  woodCanvas.width = size;
  woodCanvas.height = size;
  var wctx = woodCanvas.getContext('2d');

  // Base wood tone
  wctx.fillStyle = '#dcb35c';
  wctx.fillRect(0, 0, size, size);

  // Subtle grain lines
  wctx.globalAlpha = 0.12;
  for (var y = 0; y < size; y += 3 + Math.random() * 2) {
    wctx.strokeStyle = y % 6 < 3 ? '#c4963a' : '#e4c86c';
    wctx.lineWidth = 0.8 + Math.random() * 1.2;
    wctx.beginPath();
    wctx.moveTo(0, y + Math.random() * 2);
    for (var x = 0; x < size; x += 40) {
      wctx.lineTo(x, y + (Math.random() - 0.5) * 3);
    }
    wctx.stroke();
  }

  // Darker wood knots
  for (var k = 0; k < 4; k++) {
    var kx = Math.random() * size * 0.7 + size * 0.15;
    var ky = Math.random() * size * 0.7 + size * 0.15;
    var kr = 5 + Math.random() * 15;
    var kgrad = wctx.createRadialGradient(kx, ky, kr * 0.1, kx, ky, kr);
    kgrad.addColorStop(0, 'rgba(120, 80, 20, 0.3)');
    kgrad.addColorStop(0.5, 'rgba(140, 100, 30, 0.15)');
    kgrad.addColorStop(1, 'rgba(180, 140, 50, 0)');
    wctx.fillStyle = kgrad;
    wctx.beginPath();
    wctx.arc(kx, ky, kr, 0, Math.PI * 2);
    wctx.fill();
  }

  wctx.globalAlpha = 1.0;
}

/** Pre-render one black stone and one white stone to offscreen canvases */
function buildStoneCache() {
  var r = stoneRadius;
  var d = r * 2 + 4; // small padding for shadow
  stoneCanvases = {
    black: document.createElement('canvas'),
    white: document.createElement('canvas')
  };

  // --- Black stone ---
  var bc = stoneCanvases.black;
  bc.width = d * 2; bc.height = d * 2;
  var bctx = bc.getContext('2d');
  var cx = d, cy = d;

  // Shadow
  bctx.beginPath();
  bctx.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2);
  bctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  bctx.fill();

  // Stone gradient
  var grad = bctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.05, cx, cy, r);
  grad.addColorStop(0, '#555');
  grad.addColorStop(0.4, '#333');
  grad.addColorStop(1, '#111');
  bctx.beginPath();
  bctx.arc(cx, cy, r, 0, Math.PI * 2);
  bctx.fillStyle = grad;
  bctx.fill();

  // Specular highlight
  var hl = bctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.02, cx - r * 0.25, cy - r * 0.25, r * 0.45);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  hl.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  bctx.beginPath();
  bctx.arc(cx, cy, r, 0, Math.PI * 2);
  bctx.fillStyle = hl;
  bctx.fill();

  // --- White stone ---
  var wc = stoneCanvases.white;
  wc.width = d * 2; wc.height = d * 2;
  var wctx = wc.getContext('2d');
  cx = d; cy = d;

  // Shadow
  wctx.beginPath();
  wctx.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2);
  wctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  wctx.fill();

  // Stone gradient
  var wgrad = wctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
  wgrad.addColorStop(0, '#ffffff');
  wgrad.addColorStop(0.5, '#f0f0ea');
  wgrad.addColorStop(1, '#d4d4cc');
  wctx.beginPath();
  wctx.arc(cx, cy, r, 0, Math.PI * 2);
  wctx.fillStyle = wgrad;
  wctx.fill();

  // Subtle border
  wctx.beginPath();
  wctx.arc(cx, cy, r, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
  wctx.lineWidth = 0.5;
  wctx.stroke();
}

/** Draw all placed stones onto the offscreen stonesCanvas (with DPR scaling) */
function rebuildStonesCache() {
  if (!stonesCanvas) {
    stonesCanvas = document.createElement('canvas');
  }
  stonesCanvas.width = logicalSize * dpr;
  stonesCanvas.height = logicalSize * dpr;
  var sctx = stonesCanvas.getContext('2d');
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.scale(dpr, dpr);

  var r = stoneRadius;
  var d = r * 2 + 4;
  var half = d; // offset because cached stone is drawn centered at (d, d)

  for (var row = 0; row < BOARD_SIZE; row++) {
    for (var col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== EMPTY) {
        var cx = margin + col * cellSize;
        var cy = margin + row * cellSize;
        var key = board[row][col] === BLACK ? 'black' : 'white';
        sctx.drawImage(stoneCanvases[key], cx - half, cy - half);
      }
    }
  }
  stonesDirty = false;
}

// ============================================================
// CANVAS SETUP
// ============================================================
function setupCanvas() {
  dpr = window.devicePixelRatio || 1;
  var wrapper = document.getElementById('boardWrapper');

  // Read the rendered wrapper size.
  // CSS gives wrapper `width:100%; aspect-ratio:1` (square).
  // On mobile: wrapper is `width:100%; max-width:100%` = full-width square.
  var rect = wrapper.getBoundingClientRect();
  logicalSize = Math.round(rect.width);
  if (logicalSize < 100) logicalSize = 100; // safety floor

  // Internal resolution only — CSS controls the visible size (width:100%; height:100%)
  canvas.width = logicalSize * dpr;
  canvas.height = logicalSize * dpr;
  overlayCanvas.width = logicalSize * dpr;
  overlayCanvas.height = logicalSize * dpr;

  margin = logicalSize * 0.06;
  cellSize = (logicalSize - margin * 2) / (BOARD_SIZE - 1);
  stoneRadius = cellSize * 0.43;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Clear overlay
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // Rebuild cached assets
  buildWoodCache(logicalSize);
  buildStoneCache();
  stonesDirty = true;
}

// ============================================================
// DRAWING FUNCTIONS
// ============================================================

function drawBoard() {
  var w = logicalSize;

  // Board background with cached wood texture
  ctx.fillStyle = '#dcb35c';
  ctx.fillRect(0, 0, w, w);
  if (woodCanvas) {
    ctx.drawImage(woodCanvas, 0, 0, w, w);
  }

  // Board border frame
  var framePad = margin * 0.4;
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = 3;
  ctx.strokeRect(framePad, framePad, w - framePad * 2, w - framePad * 2);
  ctx.strokeStyle = '#6b4e0a';
  ctx.lineWidth = 1;
  ctx.strokeRect(framePad + 3, framePad + 3, w - (framePad + 3) * 2, w - (framePad + 3) * 2);

  // Grid lines
  ctx.strokeStyle = '#6b4e0a';
  ctx.lineWidth = 0.7;
  for (var i = 0; i < BOARD_SIZE; i++) {
    var pos = margin + i * cellSize;
    // horizontal
    ctx.beginPath();
    ctx.moveTo(margin, pos);
    ctx.lineTo(w - margin, pos);
    ctx.stroke();
    // vertical
    ctx.beginPath();
    ctx.moveTo(pos, margin);
    ctx.lineTo(pos, w - margin);
    ctx.stroke();
  }

  // Star points
  for (var s = 0; s < STAR_POINTS.length; s++) {
    var sp = STAR_POINTS[s];
    var sx = margin + sp[1] * cellSize;
    var sy = margin + sp[0] * cellSize;
    ctx.beginPath();
    ctx.arc(sx, sy, cellSize * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#5a3e08';
    ctx.fill();
  }

  // Draw all stones via cached offscreen canvas
  if (stonesDirty) {
    rebuildStonesCache();
  }
  if (stonesCanvas) {
    ctx.drawImage(stonesCanvas, 0, 0, logicalSize, logicalSize);
  }

  // Draw last move marker
  if (lastMove && !gameOver) {
    drawLastMoveMarker(lastMove.row, lastMove.col);
  }

  // Draw win line
  if (gameOver && winner && winLine) {
    drawWinLine();
    // Redraw stones on top of the line for winning cells
    for (var wr = 0; wr < BOARD_SIZE; wr++) {
      for (var wc = 0; wc < BOARD_SIZE; wc++) {
        if (board[wr][wc] !== EMPTY) {
          drawStone(wr, wc, board[wr][wc]);
        }
      }
    }
    // Redraw last move marker on top
    if (lastMove) {
      drawLastMoveMarker(lastMove.row, lastMove.col);
    }
  }

  drawOverlay();
}

function addStoneToCache(row, col, player) {
  if (!stonesCanvas || !stoneCanvases) return;
  var sctx = stonesCanvas.getContext('2d');
  // Ensure DPR scaling is applied (may have been reset by width assignment)
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.scale(dpr, dpr);
  var cx = margin + col * cellSize;
  var cy = margin + row * cellSize;
  var r = stoneRadius;
  var d = r * 2 + 4;
  var half = d;
  var key = player === BLACK ? 'black' : 'white';
  sctx.drawImage(stoneCanvases[key], cx - half, cy - half);
}

function drawStone(row, col, player) {
  if (!stoneCanvases) return;
  var cx = margin + col * cellSize;
  var cy = margin + row * cellSize;
  var r = stoneRadius;
  var d = r * 2 + 4;
  var half = d;
  var key = player === BLACK ? 'black' : 'white';
  ctx.drawImage(stoneCanvases[key], cx - half, cy - half);
}

function drawGhostStone(row, col, player) {
  var cx = margin + col * cellSize;
  var cy = margin + row * cellSize;
  var r = stoneRadius;

  overlayCtx.save();
  overlayCtx.globalAlpha = 0.45;

  // Subtle shadow
  overlayCtx.beginPath();
  overlayCtx.arc(cx + 1, cy + 1.5, r, 0, Math.PI * 2);
  overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  overlayCtx.fill();

  if (player === BLACK) {
    // Black ghost stone with 3D gradient
    var grad = overlayCtx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.05, cx, cy, r);
    grad.addColorStop(0, '#666');
    grad.addColorStop(0.4, '#444');
    grad.addColorStop(1, '#222');
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
    overlayCtx.fillStyle = grad;
    overlayCtx.fill();

    // Specular highlight
    var hlGrad = overlayCtx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.02, cx - r * 0.25, cy - r * 0.25, r * 0.45);
    hlGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    hlGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
    hlGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
    overlayCtx.fillStyle = hlGrad;
    overlayCtx.fill();
  } else {
    // White ghost stone with 3D gradient
    var wgrad = overlayCtx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
    wgrad.addColorStop(0, '#ffffff');
    wgrad.addColorStop(0.5, '#f5f5ef');
    wgrad.addColorStop(1, '#dcdcd4');
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
    overlayCtx.fillStyle = wgrad;
    overlayCtx.fill();

    // Border ring
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
    overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    overlayCtx.lineWidth = 0.5;
    overlayCtx.stroke();
  }

  // Pulsing ring to draw attention
  var pulseAlpha = 0.25 + 0.1 * Math.sin(Date.now() / 400);
  overlayCtx.beginPath();
  overlayCtx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  overlayCtx.strokeStyle = 'rgba(255, 255, 255, ' + pulseAlpha + ')';
  overlayCtx.lineWidth = 1.5;
  overlayCtx.stroke();

  overlayCtx.restore();
}

function drawOverlay() {
  // Clear entire overlay canvas (physical pixel coordinates)
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // Nothing to draw if not hovering or game inactive
  if (hoverRow === null || hoverCol === null) return;
  if (gameOver || aiThinking) return;
  if (gameMode === 'pve' && currentPlayer !== humanColor) return;

  // Apply same coordinate transform as main canvas
  overlayCtx.scale(dpr, dpr);

  drawGhostStone(hoverRow, hoverCol, currentPlayer);
}

function drawLastMoveMarker(row, col) {
  var cx = margin + col * cellSize;
  var cy = margin + row * cellSize;
  var mr = stoneRadius * 0.28;

  ctx.beginPath();
  ctx.arc(cx, cy, mr, 0, Math.PI * 2);

  if (board[row][col] === BLACK) {
    ctx.fillStyle = '#ff4444';
  } else {
    ctx.fillStyle = '#cc3333';
  }
  ctx.fill();

  // Small ring around the marker
  ctx.beginPath();
  ctx.arc(cx, cy, mr + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawWinLine() {
  if (!winLine || winLine.length < 5) return;

  var first = winLine[0];
  var last = winLine[winLine.length - 1];

  var x1 = margin + first.col * cellSize;
  var y1 = margin + first.row * cellSize;
  var x2 = margin + last.col * cellSize;
  var y2 = margin + last.row * cellSize;

  // Extend slightly beyond the first and last stone
  var dx = x2 - x1;
  var dy = y2 - y1;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    var ext = stoneRadius * 1.5;
    var ux = dx / len * ext;
    var uy = dy / len * ext;
    x1 -= ux;
    y1 -= uy;
    x2 += ux;
    y2 += uy;
  }

  // Glow effect
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
  ctx.lineWidth = stoneRadius * 1.2;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Core line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(255, 80, 30, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// GAME LOGIC
// ============================================================

function initPreferences() {
  // Set defaults ONLY on first page load — not on reset
  gameMode  = 'pve';
  gameRule  = 'freestyle';
  difficulty = 'medium';
  humanColor = BLACK;
  aiColor   = WHITE;
  soundEnabled = true;
  scores = { black: 0, white: 0, draw: 0 };
}

function resetBoard() {
  // Reset only the board and turn state — keep user preferences intact
  board = [];
  for (var i = 0; i < BOARD_SIZE; i++) {
    board[i] = new Array(BOARD_SIZE).fill(EMPTY);
  }
  moveHistory = [];
  currentPlayer = BLACK;
  aiColor = gameMode === 'pve' ? (humanColor === BLACK ? WHITE : BLACK) : null;
  gameOver = false;
  winner = null;
  winLine = null;
  lastMove = null;
  aiThinking = false;
  renjuFoul = null;
  hoverRow = null;
  hoverCol = null;
  stonesDirty = true;
  stopHoverAnim();

  updateUI();
  drawBoard();
  updateStatus();

  // If PvE and AI is black (human is white), AI moves first
  if (gameMode === 'pve' && humanColor === WHITE) {
    setTimeout(function () { doAIMove(); }, 400);
  }
}

function initGame() {
  initPreferences();
  resetBoard();
}

function resetGame() {
  resetBoard();
  hideVictory();
}

function placeStone(row, col) {
  if (gameOver || aiThinking) return false;
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
  if (board[row][col] !== EMPTY) return false;

  // In PvE mode, only human can place during their turn
  if (gameMode === 'pve' && currentPlayer !== humanColor) return false;

  // Place stone
  board[row][col] = currentPlayer;
  moveHistory.push({ row: row, col: col, player: currentPlayer });
  lastMove = { row: row, col: col };
  hoverRow = null;
  hoverCol = null;
  stopHoverAnim();
  addStoneToCache(row, col, currentPlayer);

  // Renju foul check — only for BLACK in Renju mode
  if (gameRule === 'renju' && currentPlayer === BLACK) {
    var foulType = checkRenjuFoul(row, col, BLACK);
    if (foulType) {
      // Foul move not allowed — undo and show warning
      board[row][col] = EMPTY;
      moveHistory.pop();
      lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
      stonesDirty = true;
      drawBoard();
      showFoulWarning(foulType);
      return false;
    }
  }

  // Check win
  var winResult = checkWin(row, col, currentPlayer);
  if (winResult) {
    gameOver = true;
    winner = currentPlayer;
    winLine = winResult;
    drawBoard();

    if (winner === BLACK) {
      scores.black++;
    } else {
      scores.white++;
    }

    updateScores();
    updateStatus();

    // Show victory after a brief delay
    setTimeout(function () {
      if (gameMode === 'pve') {
        if (winner === humanColor) {
          showVictory('game.you_win_title', 'game.you_win_sub', 'win');
          playWinSound();
        } else {
          showVictory('game.ai_wins_title', 'game.ai_wins_sub', 'lose');
          playLoseSound();
        }
      } else {
        var winKey = winner === BLACK ? 'game.black_wins_title' : 'game.white_wins_title';
        showVictory(winKey, 'game.great_game_sub', 'win');
        playWinSound();
      }
    }, 300);

    return true;
  }

  // Check draw
  if (moveHistory.length >= BOARD_SIZE * BOARD_SIZE) {
    gameOver = true;
    winner = null;
    scores.draw++;
    drawBoard();
    updateScores();
    updateStatus();
    setTimeout(function () {
      showVictory('game.draw_title', 'game.draw_sub', 'draw');
    }, 300);
    return true;
  }

  // Switch player
  currentPlayer = (currentPlayer === BLACK) ? WHITE : BLACK;
  playPlaceSound();
  drawBoard();
  updateStatus();

  // If PvE, trigger AI
  if (gameMode === 'pve' && currentPlayer === aiColor && !gameOver) {
    setTimeout(function () { doAIMove(); }, 150);
  }

  return true;
}

function checkWin(row, col, player) {
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];

    var count = 1;
    var cells = [{ row: row, col: col }];

    // Check in positive direction
    for (var i = 1; i < 5; i++) {
      var nr = row + dr * i;
      var nc = col + dc * i;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === player) {
        count++;
        cells.push({ row: nr, col: nc });
      } else {
        break;
      }
    }

    // Check in negative direction
    for (var j = 1; j < 5; j++) {
      var mr = row - dr * j;
      var mc = col - dc * j;
      if (mr >= 0 && mr < BOARD_SIZE && mc >= 0 && mc < BOARD_SIZE && board[mr][mc] === player) {
        count++;
        cells.unshift({ row: mr, col: mc });
      } else {
        break;
      }
    }

    // In Renju mode, BLACK can only win with exactly 5 (overline=6+ is a foul)
    // WHITE wins normally with 5+ in both modes
    if (gameRule === 'renju' && player === BLACK) {
      if (count === 5) {
        return cells;
      }
      // count > 5 → overline, handled as foul elsewhere
    } else {
      if (count >= 5) {
        return cells;
      }
    }
  }
  return null;
}

function undoMove() {
  if (gameOver || aiThinking) return;
  if (moveHistory.length === 0) return;

  if (gameMode === 'pve') {
    // Undo both human and AI move (if AI moved last)
    if (moveHistory.length >= 2 && moveHistory[moveHistory.length - 1].player === aiColor) {
      var aiMove = moveHistory.pop();
      board[aiMove.row][aiMove.col] = EMPTY;
      var humanMove = moveHistory.pop();
      board[humanMove.row][humanMove.col] = EMPTY;
      lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
    } else if (moveHistory.length >= 1) {
      // Only human moves on the stack (happens if human just moved)
      var hm = moveHistory.pop();
      board[hm.row][hm.col] = EMPTY;
      currentPlayer = hm.player;
      lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
    }
  } else {
    // PvP: undo one move
    var last = moveHistory.pop();
    board[last.row][last.col] = EMPTY;
    currentPlayer = last.player;
    lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
  }

  winLine = null;
  hoverRow = null;
  hoverCol = null;
  stonesDirty = true;
  playUndoSound();
  drawBoard();
  updateStatus();
}

// ============================================================
// CANVAS EVENT HANDLING
// ============================================================

function startHoverAnim() {
  if (hoverAnimId) return;
  function loop() {
    if (hoverRow === null || hoverCol === null || gameOver || aiThinking) {
      hoverAnimId = null;
      return;
    }
    drawOverlay();
    hoverAnimId = requestAnimationFrame(loop);
  }
  hoverAnimId = requestAnimationFrame(loop);
}

function stopHoverAnim() {
  if (hoverAnimId) {
    cancelAnimationFrame(hoverAnimId);
    hoverAnimId = null;
  }
}

function getCanvasPos(e) {
  var rect = canvas.getBoundingClientRect();
  var scaleX = logicalSize / rect.width;
  var scaleY = logicalSize / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function getGridFromPixel(px, py) {
  var col = Math.round((px - margin) / cellSize);
  var row = Math.round((py - margin) / cellSize);

  // Snap check - must be close enough to an intersection
  var snapX = margin + col * cellSize;
  var snapY = margin + row * cellSize;
  var dist = Math.sqrt((px - snapX) * (px - snapX) + (py - snapY) * (py - snapY));

  if (dist > stoneRadius * 1.2) return null;

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;

  return { row: row, col: col };
}

function setupCanvasEvents() {
  canvas.addEventListener('click', function (e) {
    var pos = getCanvasPos(e);
    var grid = getGridFromPixel(pos.x, pos.y);
    if (grid) {
      placeStone(grid.row, grid.col);
    }
  });

  // Touch events for mobile
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var touch = e.touches[0];
    var pos = getCanvasPos(touch);
    var grid = getGridFromPixel(pos.x, pos.y);
    if (grid) {
      placeStone(grid.row, grid.col);
    }
  }, { passive: false });

  // Hover cursor feedback + ghost stone preview
  canvas.addEventListener('mousemove', function (e) {
    if (gameOver || aiThinking) {
      canvas.style.cursor = 'default';
      hoverRow = null;
      hoverCol = null;
      stopHoverAnim();
      drawOverlay();
      return;
    }
    if (gameMode === 'pve' && currentPlayer !== humanColor) {
      canvas.style.cursor = 'default';
      hoverRow = null;
      hoverCol = null;
      stopHoverAnim();
      drawOverlay();
      return;
    }
    var pos = getCanvasPos(e);

    // Find nearest intersection with wider snap range for preview
    var col = Math.round((pos.x - margin) / cellSize);
    var row = Math.round((pos.y - margin) / cellSize);

    // Snap to closest intersection
    var snapX = margin + col * cellSize;
    var snapY = margin + row * cellSize;
    var dist = Math.sqrt((pos.x - snapX) * (pos.x - snapX) + (pos.y - snapY) * (pos.y - snapY));

    // Preview ghost stone if within snap range (wider than click range)
    var previewRange = cellSize * 0.55;
    if (dist <= previewRange && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE && board[row][col] === EMPTY) {
      canvas.style.cursor = 'pointer';
      if (hoverRow !== row || hoverCol !== col) {
        hoverRow = row;
        hoverCol = col;
        startHoverAnim();
      }
    } else {
      canvas.style.cursor = 'default';
      hoverRow = null;
      hoverCol = null;
      stopHoverAnim();
    }

    drawOverlay();
  });

  // Clear ghost stone when mouse leaves the board
  canvas.addEventListener('mouseleave', function () {
    hoverRow = null;
    hoverCol = null;
    stopHoverAnim();
    drawOverlay();
  });
}

// ============================================================
// AI LOGIC
// ============================================================

function doAIMove() {
  if (gameOver) return;
  aiThinking = true;
  updateStatus();

  // Use setTimeout to avoid blocking UI
  setTimeout(function () {
    var move;
    switch (difficulty) {
      case 'easy':   move = easyAI();   break;
      case 'medium': move = mediumAI(); break;
      case 'hard':   move = hardAI();   break;
      case 'master': move = masterAI(); break;
      default:       move = mediumAI(); break;
    }

    if (move) {
      board[move.row][move.col] = aiColor;
      moveHistory.push({ row: move.row, col: move.col, player: aiColor });
      lastMove = { row: move.row, col: move.col };
      stonesDirty = true;

      // Renju foul check for AI black (safety net; candidate moves should already filter)
      if (gameRule === 'renju' && aiColor === BLACK) {
        var aiFoulType = checkRenjuFoul(move.row, move.col, BLACK);
        if (aiFoulType) {
          // Undo and skip — AI should not have chosen this move
          board[move.row][move.col] = EMPTY;
          moveHistory.pop();
          aiThinking = false;
          return;
        }
      }

      var winResult = checkWin(move.row, move.col, aiColor);
      if (winResult) {
        gameOver = true;
        winner = aiColor;
        winLine = winResult;
        drawBoard();
        if (aiColor === BLACK) {
          scores.black++;
        } else {
          scores.white++;
        }
        updateScores();
        updateStatus();
        aiThinking = false;
        setTimeout(function () {
          if (gameMode === 'pve') {
            if (winner === humanColor) {
              showVictory('game.you_win_title', 'game.you_win_sub', 'win');
              playWinSound();
            } else {
              showVictory('game.ai_wins_title', 'game.ai_wins_sub', 'lose');
              playLoseSound();
            }
          }
        }, 300);
        return;
      }

      // Check draw
      if (moveHistory.length >= BOARD_SIZE * BOARD_SIZE) {
        gameOver = true;
        winner = null;
        scores.draw++;
        drawBoard();
        updateScores();
        updateStatus();
        aiThinking = false;
        setTimeout(function () {
          showVictory('game.draw_title', 'game.draw_sub', 'draw');
        }, 300);
        return;
      }

      currentPlayer = humanColor;
      playPlaceSound();
      drawBoard();
      updateStatus();
    }

    aiThinking = false;
    updateStatus();
  }, 50);
}

function getEmptyCells() {
  var cells = [];
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === EMPTY) {
        cells.push({ row: r, col: c });
      }
    }
  }
  return cells;
}

function hasNeighbor(row, col, dist) {
  dist = dist || 2;
  for (var dr = -dist; dr <= dist; dr++) {
    for (var dc = -dist; dc <= dist; dc++) {
      if (dr === 0 && dc === 0) continue;
      var nr = row + dr;
      var nc = col + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] !== EMPTY) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================
// EASY AI — 1-ply shallow eval + randomness (beginner-friendly)
// - Always wins/defends immediate 5-in-a-row threats
// - 85% blocks open-three threats
// - Plays one of the top-scored moves, but often makes mistakes
// ============================================================
function easyAI() {
  // 1. Must-take immediate win
  var winMove = findWinningMove(aiColor);
  if (winMove) return winMove;

  // 2. Must-block opponent's immediate win
  var blockMove = findWinningMove(humanColor);
  if (blockMove) return blockMove;

  // 3. Usually block open-three threats
  if (Math.random() < 0.85) {
    var blockThree = findOpenThreatBlock(humanColor);
    if (blockThree) return blockThree;
  }

  // 4. Evaluate all candidates with a single-ply lookahead
  var candidates = getCandidateMoves(aiColor);
  if (candidates.length === 0) return getOpeningMove();

  candidates.sort(function (a, b) { return b.score - a.score; });

  // Simulate 1-ply: try each candidate and evaluate the resulting position
  var scored = [];
  for (var i = 0; i < candidates.length; i++) {
    var m = candidates[i];
    board[m.row][m.col] = aiColor;
    m.plyScore = evaluateBoard();
    board[m.row][m.col] = EMPTY;
    scored.push(m);
  }
  scored.sort(function (a, b) { return b.plyScore - a.plyScore; });

  // Pick with increasing randomness — decent but not great
  var rand = Math.random();
  if (rand < 0.25) return scored[0];                              // best move
  if (rand < 0.50) return scored[Math.floor(Math.random() * Math.min(3, scored.length))];    // top 3
  if (rand < 0.75) return scored[Math.floor(Math.random() * Math.min(6, scored.length))];    // top 6
  return scored[Math.floor(Math.random() * Math.min(12, scored.length))];                     // top 12 (mistakes likely)
}

// ============================================================
// MEDIUM AI — 2-ply minimax (intermediate challenge)
// - Always wins/defends immediate 5-in-a-row
// - Always blocks open-three threats
// - 2-ply alpha-beta search with weighted random from top moves
// ============================================================
function mediumAI() {
  var winMove = findWinningMove(aiColor);
  if (winMove) return winMove;

  var blockMove = findWinningMove(humanColor);
  if (blockMove) return blockMove;

  var blockThree = findOpenThreatBlock(humanColor);
  if (blockThree) return blockThree;

  // 2-ply minimax
  var candidates = getCandidateMoves(aiColor);
  if (candidates.length === 0) return getOpeningMove();
  candidates.sort(function (a, b) { return b.score - a.score; });

  var maxCandidates = Math.min(15, candidates.length);
  var bestScore = -Infinity;
  var topMoves = [];

  for (var i = 0; i < maxCandidates; i++) {
    var move = candidates[i];
    board[move.row][move.col] = aiColor;
    var score = minimax(2, -Infinity, Infinity, false, humanColor, 12);
    board[move.row][move.col] = EMPTY;

    if (score > bestScore) {
      topMoves = [{ row: move.row, col: move.col, score: score }];
      bestScore = score;
    } else if (score === bestScore) {
      topMoves.push({ row: move.row, col: move.col, score: score });
    }
  }

  // Medium: slight randomness keeps it from being perfect
  if (topMoves.length > 1 && Math.random() < 0.3) {
    topMoves.sort(function (a, b) { return b.score - a.score; });
    var topN = Math.min(2, topMoves.length);
    return topMoves[Math.floor(Math.random() * topN)];
  }
  return topMoves[0];
}

// ============================================================
// HARD AI — 4-ply minimax with pattern eval (advanced player)
// - Always wins/defends 5-in-a-row
// - Always blocks open threats
// - 4-ply alpha-beta with pattern-aware evaluation
// ============================================================
function hardAI() {
  var winMove = findWinningMove(aiColor);
  if (winMove) return winMove;

  var blockMove = findWinningMove(humanColor);
  if (blockMove) return blockMove;

  // Aggressive threat blocking
  var blockThreat = findThreatSequence(humanColor);
  if (blockThreat) return blockThreat;

  // 4-ply minimax
  var candidates = getCandidateMoves(aiColor);
  if (candidates.length === 0) return getOpeningMove();
  candidates.sort(function (a, b) { return b.score - a.score; });

  var maxCandidates = Math.min(20, candidates.length);
  var bestScore = -Infinity;
  var bestMove = candidates[0];

  for (var i = 0; i < maxCandidates; i++) {
    var move = candidates[i];
    board[move.row][move.col] = aiColor;
    var score = minimax(4, -Infinity, Infinity, false, humanColor, 14);
    board[move.row][move.col] = EMPTY;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return { row: bestMove.row, col: bestMove.col };
}

// ============================================================
// MASTER AI — 8-ply iterative deepening with defense-first priority
// - Professional-level play
// - DEFENSE FIRST: blocks all threats before seeking attacks
// - Iterative deepening 2→4→6→8 ply with 30 root candidates
// - Broken/gapped pattern aware evaluation and threat detection
// - VCF / forcing attack detection (offense, used only when safe)
// - Deep threat search (2-ply opponent threat simulation)
// - Adaptive pruning + timeout safety
// ============================================================
function masterAI() {
  // ================================================================
  // TIER 1 — IMMEDIATE WIN: complete 5-in-a-row
  // ================================================================
  var winMove = findWinningMove(aiColor);
  if (winMove) return winMove;

  // ================================================================
  // TIER 1.5 — AI's FORCED WIN: create unstoppable threats
  // (live-four, double-threat). These GUARANTEE victory in 1-2 moves
  // and MUST be played BEFORE any defensive consideration.
  // ================================================================
  var forcedWin = findForcedWin(aiColor);
  if (forcedWin) return forcedWin;

  // ================================================================
  // TIER 2 — IMMEDIATE DEFENSE: block opponent's 5-in-a-row
  // ================================================================
  var blockMove = findWinningMove(humanColor);
  if (blockMove) return blockMove;

  // ================================================================
  // TIER 2.5 — BLOCK OPPONENT FORCED WIN: prevent opponent's
  // live-four or double-threat creation (would guarantee their win)
  // ================================================================
  var forcedBlock = findForcedWin(humanColor);
  if (forcedBlock) return forcedBlock;

  // ================================================================
  // TIER 3 — DEFENSE: detect and block opponent threats
  // ================================================================
  var threatBlock = findThreatSequence(humanColor);
  if (threatBlock) return threatBlock;

  // Deep threat: opponent moves that create unstoppable 2-step sequences
  var deepThreat = findDeepThreatBlock(humanColor);
  if (deepThreat) return deepThreat;

  // ================================================================
  // TIER 3.5 — STRATEGIC DEFENSE: block dangerous developing threes
  // ================================================================
  var blockOpenThree = findOpenThreatBlock(humanColor);
  if (blockOpenThree) {
    // Only block if it significantly improves our defensive position
    var evalBefore = evaluateBoard();
    board[blockOpenThree.row][blockOpenThree.col] = aiColor;
    var evalAfter = evaluateBoard();
    board[blockOpenThree.row][blockOpenThree.col] = EMPTY;
    if (evalAfter - evalBefore > 3000) return blockOpenThree;
  }

  // ================================================================
  // TIER 4 — OFFENSE: only when no immediate defensive needs
  // ================================================================
  var attackMove = findForcingAttack(aiColor);
  if (attackMove) return attackMove;

  // Get candidates with enhanced scoring
  var candidates = getCandidateMoves(aiColor);
  if (candidates.length === 0) return getOpeningMove();
  candidates.sort(function (a, b) { return b.score - a.score; });

  var maxCandidates = Math.min(30, candidates.length);
  var bestMove = candidates[0];
  var bestScore = -Infinity;

  // Safety timeout: 5 seconds max
  var searchDeadline = Date.now() + 5000;

  // Iterative deepening: depth 2 → 4 → 6 → 8 with kill-move ordering
  for (var d = 2; d <= 8; d += 2) {
    // Adaptive pruning: wider at shallow, narrower at deep
    var prune;
    if (d === 2) prune = 18;
    else if (d === 4) prune = 14;
    else if (d === 6) prune = 10;
    else prune = 8;  // depth 8 — tight pruning for speed

    var depthBest = -Infinity;
    var depthMove = candidates[0];

    for (var i = 0; i < maxCandidates; i++) {
      // Timeout check
      if (Date.now() > searchDeadline) break;

      var move = candidates[i];
      board[move.row][move.col] = aiColor;
      var score = minimax(d, -Infinity, Infinity, false, humanColor, prune);
      board[move.row][move.col] = EMPTY;

      // Store score for kill-move ordering in next deeper iteration
      move.iterScore = score;

      if (score > depthBest) {
        depthBest = score;
        depthMove = move;
      }

      // Early exit on timeout within candidate loop
      if (Date.now() > searchDeadline) break;
    }

    // Re-sort candidates by iteration scores for better pruning next round
    candidates.sort(function (a, b) {
      return (b.iterScore || 0) - (a.iterScore || 0);
    });

    bestScore = depthBest;
    bestMove = depthMove;

    // If we found a forced win, stop searching deeper
    if (bestScore > 500000) break;

    // Timeout — stop iterating
    if (Date.now() > searchDeadline) break;
  }

  // Sanity check: ensure the chosen move is near existing stones.
  // If minimax picked a cell isolated from all stones (no neighbor within
  // distance 1), override with the highest-scored candidate that HAS a
  // neighbor. This prevents the AI from "wandering off" when tactical
  // scores are low and centerBonus still pushes toward remote cells.
  if (bestMove && (moveHistory.length > 2)) {
    var hasCloseNeighbor = false;
    var br = bestMove.row, bc = bestMove.col;
    for (var dr = -1; dr <= 1 && !hasCloseNeighbor; dr++) {
      for (var dc = -1; dc <= 1 && !hasCloseNeighbor; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = br + dr, nc = bc + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] !== EMPTY) {
          hasCloseNeighbor = true;
        }
      }
    }
    if (!hasCloseNeighbor) {
      // Override: pick the highest-scored candidate with at least one neighbor
      for (var fi = 0; fi < candidates.length; fi++) {
        var cm = candidates[fi];
        var cmHasNbr = false;
        for (var cdr = -1; cdr <= 1 && !cmHasNbr; cdr++) {
          for (var cdc = -1; cdc <= 1 && !cmHasNbr; cdc++) {
            if (cdr === 0 && cdc === 0) continue;
            var cnr = cm.row + cdr, cnc = cm.col + cdc;
            if (cnr >= 0 && cnr < BOARD_SIZE && cnc >= 0 && cnc < BOARD_SIZE && board[cnr][cnc] !== EMPTY) {
              cmHasNbr = true;
            }
          }
        }
        if (cmHasNbr) {
          bestMove = cm;
          break;
        }
      }
    }
  }

  return { row: bestMove.row, col: bestMove.col };
}

function minimax(depth, alpha, beta, maximizing, player, limitCandidates) {
  if (depth === 0) {
    return evaluateBoard();
  }

  var candidates = getCandidateMoves(player);
  if (candidates.length === 0) return evaluateBoard();

  candidates.sort(function (a, b) { return b.score - a.score; });
  var limit = Math.min(limitCandidates || 10, candidates.length);

  if (maximizing) {
    var maxEval = -Infinity;
    for (var i = 0; i < limit; i++) {
      var move = candidates[i];
      board[move.row][move.col] = player;
      var eval_ = minimax(depth - 1, alpha, beta, false, (player === BLACK) ? WHITE : BLACK);
      board[move.row][move.col] = EMPTY;
      maxEval = Math.max(maxEval, eval_);
      alpha = Math.max(alpha, eval_);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    var minEval = Infinity;
    for (var j = 0; j < limit; j++) {
      var move2 = candidates[j];
      board[move2.row][move2.col] = player;
      var eval2 = minimax(depth - 1, alpha, beta, true, (player === BLACK) ? WHITE : BLACK);
      board[move2.row][move2.col] = EMPTY;
      minEval = Math.min(minEval, eval2);
      beta = Math.min(beta, eval2);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function evaluateBoard() {
  return evalForPlayer(aiColor) - evalForPlayer(humanColor);
}

function evalForPlayer(player) {
  var score = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) {
        // Only count a run starting at (r,c) — skip if previous cell is same player
        var pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < BOARD_SIZE && pc >= 0 && pc < BOARD_SIZE && board[pr][pc] === player) continue;
        if (board[r][c] !== player) continue;

        // Count contiguous stones in the positive direction
        var count = 1;
        var rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && board[rr][cc] === player) {
          count++;
          rr += dr;
          cc += dc;
        }
        var posOpen = (rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && board[rr][cc] === EMPTY);

        // Check negative direction
        var nr = r - dr, nc = c - dc;
        var negOpen = (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === EMPTY);
        var openEnds = (posOpen ? 1 : 0) + (negOpen ? 1 : 0);

        // Score by (count, openEnds)
        // Live four (4, 2 open): will win next move
        // Dead four (4, 1 open): forces block
        // Live three (3, 2 open): very strong
        // Sleep three (3, 1 open): can become four
        // Live two (2, 2 open): developing
        // Sleep two (2, 1 open): weak
        if (count >= 5) {
          score += 10000000;
        } else if (count === 4) {
          if (openEnds === 2)      score += 100000;  // live four
          else if (openEnds === 1) score += 10000;   // dead four
        } else if (count === 3) {
          if (openEnds === 2)      score += 10000;   // live three
          else if (openEnds === 1) score += 1000;    // sleep three
        } else if (count === 2) {
          if (openEnds === 2)      score += 500;     // live two
          else if (openEnds === 1) score += 100;     // sleep two
        } else if (count === 1) {
          if (openEnds === 2)      score += 10;
          else if (openEnds === 1) score += 1;
        }
      }
    }
  }

  // ---- Broken / gapped pattern detection (5-cell sliding window) ----
  // Catches patterns like XXX_X, XX_XX, X_XXX that contiguous scan misses.
  // Each window is scored once to avoid double-counting overlaps.
  var windowVisited = {};  // keyed by "d,r,c" to track scored windows

  for (var d2 = 0; d2 < DIRECTIONS.length; d2++) {
    var dr2 = DIRECTIONS[d2][0];
    var dc2 = DIRECTIONS[d2][1];

    for (var r2 = 0; r2 < BOARD_SIZE; r2++) {
      for (var c2 = 0; c2 < BOARD_SIZE; c2++) {
        // Check if 5-cell window fits
        var endR = r2 + dr2 * 4;
        var endC = c2 + dc2 * 4;
        if (endR < 0 || endR >= BOARD_SIZE || endC < 0 || endC >= BOARD_SIZE) continue;

        // Mark this window as visited (so we don't double-score overlapping ones)
        var wKey = d2 + ',' + r2 + ',' + c2;
        if (windowVisited[wKey]) continue;

        var pStones = 0, oppStones = 0, emptyIdx = -1, stoneIndices = [];
        for (var wi = 0; wi < 5; wi++) {
          var wr = r2 + dr2 * wi;
          var wc = c2 + dc2 * wi;
          if (board[wr][wc] === player) { pStones++; stoneIndices.push(wi); }
          else if (board[wr][wc] === EMPTY) { emptyIdx = wi; }
          else { oppStones++; }
        }

        if (oppStones > 0) continue;  // blocked by opponent stone

        // Mark overlapping windows to avoid double-scoring
        // A broken pattern can span multiple 5-cell windows — score each one
        // but mark windows that share the same stone positions
        windowVisited[wKey] = true;

        if (pStones >= 5) {
          score += 5000000;  // already covered by contiguous scan but belt-and-suspenders
        } else if (pStones === 4) {
          // Any form of four-in-window (XXXX_, _XXXX, XXX_X, XX_XX, X_XXX)
          // — essentially a winning threat that must be blocked
          score += 120000;
        } else if (pStones === 3) {
          // Three stones in a 5-window — developing threat
          // Bonus higher if stones are close together (more threatening)
          if (stoneIndices.length >= 3) {
            var spread = stoneIndices[stoneIndices.length - 1] - stoneIndices[0];
            if (spread <= 3) score += 8000;  // compact three, very threatening
            else score += 3000;              // scattered three
          }
        } else if (pStones === 2) {
          // Two stones in a window — potential
          score += 200;
        }
      }
    }
  }

  return score;
}

function getCandidateMoves(player) {
  var moves = [];
  var center = Math.floor(BOARD_SIZE / 2);

  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;

      // Quick evaluation
      board[r][c] = player;
      var attackScore = quickEval(r, c, player);
      board[r][c] = EMPTY;

      board[r][c] = (player === BLACK) ? WHITE : BLACK;
      var defenseScore = quickEval(r, c, (player === BLACK) ? WHITE : BLACK);
      board[r][c] = EMPTY;

      // Adaptive center bonus: strong early, decays as board fills.
      // Early game: center control matters. Late game: tactical scores dominate.
      // This prevents the AI from "drifting" to center when action is elsewhere.
      var distFromCenter = Math.abs(r - center) + Math.abs(c - center);
      var gameProgress = moveHistory.length / (BOARD_SIZE * BOARD_SIZE);
      var centerWeight = 0.9 * Math.max(0.1, 1 - gameProgress * 5.0);
      // After ~40 moves, center bias is effectively gone
      var centerBonus = (28 - distFromCenter) * centerWeight;

      // Neighbor density: cells surrounded by stones (friendly or enemy)
      // are more relevant. Count stones within Manhattan distance 2.
      var neighborDensity = 0;
      for (var nr2 = r - 2; nr2 <= r + 2; nr2++) {
        for (var nc2 = c - 2; nc2 <= c + 2; nc2++) {
          if (nr2 < 0 || nr2 >= BOARD_SIZE || nc2 < 0 || nc2 >= BOARD_SIZE) continue;
          if (nr2 === r && nc2 === c) continue;
          if (board[nr2][nc2] !== EMPTY) neighborDensity++;
        }
      }
      var densityBonus = neighborDensity * 1.5;
      var score = attackScore + defenseScore * 0.95 + centerBonus + densityBonus;

      // Renju: penalize foul moves for BLACK
      if (gameRule === 'renju' && player === BLACK) {
        var foulType = checkRenjuFoul(r, c, BLACK);
        if (foulType) {
          score = -999999; // effectively removes this move
        }
      }

      moves.push({ row: r, col: c, score: score });
    }
  }

  return moves;
}

function quickEval(row, col, player) {
  var score = 0;

  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];

    var count = 1;
    var openEnds = 0;

    // Positive direction
    var blocked = false;
    for (var i = 1; i < 5; i++) {
      var nr = row + dr * i;
      var nc = col + dc * i;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === player) {
        count++;
      } else {
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === EMPTY) {
          openEnds++;
        }
        break;
      }
    }

    // Negative direction
    for (var j = 1; j < 5; j++) {
      var mr = row - dr * j;
      var mc = col - dc * j;
      if (mr >= 0 && mr < BOARD_SIZE && mc >= 0 && mc < BOARD_SIZE && board[mr][mc] === player) {
        count++;
      } else {
        if (mr >= 0 && mr < BOARD_SIZE && mc >= 0 && mc < BOARD_SIZE && board[mr][mc] === EMPTY) {
          openEnds++;
        }
        break;
      }
    }

    if (count >= 5) {
      score += 10000000;
    } else if (count === 4) {
      score += (openEnds === 2) ? 100000 : 10000;
    } else if (count === 3) {
      score += (openEnds === 2) ? 5000 : 500;
    } else if (count === 2) {
      score += (openEnds === 2) ? 200 : 20;
    } else {
      score += 1;
    }
  }

  return score;
}

function findWinningMove(player) {
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      board[r][c] = player;
      if (checkWin(r, c, player)) {
        board[r][c] = EMPTY;
        return { row: r, col: c };
      }
      board[r][c] = EMPTY;
    }
  }
  return null;
}

// ============================================================
// FORCED WIN DETECTION
// Finds moves that guarantee a win within 1-2 moves.
// These MUST be played before any defensive consideration.
// - Live-four creation: 4 stones + both ends open → opponent can't block both
// - Double-threat creation: two simultaneous winning threats → unstoppable
// ============================================================
function findForcedWin(player) {
  // Priority 1: Create a live-four (guaranteed win next move)
  // 4 stones in a row with BOTH ends open = opponent blocks one end, we take the other
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (!hasNeighbor(r, c, 1)) continue;

      board[r][c] = player;
      var hasLiveFour = false;
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var p = countPattern(r, c, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
        if (p.count === 4 && p.openEnds === 2) {
          hasLiveFour = true;
          break;
        }
      }
      board[r][c] = EMPTY;
      if (hasLiveFour) return { row: r, col: c };
    }
  }

  // Priority 2: Create a double-threat (two separate winning threats)
  // Opponent can block at most one → other threat wins
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (!hasNeighbor(r, c, 1)) continue;

      board[r][c] = player;
      var threatCount = countLiveThreats(r, c, player);
      board[r][c] = EMPTY;

      if (threatCount >= 2) return { row: r, col: c };
    }
  }

  return null;
}

function findOpenThreatBlock(opponent) {
  // Look for opponent's open three (3 in a row with both ends open)
  // and block one end
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;

      for (var d = 0; d < DIRECTIONS.length; d++) {
        var dr = DIRECTIONS[d][0];
        var dc = DIRECTIONS[d][1];

        // Place opponent stone temporarily and check pattern
        board[r][c] = opponent;

        var count = 1;
        var openEnds = 0;

        // Positive
        for (var i = 1; i < 5; i++) {
          var nr = r + dr * i;
          var nc = c + dc * i;
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === opponent) {
            count++;
          } else {
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === EMPTY) {
              openEnds++;
            }
            break;
          }
        }

        // Negative
        for (var j = 1; j < 5; j++) {
          var mr = r - dr * j;
          var mc = c - dc * j;
          if (mr >= 0 && mr < BOARD_SIZE && mc >= 0 && mc < BOARD_SIZE && board[mr][mc] === opponent) {
            count++;
          } else {
            if (mr >= 0 && mr < BOARD_SIZE && mc >= 0 && mc < BOARD_SIZE && board[mr][mc] === EMPTY) {
              openEnds++;
            }
            break;
          }
        }

        board[r][c] = EMPTY;

        // Open three or open four
        if ((count === 3 && openEnds === 2) || (count === 4 && openEnds >= 1)) {
          return { row: r, col: c };
        }
      }
    }
  }
  return null;
}

// ============================================================
// OPENING / THREAT / ATTACK HELPERS
// ============================================================

// Deep threat detection: find opponent moves that lead to unstoppable sequences
// Uses 2-ply lookahead and broken-pattern awareness
function findDeepThreatBlock(opponent) {
  var threatMoves = [];

  // Phase 1: scan all cells for potential threat positions
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;

      board[r][c] = opponent;
      var threatCount = countLiveThreats(r, c, opponent);
      board[r][c] = EMPTY;

      if (threatCount >= 2) {
        // Double threat — this cell is the immediate block position
        threatMoves.push({ row: r, col: c, severity: 100 });
      } else if (threatCount === 1) {
        // Single threat — check if after our block, opponent still creates another threat
        threatMoves.push({ row: r, col: c, severity: 1 });
      }
      // NOTE: severity=0.5 (developing patterns) removed.
      // Too many false positives — every cell near stones qualifies.
    }
  }

  if (threatMoves.length === 0) return null;

  // Sort by severity descending
  threatMoves.sort(function (a, b) { return b.severity - a.severity; });

  // Phase 2: for each threat position, do 2-ply verification
  for (var i = 0; i < Math.min(8, threatMoves.length); i++) {
    var tm = threatMoves[i];

    board[tm.row][tm.col] = opponent;

    // Find all our possible block positions for this threat
    var blocksToTest = findAllBlockPositions(tm.row, tm.col, opponent);
    if (blocksToTest.length === 0) {
      // No blocks possible — this is an immediate win for opponent
      // (should have been caught earlier, but belt-and-suspenders)
      board[tm.row][tm.col] = EMPTY;
      return tm;
    }

    var allUnstoppable = true;

    for (var j = 0; j < blocksToTest.length; j++) {
      var block = blocksToTest[j];
      board[block.row][block.col] = aiColor; // our block

      // After our block, does opponent have any winning threat anywhere?
      var stillThreatened = false;
      for (var rr = 0; rr < BOARD_SIZE && !stillThreatened; rr++) {
        for (var cc = 0; cc < BOARD_SIZE && !stillThreatened; cc++) {
          if (board[rr][cc] !== EMPTY) continue;
          if (!hasNeighbor(rr, cc, 2)) continue;

          // Check if opponent playing here creates any threat
          board[rr][cc] = opponent;
          var threatsAfterBlock = countLiveThreats(rr, cc, opponent);
          // Also check for win directly
          if (threatsAfterBlock >= 1 || checkWin(rr, cc, opponent)) stillThreatened = true;
          board[rr][cc] = EMPTY;
        }
      }

      board[block.row][block.col] = EMPTY; // undo our block

      if (!stillThreatened) {
        allUnstoppable = false;
        break; // at least one block works — this threat is survivable
      }
    }

    board[tm.row][tm.col] = EMPTY;

    if (allUnstoppable) return tm; // must block this position preemptively
  }

  return null;
}

// Find all reasonable block positions for a threat cell (including broken patterns)
function findAllBlockPositions(row, col, player) {
  var blocks = [];
  var seen = {}; // deduplicate

  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];

    // Check contiguous pattern
    var p = countPattern(row, col, dr, dc, player);
    if (p.count >= 4 && p.openEnds >= 1) {
      // Forward open end
      var fr = row + dr * p.count;
      var fc = col + dc * p.count;
      if (fr >= 0 && fr < BOARD_SIZE && fc >= 0 && fc < BOARD_SIZE) {
        var key = fr + ',' + fc;
        if (!seen[key]) { seen[key] = true; blocks.push({ row: fr, col: fc }); }
      }
      // Backward open end
      fr = row - dr;
      fc = col - dc;
      if (fr >= 0 && fr < BOARD_SIZE && fc >= 0 && fc < BOARD_SIZE) {
        key = fr + ',' + fc;
        if (!seen[key]) { seen[key] = true; blocks.push({ row: fr, col: fc }); }
      }
    }

    // Also find gaps in broken patterns (XXX_X → block the one empty in the window)
    // Scan each 5-cell window including (row,col)
    for (var start = -4; start <= 0; start++) {
      var stones = 0, opps = 0, emptyCells = [];
      for (var wi = 0; wi < 5; wi++) {
        var wr = row + dr * (start + wi);
        var wc = col + dc * (start + wi);
        if (wr < 0 || wr >= BOARD_SIZE || wc < 0 || wc >= BOARD_SIZE) { opps = 99; break; }
        if (wr === row && wc === col) { stones++; }
        else if (board[wr][wc] === player) { stones++; }
        else if (board[wr][wc] === EMPTY) { emptyCells.push({ row: wr, col: wc }); }
        else { opps++; break; }
      }
      // Broken four: 4 stones, 1 empty, no opponent → block the empty
      if (stones >= 4 && opps === 0 && emptyCells.length >= 1) {
        for (var ei = 0; ei < emptyCells.length; ei++) {
          var ek = emptyCells[ei].row + ',' + emptyCells[ei].col;
          if (!seen[ek]) { seen[ek] = true; blocks.push(emptyCells[ei]); }
        }
      }
    }
  }

  // If no specific blocks found, try adjacent cells
  if (blocks.length === 0) {
    for (var dr2 = -1; dr2 <= 1; dr2++) {
      for (var dc2 = -1; dc2 <= 1; dc2++) {
        var nr = row + dr2, nc = col + dc2;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === EMPTY) {
          var key = nr + ',' + nc;
          if (!seen[key]) { seen[key] = true; blocks.push({ row: nr, col: nc }); }
        }
      }
    }
  }
  return blocks;
}

// Count how many non-immediate developing patterns (live-twos, broken-threes, etc.)
// a position participates in — used to detect "quiet setup" moves
function countDevelopingPatterns(row, col, player) {
  var count = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];

    // Scan 5-cell windows for 2-3 stones with room to grow
    for (var start = -4; start <= 0; start++) {
      var stones = 0, opps = 0, includesCell = false;
      for (var wi = 0; wi < 5; wi++) {
        var wr = row + dr * (start + wi);
        var wc = col + dc * (start + wi);
        if (wr < 0 || wr >= BOARD_SIZE || wc < 0 || wc >= BOARD_SIZE) { opps = 99; break; }
        if (wr === row && wc === col) { stones++; includesCell = true; }
        else if (board[wr][wc] === player) { stones++; }
        else if (board[wr][wc] !== EMPTY) { opps++; break; }
      }
      if (includesCell && stones >= 2 && stones <= 3 && opps === 0) {
        count++;
        break; // one pattern per direction
      }
    }
  }
  return count;
}

function getOpeningMove() {
  var center = Math.floor(BOARD_SIZE / 2);
  if (board[center][center] === EMPTY) return { row: center, col: center };

  var moves = [];
  for (var dr = -2; dr <= 2; dr++) {
    for (var dc = -2; dc <= 2; dc++) {
      var r = center + dr, c = center + dc;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === EMPTY) {
        moves.push({ row: r, col: c });
      }
    }
  }
  if (moves.length > 0) {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  var any = getEmptyCells();
  return any.length > 0 ? any[Math.floor(Math.random() * any.length)] : null;
}

// Find multi-step threats (live-4, broken-4, double live-3) that need blocking now
function findThreatSequence(opponent) {
  var candidates = [];

  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;

      board[r][c] = opponent;
      var threatCount = countLiveThreats(r, c, opponent);
      board[r][c] = EMPTY;

      if (threatCount >= 2) return { row: r, col: c };          // double threat — must block immediately
      if (threatCount === 1) candidates.push({ row: r, col: c }); // single threat, consider blocking
    }
  }

  // Also check for live-three that threatens to become live-four
  // (including broken threes: XX_X type patterns that need one stone for live-four)
  for (var i = 0; i < candidates.length; i++) {
    var cm = candidates[i];
    board[cm.row][cm.col] = opponent;
    // Check contiguous patterns only — broken threes are too common
    // and must be evaluated by the minimax search, not hard-blocked.
    var liveDanger = 0;
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var dr = DIRECTIONS[d][0];
      var dc = DIRECTIONS[d][1];
      var p = countPattern(cm.row, cm.col, dr, dc, opponent);
      if (p.count >= 4 && p.openEnds >= 1) liveDanger++;
      else if (p.count === 3 && p.openEnds === 2) liveDanger++;
    }
    board[cm.row][cm.col] = EMPTY;
    // Only block if there's at least one real threat (not just a developing pattern)
    if (liveDanger >= 1) return cm;
  }

  return null;
}

// Detect if placing at (row,col) creates a broken-three (3 stones in 5-window
// with at least 2 empties remaining, threatening to become broken-four next)
function detectBrokenThree(row, col, dr, dc, player) {
  for (var start = -4; start <= 0; start++) {
    var stones = 0, opps = 0, includesCell = false, empties = [];
    for (var wi = 0; wi < 5; wi++) {
      var wr = row + dr * (start + wi);
      var wc = col + dc * (start + wi);
      if (wr < 0 || wr >= BOARD_SIZE || wc < 0 || wc >= BOARD_SIZE) { opps = 99; break; }
      if (wr === row && wc === col) { stones++; includesCell = true; }
      else if (board[wr][wc] === player) { stones++; }
      else if (board[wr][wc] === EMPTY) { empties.push(wi); }
      else { opps++; break; }
    }
    // 3 stones with at least 2 free cells = developing three
    if (includesCell && stones === 3 && opps === 0 && empties.length >= 2) {
      // Check the empties are at the ends or adjacent → growing potential
      return true;
    }
  }
  return false;
}

// Count how many winning threats exist at a position (contiguous + broken/gapped)
// A "winning threat" = 4+ stones in any 5-cell window including (row,col)
// Examples detected: contiguous XXXX_, broken XXX_X, XX_XX, X_XXX
function countLiveThreats(row, col, player) {
  var count = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0];
    var dc = DIRECTIONS[d][1];

    // ---- Check contiguous (standard pattern) ----
    var p = countPattern(row, col, dr, dc, player);
    if (p.count >= 4 && p.openEnds >= 1) { count++; continue; }

    // ---- Check broken/gapped patterns in 5-cell sliding windows ----
    // Scan every 5-cell window that includes (row,col)
    for (var start = -4; start <= 0; start++) {
      var stones = 0, opps = 0, includesCell = false;
      for (var wi = 0; wi < 5; wi++) {
        var wr = row + dr * (start + wi);
        var wc = col + dc * (start + wi);
        if (wr < 0 || wr >= BOARD_SIZE || wc < 0 || wc >= BOARD_SIZE) { opps = 99; break; }
        if (wr === row && wc === col) { stones++; includesCell = true; }
        else if (board[wr][wc] === player) { stones++; }
        else if (board[wr][wc] !== EMPTY) { opps++; break; }
      }
      // 4 stones in a 5-window → broken four, must be blocked (leads to 5 next move)
      if (includesCell && stones >= 4 && opps === 0) { count++; break; }
      // NOTE: developing threes (3 stones in 5-window) are NOT counted here.
      // They are too common and cause false positives in defensive checks.
      // Offensive detection uses countDevelopingPatterns() separately.
    }
  }
  return count;
}

// Look for a forcing attack sequence (double-threat creation)
function findForcingAttack(player) {
  // Find moves that create multiple open threats simultaneously
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;

      board[r][c] = player;
      var threats = countLiveThreats(r, c, player);
      board[r][c] = EMPTY;

      if (threats >= 2) return { row: r, col: c };  // double threat = forced win
    }
  }

  // Check for open-three that leads to forced win
  var candidates = [];
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;

      var hasLiveThree = false;
      board[r][c] = player;
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var pp = countPattern(r, c, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
        if (pp.count === 3 && pp.openEnds === 2) {
          hasLiveThree = true;
          break;
        }
      }
      board[r][c] = EMPTY;
      if (hasLiveThree) candidates.push({ row: r, col: c });
    }
  }

  if (candidates.length > 0) {
    // Evaluate which live-three position is most dangerous (can extend to live-4)
    var best = candidates[0];
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      board[candidates[i].row][candidates[i].col] = player;
      var s = evalForPlayer(player);
      board[candidates[i].row][candidates[i].col] = EMPTY;
      if (s > bestScore) { bestScore = s; best = candidates[i]; }
    }
    return best;
  }

  return null;
}

// Count contiguous stone pattern starting from (row,col) in direction (dr,dc)
function countPattern(row, col, dr, dc, player) {
  var count = 1;
  var openEnds = 0;

  // Positive direction
  var r = row + dr, c = col + dc;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count++;
    r += dr;
    c += dc;
  }
  if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === EMPTY) openEnds++;

  // Negative direction
  r = row - dr; c = col - dc;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count++;
    r -= dr;
    c -= dc;
  }
  if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === EMPTY) openEnds++;

  return { count: count, openEnds: openEnds };
}

// ============================================================
// RENJU (连珠) FOUL DETECTION
// ============================================================

/**
 * Master foul check for Renju rules.
 * Returns null if no foul, or the foul type string.
 * Only BLACK can foul in Renju. WHITE has no restrictions.
 */
function checkRenjuFoul(row, col, player) {
  if (player !== BLACK || gameRule !== 'renju') return null;

  // 1. Overline (长连禁手): 6+ consecutive stones
  if (isOverline(row, col, player)) return 'overline';

  // 2. Double-four (四四禁手): two independent fours
  if (isDoubleFour(row, col, player)) return 'doubleFour';

  // 3. Double-three (三三禁手): two independent live threes
  if (isDoubleThree(row, col, player)) return 'doubleThree';

  return null;
}

/**
 * Check if placing at (row,col) creates 6+ consecutive stones.
 */
function isOverline(row, col, player) {
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var pat = countPattern(row, col, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
    if (pat.count >= 6) return true;
  }
  return false;
}

/**
 * Check if placing at (row,col) creates two or more "fours".
 * A "four" = 4+ consecutive stones with at least one open end.
 */
function isDoubleFour(row, col, player) {
  var fourCount = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var pat = countPattern(row, col, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
    if (pat.count >= 4 && pat.openEnds >= 1) {
      fourCount++;
    }
  }
  return fourCount >= 2;
}

/**
 * Check if placing at (row,col) creates two or more "live threes".
 * A live three can become an open four on the next move.
 * Two types: connected (_XXX_) and one-gap (_XX_X or _X_XX).
 */
function isDoubleThree(row, col, player) {
  var threeCount = 0;

  for (var d = 0; d < DIRECTIONS.length; d++) {
    var dr = DIRECTIONS[d][0], dc = DIRECTIONS[d][1];

    // 1. Connected live three: exactly 3 consecutive, both ends open
    var pat = countPattern(row, col, dr, dc, player);
    if (pat.count === 3 && pat.openEnds === 2) {
      threeCount++;
      continue;
    }

    // 2. One-gap live three (jump pattern)
    if (hasJumpThree(row, col, dr, dc, player)) {
      threeCount++;
    }
  }

  return threeCount >= 2;
}

/**
 * Check if there's a one-gap live three in a specific direction.
 * Pattern: user has 3 stones with one 1-cell gap in a 5-cell span,
 * and can fill the gap to create an open four.
 * Valid patterns: _XX_X_, _X_XX_ (both ends open).
 */
function hasJumpThree(row, col, dr, dc, player) {
  // Build 5-cell windows that include (row,col)
  // Window start offset from -2 to 0 (so row,col is inside the window)
  for (var start = -2; start <= 0; start++) {
    if (start + 4 > 4) continue; // center offset max in this impl

    var cells = [];
    var boundsOk = true;
    for (var k = 0; k < 5; k++) {
      var r = row + dr * (start + k);
      var c = col + dc * (start + k);
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        cells.push(board[r][c]);
      } else {
        boundsOk = false;
        break;
      }
    }
    if (!boundsOk) continue;

    var pStones = 0, pEmpty = 0, opponent = 0;
    for (var ki = 0; ki < 5; ki++) {
      if (cells[ki] === player) pStones++;
      else if (cells[ki] === EMPTY) pEmpty++;
      else opponent++;
    }

    if (pStones !== 3 || pEmpty !== 2 || opponent !== 0) continue;

    // Check jump patterns: XX_X_ or _XX_X or X_XX_ or _X_XX
    // Pattern where one empty is the "gap" between stones
    var isJump = false;
    if (cells[0] === player && cells[1] === player && cells[2] === EMPTY && cells[3] === player) isJump = true;
    if (cells[1] === player && cells[2] === player && cells[3] === EMPTY && cells[4] === player) isJump = true;
    if (cells[0] === player && cells[1] === EMPTY && cells[2] === player && cells[3] === player) isJump = true;
    if (cells[1] === player && cells[2] === EMPTY && cells[3] === player && cells[4] === player) isJump = true;

    if (!isJump) continue;

    // For a LIVE jump-three, both ends of the 5-cell must be empty
    if (cells[0] !== EMPTY || cells[4] !== EMPTY) continue;

    // Also check cells just outside: must be empty or boundary
    var rBefore = row + dr * (start - 1);
    var cBefore = col + dc * (start - 1);
    var rAfter = row + dr * (start + 5);
    var cAfter = col + dc * (start + 5);

    var leftOpen = (rBefore < 0 || rBefore >= BOARD_SIZE || cBefore < 0 || cBefore >= BOARD_SIZE) ||
                   (board[rBefore][cBefore] === EMPTY);
    var rightOpen = (rAfter < 0 || rAfter >= BOARD_SIZE || cAfter < 0 || cAfter >= BOARD_SIZE) ||
                    (board[rAfter][cAfter] === EMPTY);

    if (leftOpen && rightOpen) return true;
  }
  return false;
}

// ============================================================
// UI HANDLERS
// ============================================================

function setupUI() {
  // Helper: safe addEventListener
  function _on(id, event, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  // Mode buttons
  _on('btnPvE', 'click', function () { switchMode('pve'); });
  _on('btnPvP', 'click', function () { switchMode('pvp'); });

  // Difficulty buttons
  _on('btnEasy', 'click', function () { switchDifficulty('easy'); });
  _on('btnMedium', 'click', function () { switchDifficulty('medium'); });
  _on('btnHard', 'click', function () { switchDifficulty('hard'); });
  _on('btnMaster', 'click', function () { switchDifficulty('master'); });

  // Color buttons
  _on('btnBlack', 'click', function () { switchColor(BLACK); });
  _on('btnWhite', 'click', function () { switchColor(WHITE); });

  // Action buttons
  _on('btnUndo', 'click', undoMove);
  _on('btnRestart', 'click', resetGame);
  _on('btnSound', 'click', toggleSound);
  _on('btnPlayAgain', 'click', resetGame);

  // Rule buttons (may not exist on all pages)
  _on('btnFreestyle', 'click', function () { switchRule('freestyle'); });
  _on('btnRenju', 'click', function () { switchRule('renju'); });
}



function switchMode(mode) {
  if (gameMode === mode) return;
  gameMode = mode;

  document.getElementById('btnPvE').classList.toggle('active', mode === 'pve');
  document.getElementById('btnPvE').setAttribute('aria-checked', mode === 'pve');
  document.getElementById('btnPvP').classList.toggle('active', mode === 'pvp');
  document.getElementById('btnPvP').setAttribute('aria-checked', mode === 'pvp');

  // Disable difficulty and color in PvP
  var diffBtns = document.querySelectorAll('#difficultyGroup .toggle-btn, #colorGroup .toggle-btn');
  var isPvP = mode === 'pvp';
  for (var i = 0; i < diffBtns.length; i++) {
    diffBtns[i].disabled = isPvP;
  }

  resetGame();
}

function switchDifficulty(diff) {
  difficulty = diff;

  document.getElementById('btnEasy').classList.toggle('active', diff === 'easy');
  document.getElementById('btnEasy').setAttribute('aria-checked', diff === 'easy');
  document.getElementById('btnMedium').classList.toggle('active', diff === 'medium');
  document.getElementById('btnMedium').setAttribute('aria-checked', diff === 'medium');
  document.getElementById('btnHard').classList.toggle('active', diff === 'hard');
  document.getElementById('btnHard').setAttribute('aria-checked', diff === 'hard');
  document.getElementById('btnMaster').classList.toggle('active', diff === 'master');
  document.getElementById('btnMaster').setAttribute('aria-checked', diff === 'master');

  if (gameMode === 'pve') {
    resetGame();
  }
}

function switchColor(color) {
  if (gameMode === 'pvp') return;
  humanColor = color;
  aiColor = (color === BLACK) ? WHITE : BLACK;

  document.getElementById('btnBlack').classList.toggle('active', color === BLACK);
  document.getElementById('btnBlack').setAttribute('aria-checked', color === BLACK);
  document.getElementById('btnWhite').classList.toggle('active', color === WHITE);
  document.getElementById('btnWhite').setAttribute('aria-checked', color === WHITE);

  resetGame();
}

function switchRule(rule) {
  if (gameRule === rule) return;
  gameRule = rule;

  var btnFree = document.getElementById('btnFreestyle');
  var btnRenju = document.getElementById('btnRenju');
  if (btnFree) {
    btnFree.classList.toggle('active', rule === 'freestyle');
    btnFree.setAttribute('aria-checked', rule === 'freestyle');
  }
  if (btnRenju) {
    btnRenju.classList.toggle('active', rule === 'renju');
    btnRenju.setAttribute('aria-checked', rule === 'renju');
  }

  renjuFoul = null;
  resetGame();
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  var btn = document.getElementById('btnSound');
  var icon = btn.querySelector('.sound-icon');
  var span = btn.querySelector('.sound-text');
  if (soundEnabled) {
    if (icon) icon.textContent = '\u266A';
    if (span) span.textContent = _t('game.sound_on', 'Sound');
    btn.style.opacity = '1';
  } else {
    if (icon) icon.textContent = '\uD83D\uDD07';
    if (span) span.textContent = _t('game.sound_off', 'Muted');
    btn.style.opacity = '0.6';
  }
}

function updateUI() {
  document.getElementById('btnPvE').classList.toggle('active', gameMode === 'pve');
  document.getElementById('btnPvP').classList.toggle('active', gameMode === 'pvp');
  document.getElementById('btnEasy').classList.toggle('active', difficulty === 'easy');
  document.getElementById('btnMedium').classList.toggle('active', difficulty === 'medium');
  document.getElementById('btnHard').classList.toggle('active', difficulty === 'hard');
  document.getElementById('btnMaster').classList.toggle('active', difficulty === 'master');
  document.getElementById('btnBlack').classList.toggle('active', humanColor === BLACK);
  document.getElementById('btnWhite').classList.toggle('active', humanColor === WHITE);

  var btnFreestyle = document.getElementById('btnFreestyle');
  var btnRenju = document.getElementById('btnRenju');
  if (btnFreestyle) {
    btnFreestyle.classList.toggle('active', gameRule === 'freestyle');
    btnFreestyle.setAttribute('aria-checked', gameRule === 'freestyle');
  }
  if (btnRenju) {
    btnRenju.classList.toggle('active', gameRule === 'renju');
    btnRenju.setAttribute('aria-checked', gameRule === 'renju');
  }

  var isPvP = gameMode === 'pvp';
  var diffBtns = document.querySelectorAll('#difficultyGroup .toggle-btn, #colorGroup .toggle-btn');
  for (var i = 0; i < diffBtns.length; i++) {
    diffBtns[i].disabled = isPvP;
  }

  updateScores();
}


// ============================================================
// TRANSLATION HELPERS (used by game functions)
// ============================================================

// Helper: get translated string via window.__t (safe fallback to English)
function _t(key, en) {
  if (typeof window.__t === 'function') {
    var v = window.__t(key);
    if (v !== key) return v;
  }
  return en || key;
}

// Show Renju foul warning (visible toast + status bar highlight)
var _foulWarningTimer = null;
function showFoulWarning(foulType) {
  var text = document.getElementById('statusText');
  var toast = document.getElementById('renjuFoulToast');
  var backdrop = document.getElementById('renjuFoulBackdrop');
  // Cancel any previous warning timer
  if (_foulWarningTimer) { clearTimeout(_foulWarningTimer); _foulWarningTimer = null; }

  var foulKeys = {
    'overline':   'game.renju_warn_overline',
    'doubleThree': 'game.renju_warn_doubleThree',
    'doubleFour':  'game.renju_warn_doubleFour'
  };
  var key = foulKeys[foulType] || 'game.foul_warning_title';

  // Get translated strings via window.__t directly (skip _t wrapper for reliability)
  var hasT = typeof window.__t === 'function';
  var label  = hasT ? window.__t('game.foul_warning_title', 'Foul Not Allowed') : 'Foul Not Allowed';
  var detail = hasT ? window.__t(key, 'This move is forbidden for Black') : 'This move is forbidden for Black';
  var msg = label + ': ' + detail;

  // 1) Update status bar text
  if (text) {
    text.textContent = msg;
    text.classList.add('warning');
  }
  // 2) Show popup overlay (fixed center, always visible regardless of scroll)
  if (backdrop) { backdrop.classList.add('show'); }
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
  }

  // Restore normal status after 2.5 seconds
  _foulWarningTimer = setTimeout(function () {
    _foulWarningTimer = null;
    if (text) text.classList.remove('warning');
    if (toast) toast.classList.remove('show');
    if (backdrop) backdrop.classList.remove('show');
    updateStatus();
  }, 2500);
}

function updateStatus() {
  var dot = document.getElementById('statusDot');
  var text = document.getElementById('statusText');

  dot.className = 'status-dot';
  if (currentPlayer === BLACK) {
    dot.classList.add('black');
  } else {
    dot.classList.add('white');
  }

  if (gameOver) {
    if (winner) {
      if (gameMode === 'pve') {
        if (winner === humanColor) {
          text.textContent = _t('game.you_win', 'You win! \u2014 Nice game');
        } else {
          text.textContent = _t('game.ai_wins', 'AI wins \u2014 Try again?');
        }
      } else {
        var winLabel = winner === BLACK ? _t('game.black', 'Black') : _t('game.white', 'White');
        text.textContent = winLabel + ' ' + _t('game.wins', 'wins!');
      }
    } else {
      text.textContent = _t('game.draw', "It's a draw!");
    }
  } else if (aiThinking) {
    text.textContent = _t('game.ai_thinking', 'AI is thinking...');
  } else {
    var playerLabel = currentPlayer === BLACK ? _t('game.black', 'Black') : _t('game.white', 'White');
    if (gameMode === 'pve') {
      if (currentPlayer === humanColor) {
        text.textContent = _t('game.your_turn', 'Your turn') + ' \u2014 ' + playerLabel;
      } else {
        text.textContent = _t('game.ai_turn', "AI's turn") + ' \u2014 ' + playerLabel;
      }
    } else {
      text.textContent = playerLabel + _t('game.turn_suffix', "'s turn");
    }
  }
}

function updateScores() {
  document.getElementById('scoreBlack').textContent = scores.black;
  document.getElementById('scoreWhite').textContent = scores.white;
  document.getElementById('scoreDraw').textContent = scores.draw;
}

/* =============================================
   Victory Celebration Effects
   ============================================= */

// --- Star Burst ---
var BURST_STAR_CHARS = ['\u2B50','\u2728','\u2733','\u2734','\u2606','\u2729','\u2736','\u2737'];
var BURST_COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff6bff','#ff9a56','#56d4c4','#c77dff'];

function createStarBurst() {
  var wrap = document.getElementById('starBurst');
  if (!wrap) return;
  wrap.innerHTML = '';
  var count = 10;
  for (var i = 0; i < count; i++) {
    var star = document.createElement('span');
    star.className = 'burst-star';
    star.textContent = BURST_STAR_CHARS[Math.floor(Math.random() * BURST_STAR_CHARS.length)];
    var angle = (360 / count) * i + (Math.random() - 0.5) * 20;
    var dist = 100 + Math.random() * 60;
    var rad = angle * Math.PI / 180;
    var bx = Math.cos(rad) * dist;
    var by = Math.sin(rad) * dist;
    star.style.setProperty('--bx', bx + 'px');
    star.style.setProperty('--by', by + 'px');
    star.style.color = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
    star.style.fontSize = (0.7 + Math.random() * 0.7) + 'rem';
    star.style.animationDelay = (Math.random() * 0.15) + 's';
    wrap.appendChild(star);
    // trigger animation
    requestAnimationFrame(function (s) { return function () { s.classList.add('animate'); }; }(star));
  }
}

function clearStarBurst() {
  var wrap = document.getElementById('starBurst');
  if (wrap) wrap.innerHTML = '';
}

/* =============================================
   Victory / Defeat Overlay
   ============================================= */

function showVictory(titleKey, subtitleKey, type) {
  var overlay = document.getElementById('victoryOverlay');
  var card = document.getElementById('victoryCard');

  // Inline translation table — works even if i18n.js fails to load
  var lang = document.documentElement.lang || 'en';
  var texts = {
    en: {
      'game.you_win_title': 'You Win!',
      'game.you_win_sub': 'Excellent match! You outplayed the AI.',
      'game.ai_wins_title': 'AI Wins!',
      'game.ai_wins_sub': 'The computer won this round. Try again!',
      'game.black_wins_title': 'Black Wins!',
      'game.white_wins_title': 'White Wins!',
      'game.great_game_sub': 'Great game!',
      'game.draw_title': "It's a Draw!",
      'game.draw_sub': 'The board is full. Well played!',
      'game.renju_warn_overline': 'Overline is forbidden for Black',
      'game.renju_warn_doubleThree': 'Double-Three is forbidden for Black',
      'game.renju_warn_doubleFour': 'Double-Four is forbidden for Black',
      'game.foul_warning_title': 'Foul Not Allowed'
    },
    'zh-CN': {
      'game.you_win_title': '你赢了！',
      'game.you_win_sub': '出色的对局！你击败了 AI。',
      'game.ai_wins_title': 'AI 获胜！',
      'game.ai_wins_sub': '电脑赢得了本轮。再试一次！',
      'game.black_wins_title': '黑棋获胜！',
      'game.white_wins_title': '白棋获胜！',
      'game.great_game_sub': '精彩的比赛！',
      'game.draw_title': '平局！',
      'game.draw_sub': '棋盘已满。比赛精彩！',
      'game.renju_warn_overline': '长连禁手，黑棋不可下此位置',
      'game.renju_warn_doubleThree': '三三禁手，黑棋不可下此位置',
      'game.renju_warn_doubleFour': '四四禁手，黑棋不可下此位置',
      'game.foul_warning_title': '禁手提示'
    }
  };

  function resolve(key) {
    if (texts[lang] && texts[lang][key]) return texts[lang][key];
    if (typeof window.__t === 'function') {
      var v = window.__t(key);
      if (v !== key) return v;
    }
    return (texts['en'][key]) || key;
  }

  document.getElementById('victoryTitle').textContent = resolve(titleKey);
  document.getElementById('victorySubtitle').textContent = resolve(subtitleKey);

  // Reset card class
  card.className = 'victory-card';

  var icon = document.getElementById('victoryIcon');
  if (type === 'win') {
    icon.textContent = '\u2605';
    card.classList.add('win');
    createStarBurst();
  } else if (type === 'lose') {
    icon.textContent = '\u2620';
    card.classList.add('lose');
    clearStarBurst();
  } else {
    icon.textContent = '\u2248';
    card.classList.add('draw');
    clearStarBurst();
  }

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideVictory() {
  var overlay = document.getElementById('victoryOverlay');
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  clearStarBurst();
}
