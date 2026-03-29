/* ─────────────────────────────────────────────
   Punch-n-Hit  |  game.js
───────────────────────────────────────────── */
'use strict';

// ── Canvas / face geometry ────────────────────
const CW = 320, CH = 460;       // canvas size
const FCX = 160, FCY = 103, FCR = 72; // face circle centre & radius

// ── Game constants ────────────────────────────
const MAX_HP      = 100;
const HIT_DURATION = 340;       // ms chibi stays in "hit" pose
const COMBO_RESET  = 1200;      // ms of inactivity to reset combo
const MODELS_URL   = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

const HIT_WORDS   = ['POW!','BAM!','HIT!','SMACK!','WHAM!','BONK!','ZAP!','CRACK!'];
const HEAVY_WORDS = ['SUPER!','ULTRA!','MEGA!','CRITICAL!'];
const HIT_COLORS  = ['#ffd93d','#ff6b6b','#4ecdc4','#96e6a1','#ff9ff3','#74b9ff'];

// ── State ─────────────────────────────────────
let faceCanvas = null;
let skinIndex  = 0;
let hp         = MAX_HP;
let hitCount   = 0;
let combo      = 0;
let comboTimer = null;
let isHitting  = false;
let hitStart   = 0;
let hitTilt    = 0;          // +1 or -1
let isKO       = false;
let audioCtx   = null;
let faceApiOK  = false;
let rafId      = null;

// ── DOM refs ──────────────────────────────────
const uploadScreen  = document.getElementById('upload-screen');
const gameScreen    = document.getElementById('game-screen');
const dropZone      = document.getElementById('drop-zone');
const fileInput     = document.getElementById('file-input');
const previewSec    = document.getElementById('preview-section');
const previewCanvas = document.getElementById('preview-canvas');
const faceStatus    = document.getElementById('face-status');
const startBtn      = document.getElementById('start-btn');
const backBtn       = document.getElementById('back-btn');
const nextBtn       = document.getElementById('next-btn');
const hpFill        = document.getElementById('hp-fill');
const hpNum         = document.getElementById('hp-num');
const comboLabel    = document.getElementById('combo-label');
const hitTally      = document.getElementById('hit-tally');
const gameCanvas    = document.getElementById('game-canvas');
const fxLayer       = document.getElementById('fx');
const koOverlay     = document.getElementById('ko-overlay');
const hpTrack       = document.querySelector('.hp-track');

const gctx = gameCanvas.getContext('2d');

// ── roundRect polyfill ────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const R = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + R, y);
    this.arcTo(x + w, y, x + w, y + h, R);
    this.arcTo(x + w, y + h, x, y + h, R);
    this.arcTo(x, y + h, x, y, R);
    this.arcTo(x, y, x + w, y, R);
    this.closePath();
    return this;
  };
}

// ══════════════════════════════════════════════
//  SOUND  (Web Audio API synthesis)
// ══════════════════════════════════════════════
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playHitSound(strength = 1) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // Oscillator "crack"
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.connect(g); g.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180 * strength, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  g.gain.setValueAtTime(0.55 * strength, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.start(t); osc.stop(t + 0.14);

  // Noise burst
  const len = Math.ceil(audioCtx.sampleRate * 0.08);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);

  const ns = audioCtx.createBufferSource();
  ns.buffer = buf;
  const flt = audioCtx.createBiquadFilter();
  flt.type = 'bandpass'; flt.frequency.value = 900 + 600 * strength;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.35 * strength, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  ns.connect(flt); flt.connect(ng); ng.connect(audioCtx.destination);
  ns.start(t);
}

function playKOSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // Descending tone
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.connect(g); g.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.9);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
  osc.start(t); osc.stop(t + 0.95);

  // Impact chord
  [280, 360, 450].forEach((f, i) => {
    const o2 = audioCtx.createOscillator();
    const g2 = audioCtx.createGain();
    o2.connect(g2); g2.connect(audioCtx.destination);
    o2.type = 'sine'; o2.frequency.value = f;
    g2.gain.setValueAtTime(0.28, t + 0.05 * i);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    o2.start(t + 0.05 * i); o2.stop(t + 1.4);
  });
}

// ══════════════════════════════════════════════
//  CANVAS HELPERS
// ══════════════════════════════════════════════
function rRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Draw the face circle (user photo clipped to circle, or placeholder)
function drawFaceCircle(ctx, img) {
  // Base circle (skin colour fallback)
  ctx.fillStyle = '#f5cba7';
  ctx.beginPath();
  ctx.arc(FCX, FCY, FCR, 0, Math.PI * 2);
  ctx.fill();

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(FCX, FCY, FCR - 2, 0, Math.PI * 2);
    ctx.clip();
    const s = FCR * 2;
    ctx.drawImage(img, FCX - FCR, FCY - FCR, s, s);
    ctx.restore();
  } else {
    // Placeholder face
    ctx.fillStyle = '#2c3e50';
    [FCX - 22, FCX + 22].forEach(ex => {
      ctx.beginPath(); ctx.arc(ex, FCY - 6, 7, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(FCX, FCY + 18, 18, 0, Math.PI);
    ctx.stroke();
  }

  // Ring
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(FCX, FCY, FCR, 0, Math.PI * 2);
  ctx.stroke();
}

// ══════════════════════════════════════════════
//  BACKGROUND
// ══════════════════════════════════════════════
function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, CH);
  grad.addColorStop(0, '#110820');
  grad.addColorStop(.65, '#1e0a30');
  grad.addColorStop(1, '#0a0a1a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, CW, CH);

  // Platform shadow
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.beginPath();
  ctx.ellipse(CW / 2, CH - 14, 108, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ambient glow
  const glow = ctx.createRadialGradient(CW / 2, CH * .48, 40, CW / 2, CH * .48, 180);
  glow.addColorStop(0, 'rgba(150,40,230,.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, CW, CH);
}

// ══════════════════════════════════════════════
//  CHIBI CHARACTER DRAWERS
//  Each function draws the FULL character (body + face + hair).
//  Parameters: ctx, faceImg (or null), dmgLevel (0-3)
// ══════════════════════════════════════════════

// ── Shared body helper ───────────────────────
// Draws torso, arms, legs, feet in the given colours.
// Caller may overdraw details on top.
function drawBody(ctx, c) {
  const {primary, secondary, skin, shoe} = c;

  // Neck
  ctx.fillStyle = skin;
  rRect(ctx, 141, 172, 38, 33, 8); ctx.fill();

  // Torso
  ctx.fillStyle = primary;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6;
  rRect(ctx, 88, 205, 144, 114, 16); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // Left arm
  ctx.fillStyle = primary;
  rRect(ctx, 57, 210, 36, 98, 12); ctx.fill();
  // Right arm
  rRect(ctx, 227, 210, 36, 98, 12); ctx.fill();

  // Left hand
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(75, 318, 18, 0, Math.PI * 2); ctx.fill();
  // Right hand
  ctx.beginPath(); ctx.arc(245, 318, 18, 0, Math.PI * 2); ctx.fill();

  // Left leg
  ctx.fillStyle = secondary;
  rRect(ctx, 99, 316, 50, 102, 12); ctx.fill();
  // Right leg
  rRect(ctx, 171, 316, 50, 102, 12); ctx.fill();

  // Feet
  ctx.fillStyle = shoe;
  ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 4;
  ctx.beginPath(); ctx.ellipse(124, 426, 28, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(196, 426, 28, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

// ── 0 · WARRIOR ───────────────────────────────
function drawWarrior(ctx, faceImg, dmg) {
  const c = {
    primary: '#c0392b', secondary: '#922b21',
    skin: '#f5cba7', shoe: '#2c3e50', accent: '#f1c40f'
  };

  // Aura
  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(192,57,43,.12)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  // Shield (behind left arm)
  ctx.fillStyle = '#566573';
  rRect(ctx, 20, 225, 46, 72, 10); ctx.fill();
  ctx.fillStyle = c.accent;
  ctx.beginPath(); ctx.moveTo(43, 232); ctx.lineTo(43, 290); ctx.moveTo(20, 261); ctx.lineTo(66, 261);
  ctx.strokeStyle = c.accent; ctx.lineWidth = 4; ctx.stroke();

  drawBody(ctx, c);

  // Belt
  ctx.fillStyle = c.accent;
  rRect(ctx, 88, 284, 144, 18, 4); ctx.fill();

  // Sword (right side)
  ctx.save();
  ctx.translate(258, 240); ctx.rotate(0.35);
  ctx.fillStyle = '#aab7b8'; rRect(ctx, -5, 0, 10, 80, 3); ctx.fill();
  ctx.fillStyle = c.accent;  rRect(ctx, -14, 0, 28, 10, 3); ctx.fill(); // guard
  ctx.fillStyle = '#7f8c8d'; rRect(ctx, -3, -22, 6, 24, 2); ctx.fill(); // pommel
  ctx.restore();

  drawFaceCircle(ctx, faceImg);

  // Spiky hair
  ctx.fillStyle = '#1a1a2a';
  const spikes = [[-30,-12,18,42],[-10,-20,14,40],[10,-22,14,42],[28,-16,16,38],[42,-8,14,32]];
  spikes.forEach(([ox, oy, w, h]) => {
    ctx.beginPath();
    ctx.moveTo(FCX + ox, FCY + oy + h);
    ctx.lineTo(FCX + ox + w/2, FCY + oy);
    ctx.lineTo(FCX + ox + w, FCY + oy + h);
    ctx.closePath(); ctx.fill();
  });
}

// ── 1 · MAGE ──────────────────────────────────
function drawMage(ctx, faceImg, dmg) {
  const c = {
    primary: '#8e44ad', secondary: '#6c3483',
    skin: '#f5cba7', shoe: '#4a235a', accent: '#f1c40f'
  };

  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(142,68,173,.14)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  // Cape behind body
  ctx.fillStyle = '#6c3483';
  ctx.beginPath();
  ctx.moveTo(90, 220); ctx.lineTo(40, 420); ctx.lineTo(280, 420); ctx.lineTo(230, 220);
  ctx.closePath(); ctx.fill();

  drawBody(ctx, c);

  // Stars on robe
  ctx.fillStyle = c.accent;
  [[130,245],[175,270],[150,300]].forEach(([sx, sy]) => drawStar(ctx, sx, sy, 8, 5));

  // Wand (right hand)
  ctx.save(); ctx.translate(252, 240); ctx.rotate(-0.3);
  ctx.fillStyle = '#5d6d7e'; rRect(ctx, -3, 0, 6, 85, 3); ctx.fill();
  ctx.restore();
  // Star tip of wand
  ctx.fillStyle = c.accent; drawStar(ctx, 262, 228, 14, 5);

  drawFaceCircle(ctx, faceImg);

  // Pointy hat
  ctx.fillStyle = '#5b2c6f';
  ctx.beginPath();
  ctx.moveTo(FCX, FCY - FCR - 68);
  ctx.lineTo(FCX - 60, FCY - FCR + 4);
  ctx.lineTo(FCX + 60, FCY - FCR + 4);
  ctx.closePath(); ctx.fill();
  // Hat brim
  ctx.fillStyle = '#7d3c98';
  rRect(ctx, FCX - 68, FCY - FCR - 2, 136, 20, 8); ctx.fill();
  // Star on hat
  ctx.fillStyle = c.accent; drawStar(ctx, FCX, FCY - FCR - 40, 12, 5);
}

// ── 2 · NINJA ─────────────────────────────────
function drawNinja(ctx, faceImg, dmg) {
  const c = {
    primary: '#2c3e50', secondary: '#1a252f',
    skin: '#f5cba7', shoe: '#1a1a1a', accent: '#e74c3c'
  };

  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(44,62,80,.18)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  drawBody(ctx, c);

  // Red sash
  ctx.fillStyle = c.accent;
  ctx.save(); ctx.translate(CW/2, 286); ctx.rotate(-0.06);
  rRect(ctx, -72, -10, 144, 20, 4); ctx.fill();
  ctx.restore();

  // Leg wraps (stripes)
  ctx.strokeStyle = '#566573'; ctx.lineWidth = 3;
  [328,345,362,378,395].forEach(ly => {
    ctx.beginPath(); ctx.moveTo(100, ly); ctx.lineTo(148, ly); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(172, ly); ctx.lineTo(220, ly); ctx.stroke();
  });

  // Shuriken (left hand)
  ctx.save(); ctx.translate(68, 318);
  ctx.fillStyle = '#aab7b8';
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.rotate(i * Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(16,-2); ctx.lineTo(6,0); ctx.lineTo(16,2); ctx.lineTo(0,6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  drawFaceCircle(ctx, faceImg);

  // Headband
  ctx.fillStyle = c.accent;
  rRect(ctx, FCX - FCR - 6, FCY - 22, (FCR + 6) * 2, 16, 4); ctx.fill();
  // Headband tails
  ctx.beginPath();
  ctx.moveTo(FCX + FCR, FCY - 14);
  ctx.bezierCurveTo(FCX + FCR + 30, FCY + 10, FCX + FCR + 20, FCY + 40, FCX + FCR + 10, FCY + 50);
  ctx.lineWidth = 10; ctx.strokeStyle = c.accent; ctx.stroke();
}

// ── 3 · ARCHER ────────────────────────────────
function drawArcher(ctx, faceImg, dmg) {
  const c = {
    primary: '#1e8449', secondary: '#145a32',
    skin: '#f5cba7', shoe: '#6d4c41', accent: '#f39c12'
  };

  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(30,132,73,.13)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  // Quiver on back
  ctx.fillStyle = '#8b6914';
  rRect(ctx, 218, 200, 26, 70, 6); ctx.fill();
  // Arrows in quiver
  ctx.strokeStyle = '#cd853f'; ctx.lineWidth = 3;
  [225,231,237].forEach(ax => {
    ctx.beginPath(); ctx.moveTo(ax, 200); ctx.lineTo(ax, 150); ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.moveTo(ax-4,152); ctx.lineTo(ax,142); ctx.lineTo(ax+4,152); ctx.closePath(); ctx.fill();
  });

  drawBody(ctx, c);

  // Belt
  ctx.fillStyle = '#8b6914'; rRect(ctx, 88, 278, 144, 16, 4); ctx.fill();

  // Bow (left arm extended left)
  ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(50, 260, 50, -0.9, 0.9); ctx.stroke();
  // Bowstring
  ctx.strokeStyle = '#deb887'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(50, 213); ctx.lineTo(50, 307); ctx.stroke();

  // Arrow drawn back (right hand)
  ctx.strokeStyle = '#cd853f'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(90, 260); ctx.lineTo(240, 260); ctx.stroke();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.moveTo(90,254); ctx.lineTo(78,260); ctx.lineTo(90,266); ctx.closePath(); ctx.fill();

  drawFaceCircle(ctx, faceImg);

  // Hood
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.arc(FCX, FCY - 10, FCR + 16, Math.PI, 0);
  ctx.lineTo(FCX + FCR + 16, FCY + 20);
  ctx.bezierCurveTo(FCX + 40, FCY + 55, FCX - 40, FCY + 55, FCX - FCR - 16, FCY + 20);
  ctx.closePath(); ctx.fill();
  // Feather
  ctx.fillStyle = '#3498db';
  ctx.beginPath();
  ctx.moveTo(FCX + 8, FCY - FCR - 6);
  ctx.bezierCurveTo(FCX + 28, FCY - FCR - 38, FCX + 42, FCY - FCR - 28, FCX + 20, FCY - FCR - 4);
  ctx.closePath(); ctx.fill();
}

// ── 4 · BRAWLER ───────────────────────────────
function drawBrawler(ctx, faceImg, dmg) {
  const c = {
    primary: '#e67e22', secondary: '#d35400',
    skin: '#f5cba7', shoe: '#ecf0f1', accent: '#e74c3c'
  };

  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(230,126,34,.13)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  drawBody(ctx, c);

  // Hoodie pocket
  ctx.fillStyle = c.secondary; rRect(ctx, 130, 275, 60, 44, 8); ctx.fill();
  // Shoe soles
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath(); ctx.ellipse(124, 435, 28, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(196, 435, 28, 8, 0, 0, Math.PI * 2); ctx.fill();

  // Boxing gloves (replace hands)
  ctx.fillStyle = c.accent;
  ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.ellipse(68, 312, 28, 24, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(252, 312, 28, 24, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Glove highlight
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.beginPath(); ctx.ellipse(62, 304, 12, 8, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(246, 304, 12, 8, 0.3, 0, Math.PI * 2); ctx.fill();

  drawFaceCircle(ctx, faceImg);

  // Baseball cap
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(FCX, FCY - 30, FCR - 6, Math.PI, 0);
  ctx.lineTo(FCX + FCR - 6, FCY - 30);
  ctx.closePath(); ctx.fill();
  // Brim
  ctx.fillStyle = '#1a252f';
  rRect(ctx, FCX - FCR - 16, FCY - 44, (FCR + 16) * 2, 15, 6); ctx.fill();
  // Cap logo
  ctx.fillStyle = c.accent; drawStar(ctx, FCX, FCY - 55, 10, 5);
}

// ── 5 · KNIGHT ────────────────────────────────
function drawKnight(ctx, faceImg, dmg) {
  const c = {
    primary: '#aab7b8', secondary: '#717d7e',
    skin: '#f5cba7', shoe: '#4d5656', accent: '#f1c40f'
  };

  const aura = ctx.createRadialGradient(CW/2, 280, 20, CW/2, 280, 170);
  aura.addColorStop(0, 'rgba(170,183,184,.10)'); aura.addColorStop(1, 'transparent');
  ctx.fillStyle = aura; ctx.fillRect(0, 0, CW, CH);

  // Shield (left)
  ctx.fillStyle = '#717d7e';
  rRect(ctx, 18, 215, 52, 78, 14); ctx.fill();
  ctx.fillStyle = c.accent;
  ctx.beginPath(); ctx.moveTo(44,222); ctx.lineTo(44,286); ctx.moveTo(18,254); ctx.lineTo(70,254);
  ctx.strokeStyle = c.accent; ctx.lineWidth = 5; ctx.stroke();

  drawBody(ctx, c);

  // Breastplate detail
  ctx.strokeStyle = c.accent; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CW/2, 212); ctx.lineTo(CW/2, 318);
  ctx.moveTo(100, 250); ctx.lineTo(220, 250);
  ctx.stroke();

  // Shoulder pauldrons
  ctx.fillStyle = c.primary;
  ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.ellipse(82, 215, 30, 18, -0.3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(238, 215, 30, 18, 0.3, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Pauldron trim
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(82, 215, 30, 18, -0.3, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(238, 215, 30, 18, 0.3, 0, Math.PI*2); ctx.stroke();

  // Greaves
  ctx.fillStyle = '#95a5a6';
  rRect(ctx, 99, 355, 50, 44, 4); ctx.fill();
  rRect(ctx, 171, 355, 50, 44, 4); ctx.fill();
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
  rRect(ctx, 99, 355, 50, 44, 4); ctx.stroke();
  rRect(ctx, 171, 355, 50, 44, 4); ctx.stroke();

  // Sword (right side)
  ctx.save(); ctx.translate(255, 240); ctx.rotate(0.3);
  ctx.fillStyle = '#bdc3c7'; rRect(ctx, -6, 0, 12, 95, 3); ctx.fill();
  ctx.fillStyle = c.accent;  rRect(ctx, -18, 0, 36, 12, 3); ctx.fill();
  ctx.fillStyle = '#95a5a6'; rRect(ctx, -4, -28, 8, 30, 2); ctx.fill();
  ctx.restore();

  drawFaceCircle(ctx, faceImg);

  // Gorget / armor collar
  ctx.fillStyle = c.primary;
  rRect(ctx, 128, 168, 64, 40, 10); ctx.fill();
  ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
  rRect(ctx, 128, 168, 64, 40, 10); ctx.stroke();

  // Plume (feather on top)
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.moveTo(FCX, FCY - FCR - 4);
  ctx.bezierCurveTo(FCX - 18, FCY - FCR - 52, FCX + 22, FCY - FCR - 68, FCX + 4, FCY - FCR - 4);
  ctx.closePath(); ctx.fill();
}

// ── 5-pointed star helper ─────────────────────
function drawStar(ctx, cx, cy, r, pts = 5) {
  const step = Math.PI / pts;
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const angle = i * step - Math.PI / 2;
    const rad   = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ── Skin registry ─────────────────────────────
const SKINS = [
  { name: 'Warrior', draw: drawWarrior },
  { name: 'Mage',    draw: drawMage    },
  { name: 'Ninja',   draw: drawNinja   },
  { name: 'Archer',  draw: drawArcher  },
  { name: 'Brawler', draw: drawBrawler },
  { name: 'Knight',  draw: drawKnight  },
];

// ── Damage overlay ────────────────────────────
function drawDamageOverlay(ctx, dmgLevel, hitProgress) {
  if (dmgLevel === 0) return;
  // Darkening vignette gets stronger with damage
  const alpha = dmgLevel * 0.06;
  const vig = ctx.createRadialGradient(CW/2, CH/2, 60, CW/2, CH/2, 200);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, `rgba(180,0,0,${alpha})`);
  ctx.fillStyle = vig; ctx.fillRect(0, 0, CW, CH);

  // Cracks / sweat as simple dots at high damage
  if (dmgLevel >= 2) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    [[92,190],[232,195],[155,168]].forEach(([dx,dy]) => {
      ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill();
    });
  }
}

// ── Hit flash overlay ─────────────────────────
function drawHitFlash(ctx, hitProgress) {
  if (hitProgress <= 0) return;
  const alpha = (1 - hitProgress) * 0.45;
  ctx.fillStyle = `rgba(255,60,60,${alpha})`;
  ctx.fillRect(0, 0, CW, CH);
}

// ══════════════════════════════════════════════
//  FACE DETECTION / EXTRACTION
// ══════════════════════════════════════════════
async function loadFaceApiModels() {
  if (typeof faceapi === 'undefined') return;
  try {
    await faceapi.loadTinyFaceDetectorModel(MODELS_URL);
    faceApiOK = true;
  } catch (e) {
    console.warn('face-api models failed to load – using centre-crop fallback:', e.message);
  }
}

// Returns an offscreen canvas 144×144 with the extracted face.
async function extractFace(imgEl) {
  const SIZE = FCR * 2; // 144
  const off = document.createElement('canvas');
  off.width = off.height = SIZE;
  const oc = off.getContext('2d');

  let sx, sy, sw, sh;

  if (faceApiOK) {
    try {
      const det = await faceapi.detectSingleFace(
        imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
      );
      if (det) {
        const b   = det.box;
        const pad = b.width * 0.42;
        sx = Math.max(0, b.x  - pad);
        sy = Math.max(0, b.y  - pad * 1.1);
        sw = Math.min(imgEl.naturalWidth  - sx, b.width  + pad * 2);
        sh = Math.min(imgEl.naturalHeight - sy, b.height + pad * 2.4);
      }
    } catch (e) { /* fallback below */ }
  }

  if (!sx) {
    // Centre-square crop, shifted slightly upward (faces tend to be upper half)
    const s = Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
    sx = (imgEl.naturalWidth  - s) / 2;
    sy = (imgEl.naturalHeight - s) / 2 * 0.55;
    sw = sh = s;
  }

  oc.drawImage(imgEl, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
  return off;
}

// ══════════════════════════════════════════════
//  GAME RENDER LOOP
// ══════════════════════════════════════════════
function getDamageLevel() {
  if (hp > 75) return 0;
  if (hp > 50) return 1;
  if (hp > 25) return 2;
  return 3;
}

function render(ts) {
  if (isKO) return;

  gctx.clearRect(0, 0, CW, CH);
  drawBackground(gctx);

  // Hit animation progress (0 = just hit, 1 = recovered)
  let hitProg = 0;
  if (isHitting) {
    hitProg = Math.min((ts - hitStart) / HIT_DURATION, 1);
    if (hitProg >= 1) isHitting = false;
  }

  const dmgLevel = getDamageLevel();

  // Wobble that intensifies with damage level
  const wobble = dmgLevel >= 2 ? Math.sin(ts * 0.006) * dmgLevel * 1.8 : 0;
  // Hit tilt
  const tiltDeg = isHitting ? hitTilt * (1 - hitProg) * 14 : wobble;

  gctx.save();
  if (tiltDeg !== 0) {
    gctx.translate(CW / 2, CH * 0.52);
    gctx.rotate(tiltDeg * Math.PI / 180);
    gctx.translate(-CW / 2, -CH * 0.52);
  }
  // Bounce down then back on hit
  if (isHitting) {
    const bounce = Math.sin(hitProg * Math.PI) * -10;
    gctx.translate(0, -bounce);
  }

  SKINS[skinIndex].draw(gctx, faceCanvas, dmgLevel);
  drawDamageOverlay(gctx, dmgLevel, hitProg);
  drawHitFlash(gctx, hitProg);

  gctx.restore();

  rafId = requestAnimationFrame(render);
}

// ══════════════════════════════════════════════
//  HIT LOGIC
// ══════════════════════════════════════════════
function handleHit(cx, cy) {
  if (isKO) return;
  initAudio();

  hp = Math.max(0, hp - 1);
  hitCount++;
  combo++;

  // Combo timer reset
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; updateComboLabel(); }, COMBO_RESET);

  // Hit animation
  isHitting = true;
  hitStart  = performance.now();
  hitTilt   = Math.random() > 0.5 ? 1 : -1;

  // Canvas shake
  gameCanvas.classList.remove('hit-shake');
  void gameCanvas.offsetWidth; // reflow to restart animation
  gameCanvas.classList.add('hit-shake');

  // Sound
  const strength = combo >= 5 ? 1.5 : 1;
  playHitSound(strength);

  // Effects
  spawnHitText(cx, cy);
  spawnSparks(cx, cy);

  // UI
  updateHP();
  updateComboLabel();
  hitTally.textContent = hitCount + ' hits';

  if (hp <= 0) {
    setTimeout(triggerKO, 280);
  }
}

// ── Convert click/touch → canvas coords ───────
function toCanvasCoords(e) {
  const rect  = gameCanvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

// ══════════════════════════════════════════════
//  VISUAL EFFECTS
// ══════════════════════════════════════════════
function spawnHitText(cx, cy) {
  const rect   = gameCanvas.getBoundingClientRect();
  const scaleX = rect.width  / CW;
  const scaleY = rect.height / CH;

  const words = combo >= 5 ? HEAVY_WORDS : HIT_WORDS;
  const word  = words[Math.floor(Math.random() * words.length)];
  const color = HIT_COLORS[Math.floor(Math.random() * HIT_COLORS.length)];

  const el = document.createElement('div');
  el.className = 'hit-text';
  el.textContent = word;
  el.style.color = color;
  el.style.left  = (cx * scaleX) + 'px';
  el.style.top   = (cy * scaleY) + 'px';
  el.style.fontSize = combo >= 5 ? '2.1rem' : '1.7rem';
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function spawnSparks(cx, cy) {
  const rect   = gameCanvas.getBoundingClientRect();
  const scaleX = rect.width  / CW;
  const scaleY = rect.height / CH;
  const count  = combo >= 5 ? 12 : 7;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist  = 28 + Math.random() * 44;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;

    const el = document.createElement('div');
    el.className = 'spark';
    el.style.backgroundColor = HIT_COLORS[i % HIT_COLORS.length];
    el.style.left = (cx * scaleX) + 'px';
    el.style.top  = (cy * scaleY) + 'px';
    el.style.setProperty('--tx', tx + 'px');
    el.style.setProperty('--ty', ty + 'px');
    el.style.width  = (4 + Math.random() * 6) + 'px';
    el.style.height = el.style.width;
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 560);
  }
}

// ══════════════════════════════════════════════
//  HP BAR
// ══════════════════════════════════════════════
function updateHP() {
  const pct = (hp / MAX_HP) * 100;
  hpFill.style.width = pct + '%';
  hpNum.textContent = hp;
  hpTrack.setAttribute('aria-valuenow', hp);

  hpFill.classList.remove('warn', 'crit');
  if (pct <= 25)      hpFill.classList.add('crit');
  else if (pct <= 55) hpFill.classList.add('warn');
}

function updateComboLabel() {
  if (combo >= 3) {
    comboLabel.textContent = combo + '× COMBO!';
    comboLabel.style.animation = 'none';
    void comboLabel.offsetWidth;
    comboLabel.style.animation = '';
  } else {
    comboLabel.textContent = '';
  }
}

// ══════════════════════════════════════════════
//  K.O.
// ══════════════════════════════════════════════
function triggerKO() {
  isKO = true;
  cancelAnimationFrame(rafId);
  playKOSound();

  // Final frame: draw character collapsed
  gctx.clearRect(0, 0, CW, CH);
  drawBackground(gctx);
  gctx.save();
  gctx.translate(CW / 2, CH * 0.55);
  gctx.rotate(0.45);
  gctx.translate(-CW / 2, -CH * 0.55);
  SKINS[skinIndex].draw(gctx, faceCanvas, 3);
  gctx.restore();
  // Dark overlay
  gctx.fillStyle = 'rgba(0,0,0,.4)'; gctx.fillRect(0, 0, CW, CH);
  // Lose face: clear faceCanvas so it must be re-uploaded
  faceCanvas = null;

  koOverlay.hidden = false;
}

// ══════════════════════════════════════════════
//  SCREEN TRANSITIONS
// ══════════════════════════════════════════════
function showUploadScreen() {
  gameScreen.classList.remove('active');
  uploadScreen.classList.add('active');

  cancelAnimationFrame(rafId);
  isKO = false; hp = MAX_HP; hitCount = 0; combo = 0;
  koOverlay.hidden = true;
  previewSec.hidden = true;
  faceStatus.textContent = 'Detecting face…';
  updateHP();
  hitTally.textContent = '0 hits';
  comboLabel.textContent = '';
}

function showGameScreen() {
  uploadScreen.classList.remove('active');
  gameScreen.classList.add('active');
  isKO = false;
  koOverlay.hidden = true;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(render);
}

// ══════════════════════════════════════════════
//  IMAGE UPLOAD FLOW
// ══════════════════════════════════════════════
async function handleImage(file) {
  if (!file || !file.type.startsWith('image/')) return;

  faceStatus.textContent = 'Loading image…';
  previewSec.hidden = false;

  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise(r => { img.onload = r; });

  faceStatus.textContent = faceApiOK ? 'Detecting face…' : 'Cropping face…';

  try {
    const extracted = await extractFace(img);
    faceCanvas = extracted;

    // Show preview
    const pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, 160, 160);
    pctx.save();
    pctx.beginPath(); pctx.arc(80, 80, 78, 0, Math.PI * 2); pctx.clip();
    pctx.drawImage(extracted, 0, 0, 144, 144, 2, 2, 156, 156);
    pctx.restore();

    faceStatus.textContent = faceApiOK ? '✅ Face detected!' : '✅ Image cropped!';
  } catch (e) {
    faceStatus.textContent = '⚠️ Could not process image';
    console.error(e);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

// ══════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════

// Drop zone click / keyboard
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

// File input
fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) handleImage(f);
  fileInput.value = '';
});

// Drag & drop
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleImage(f);
});

// Skin picker
document.querySelectorAll('.skin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const v = btn.dataset.skin;
    skinIndex = v === 'random'
      ? Math.floor(Math.random() * SKINS.length)
      : parseInt(v, 10);
  });
});

// Start button
startBtn.addEventListener('click', () => {
  if (!faceCanvas) { faceStatus.textContent = '⚠️ Please upload an image first!'; return; }
  // Pick random skin if "random" btn was last active
  const activeSkin = document.querySelector('.skin-btn.active');
  if (activeSkin && activeSkin.dataset.skin === 'random') {
    skinIndex = Math.floor(Math.random() * SKINS.length);
  }
  hp = MAX_HP; hitCount = 0; combo = 0;
  updateHP(); hitTally.textContent = '0 hits'; comboLabel.textContent = '';
  showGameScreen();
});

// Back button
backBtn.addEventListener('click', showUploadScreen);

// Next round button (after KO) – re-upload required (faceCanvas already cleared)
nextBtn.addEventListener('click', showUploadScreen);

// Canvas punch – mouse
gameCanvas.addEventListener('click', e => {
  const {x, y} = toCanvasCoords(e);
  handleHit(x, y);
});

// Canvas punch – touch
gameCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const {x, y} = toCanvasCoords(e);
  handleHit(x, y);
}, { passive: false });

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
(async function init() {
  await loadFaceApiModels();

  // Pre-warm AudioContext on first user gesture
  document.addEventListener('pointerdown', initAudio, { once: true });

  // Draw idle preview on game canvas
  gctx.clearRect(0, 0, CW, CH);
  drawBackground(gctx);
  SKINS[0].draw(gctx, null, 0);
})();
