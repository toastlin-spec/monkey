'use strict';
// ============================================================
//  遊戲引擎：地圖、動物移動、炮塔攻擊、技能、渲染
// ============================================================

const DPR = Math.min(2, window.devicePixelRatio || 1);
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

// emoji 預先畫到小畫布上，之後用 drawImage 快很多
const emojiCache = new Map();
function emojiSprite(icon, size) {
  const key = icon + '|' + size;
  let c = emojiCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    const px = Math.round(size * DPR), pad = Math.ceil(px * 0.3);
    c.width = c.height = px + pad * 2;
    const g = c.getContext('2d');
    g.font = `${px}px ${EMOJI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, c.width / 2, c.height / 2 + px * 0.06);
    emojiCache.set(key, c);
  }
  return c;
}
function drawEmoji(c, icon, x, y, size, flip = false, alpha = 1, rot = 0, sx = 1, sy = 1) {
  if (size < 1) return;
  const s = emojiSprite(icon, Math.round(size));
  const w = s.width / DPR, h = s.height / DPR;
  c.save();
  if (alpha < 1) c.globalAlpha *= alpha;
  c.translate(x, y);
  if (rot) c.rotate(rot);
  if (flip || sx !== 1 || sy !== 1) c.scale(flip ? -sx : sx, sy);
  c.drawImage(s, -w / 2, -h / 2, w, h);
  c.restore();
}
function sfx(name) { if (window.SoundFX) SoundFX.play(name); }
function easeOutBack(p) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }

const GRAVITY = { dirt: 300, debris: 420, confettiBurst: 260, drop: 400, star: 120 };

// 每張地圖的環境粒子
const AMBIENT = [
  { kind: 'petal', n: 14, icons: ['🌸', '🍃', '🦋'] },
  { kind: 'leaf', n: 18, icons: ['🍃', '🍂'] },
  { kind: 'snow', n: 60 },
  { kind: 'sand', n: 40 },
  { kind: 'ember', n: 40 },
];
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((f - r) * p + r); g = Math.round((f - g) * p + g); b = Math.round((f - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function hypot(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// ---------- 地圖 ----------
class GameMap {
  constructor(def, idx) {
    this.def = def;
    this.theme = def.theme;
    this.pts = def.path.map(([x, y]) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.cum[this.cum.length - 1];

    this.pathTiles = new Set();
    this.tileOrder = [];
    for (let i = 1; i < def.path.length; i++) {
      let [x, y] = def.path[i - 1];
      const [bx, by] = def.path[i];
      const sx = Math.sign(bx - x), sy = Math.sign(by - y);
      for (;;) { this.addTile(x, y); if (x === bx && y === by) break; x += sx; y += sy; }
    }
    const first = this.tileOrder[0], last = this.tileOrder[this.tileOrder.length - 1];
    this.entry = { x: (first[0] + 0.5) * TILE, y: (first[1] + 0.5) * TILE };
    this.base = { x: (last[0] + 0.5) * TILE, y: (last[1] + 0.5) * TILE };

    // 裝飾物（會擋住放塔）
    this.blocked = new Set();
    this.decor = [];
    const rng = mulberry32(idx * 1013 + 7);
    for (let tries = 0; this.decor.length < 14 && tries < 500; tries++) {
      const gx = Math.floor(rng() * COLS), gy = Math.floor(rng() * ROWS), k = gx + ',' + gy;
      if (this.pathTiles.has(k) || this.blocked.has(k)) continue;
      this.blocked.add(k);
      this.decor.push({ gx, gy, icon: def.theme.decor[Math.floor(rng() * def.theme.decor.length)] });
    }
    this.mids = def.mids.map(([i, f]) => this.cum[i] + (this.cum[i + 1] - this.cum[i]) * f);
  }
  addTile(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    const k = x + ',' + y;
    if (!this.pathTiles.has(k)) { this.pathTiles.add(k); this.tileOrder.push([x, y]); }
  }
  posAt(d) {
    const p = this.pts;
    for (let i = 1; i < p.length; i++) {
      if (d <= this.cum[i] || i === p.length - 1) {
        const a = p[i - 1], b = p[i];
        const f = Math.max(0, Math.min(1, (d - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1])));
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
      }
    }
  }
}

// ---------- 遊戲 ----------
class Game {
  constructor(canvas, chapter, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = opts.hooks;
    const tv = opts.talents;
    this.chapter = chapter;
    this.mapDef = MAPS[chapter];
    this.map = new GameMap(this.mapDef, chapter);
    this.startLevel = chapter * 10 + 1;
    this.endLevel = chapter * 10 + 10;
    this.level = this.startLevel;

    this.maxHp = 20 + tv.hp;
    this.hp = this.maxHp;
    // 換地圖時塔會清空，所以後面章節給更多起始金幣，相當於前面累積的身家
    this.gold = [250, 1000, 2400, 4500, 8500][chapter] + tv.gold;
    this.dmgTalent = 1 + tv.dmg;
    this.rangeTalent = 1 + tv.range;
    this.goldTalent = 1 + tv.bounty;
    this.refund = 0.7 + tv.refund;
    this.skillCdMul = 1 - tv.skill;

    this.towers = []; this.enemies = []; this.projectiles = []; this.effects = []; this.fields = [];
    this.t = 0; this.speed = 1; this.paused = false; this.over = false;
    this.waveActive = false; this.events = []; this.evIdx = 0; this.waveT = 0;
    this.leakedThisWave = false; this.shield = 0;
    this.placing = null; this.selected = null; this.targeting = null; this.mouse = null;
    this.skillCd = {}; this.goldDoubleUntil = 0; this.autoNext = false; this.autoT = 0;
    this.shake = 0; this.towerId = 0; this.hurtFlash = 0;
    this.rt = 0; this.banner = null; this.baseShake = 0; this.baseBounce = 0; this.bossAlive = false;
    this.ambient = [];
    const amb = AMBIENT[chapter];
    for (let i = 0; i < amb.n; i++) this.ambient.push(this.newAmbient(amb, true));
    this.clouds = chapter === 4 ? [] : Array.from({ length: 3 }, (_, i) => ({ x: Math.random() * WIDTH, y: 80 + i * 180 + Math.random() * 60, s: 0.8 + Math.random() * 0.6 }));

    canvas.width = WIDTH * DPR;
    canvas.height = HEIGHT * DPR;
    this.bg = this.renderBackground();
    this.bindInput();
    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  destroy() {
    this.running = false;
    const cv = this.canvas;
    cv.removeEventListener('pointermove', this._onMove);
    cv.removeEventListener('pointerdown', this._onDown);
    cv.removeEventListener('contextmenu', this._onCtx);
    cv.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('keydown', this._onKey);
  }

  // ---------- 輸入 ----------
  bindInput() {
    const cv = this.canvas;
    this._onMove = e => { this.mouse = this.toWorld(e); };
    this._onDown = e => {
      e.preventDefault();
      const p = this.toWorld(e);
      this.mouse = p;
      if (e.button === 2) { this.cancel(); return; }
      this.click(p, e.shiftKey);
    };
    this._onCtx = e => e.preventDefault();
    this._onLeave = () => { this.mouse = null; };
    this._onKey = e => {
      if (e.key === 'Escape') this.cancel();
      else if (e.code === 'Space') { e.preventDefault(); if (!this.waveActive) this.startWave(); }
    };
    cv.addEventListener('pointermove', this._onMove);
    cv.addEventListener('pointerdown', this._onDown);
    cv.addEventListener('contextmenu', this._onCtx);
    cv.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('keydown', this._onKey);
  }
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * WIDTH, y = (e.clientY - r.top) / r.height * HEIGHT;
    return { x, y, gx: Math.floor(x / TILE), gy: Math.floor(y / TILE) };
  }
  cancel() {
    this.placing = null; this.targeting = null; this.selected = null;
    this.hooks.hud();
  }
  click(p, shift) {
    if (this.over) return;
    if (this.targeting) {
      const sk = SKILLS.find(s => s.id === this.targeting);
      this.targeting = null;
      this.castSkill(sk, p.x, p.y);
      this.hooks.hud();
      return;
    }
    if (this.placing) {
      const type = this.placing;
      if (this.canPlace(type, p.gx, p.gy) && this.gold >= TOWERS[type].cost) {
        this.place(type, p.gx, p.gy);
        if (!shift || this.gold < TOWERS[type].cost) this.placing = null;
      } else {
        const tw = this.towerAt(p.gx, p.gy);
        if (tw) { this.placing = null; this.selected = tw; }
        else if (this.gold < TOWERS[type].cost) { this.hooks.toast('💸 金幣不夠！', 'warn'); sfx('deny'); }
        else { this.hooks.toast(TOWERS[type].onPath ? '陷阱只能放在路徑上' : '這裡不能放塔', 'warn'); sfx('deny'); }
      }
      this.hooks.hud();
      return;
    }
    this.selected = this.towerAt(p.gx, p.gy) || null;
    this.hooks.hud();
  }

  // ---------- 放塔 / 升級 / 賣出 ----------
  isUnlocked(type) { return TOWERS[type].unlock <= this.level; }
  towerAt(gx, gy) { return this.towers.find(t => t.gx === gx && t.gy === gy && !t.dead); }
  canPlace(type, gx, gy) {
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return false;
    if (this.towerAt(gx, gy)) return false;
    const k = gx + ',' + gy;
    if (TOWERS[type].onPath) return this.map.pathTiles.has(k);
    return !this.map.pathTiles.has(k) && !this.map.blocked.has(k);
  }
  startPlacing(type) {
    if (this.over || !this.isUnlocked(type)) return;
    this.targeting = null;
    this.selected = null;
    this.placing = this.placing === type ? null : type;
    this.hooks.hud();
  }
  place(type, gx, gy) {
    const def = TOWERS[type];
    this.gold -= def.cost;
    const tw = {
      id: ++this.towerId, type, def, gx, gy, x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE,
      lv: 1, branch: null, spent: def.cost, cd: 0.2, pulse: 0, angle: -Math.PI / 2, target: null,
      mode: def.defaultMode || 'first', stunUntil: 0, beamT: 0, beamM: 1, flash: 0, firing: 0,
      rangeMult: 1, rateMult: 1, dmgMult: 1, R: 0, born: this.rt, upT: -9,
    };
    tw.s = computeStats(def, 1, null);
    if (tw.s.uses) tw.uses = tw.s.uses;
    this.towers.push(tw);
    this.effects.push({ type: 'ring', x: tw.x, y: tw.y, r: 30, color: '#ffffff', t: 0, dur: 0.4, grow: true });
    this.burst(tw.x, tw.y + 14, 8, 'dust');
    sfx('place');
  }
  // 粒子噴發：dust 塵土、star 星星、debris 碎片、confetti 彩帶
  burst(x, y, n, kind) {
    if (this.effects.length > 500) return;
    for (let i = 0; i < n; i++) {
      const a = kind === 'dust' ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const sp = kind === 'dust' ? 30 + Math.random() * 50 : kind === 'star' ? 60 + Math.random() * 90 : 80 + Math.random() * 160;
      this.effects.push({
        type: kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'debris' ? 80 : 0), t: 0,
        dur: kind === 'dust' ? 0.5 : 0.6 + Math.random() * 0.4, rot: Math.random() * 6, hue: Math.floor(Math.random() * 360),
      });
    }
  }
  // 金幣飛向左上角的金幣欄
  coinFly(x, y, delay = 0) {
    if (this.effects.length > 400) return;
    this.effects.push({ type: 'coin', sx: x, sy: y, x, y, t: -delay, dur: 0.7, arc: 40 + Math.random() * 60 });
  }
  upgradeCostOf(tw) { return tw.lv >= MAX_LV ? 0 : upgradeCost(tw.def, tw.lv); }
  upgrade(tw, branch) {
    if (tw.lv >= MAX_LV) return;
    const c = this.upgradeCostOf(tw);
    if (this.gold < c) { this.hooks.toast('💸 金幣不夠！', 'warn'); sfx('deny'); return; }
    if (tw.lv === 2 && branch == null) return;
    this.gold -= c;
    tw.spent += c;
    tw.lv++;
    if (tw.lv === 3) tw.branch = branch;
    tw.s = computeStats(tw.def, tw.lv, tw.branch);
    if (tw.s.uses) tw.uses = tw.s.uses;
    const ult = tw.lv === MAX_LV;
    this.effects.push({ type: 'text', x: tw.x, y: tw.y - 20, text: ult ? '終極強化！' : '升級！', color: ult ? '#ff9f1c' : '#ffe066', t: 0, dur: ult ? 1.3 : 0.9, big: ult });
    if (ult) { this.burst(tw.x, tw.y, 16, 'confettiBurst'); this.shake = 0.15; }
    this.effects.push({ type: 'ring', x: tw.x, y: tw.y, r: 34, color: '#ffe066', t: 0, dur: 0.5, grow: true });
    this.effects.push({ type: 'beamup', x: tw.x, y: tw.y, t: 0, dur: 0.6 });
    this.burst(tw.x, tw.y, 10, 'star');
    tw.upT = this.rt;
    sfx('upgrade');
    this.hooks.hud();
  }
  sellValue(tw) { return Math.floor(tw.spent * this.refund); }
  sell(tw) {
    this.gold += this.sellValue(tw);
    tw.dead = true;
    this.towers = this.towers.filter(t => !t.dead);
    this.effects.push({ type: 'text', x: tw.x, y: tw.y, text: `+${this.sellValue(tw)}`, color: '#ffd84a', t: 0, dur: 0.9 });
    this.effects.push({ type: 'poof', x: tw.x, y: tw.y, icon: tw.def.icon, size: 22, face: 1, t: 0, dur: 0.6 });
    for (let i = 0; i < 4; i++) this.coinFly(tw.x, tw.y, i * 0.06);
    this.burst(tw.x, tw.y + 10, 8, 'dust');
    sfx('sell');
    this.selected = null;
    this.hooks.hud();
  }
  setMode(tw, mode) { tw.mode = mode; tw.target = null; this.hooks.hud(); }

  // ---------- 關卡流程 ----------
  startWave() {
    if (this.waveActive || this.over) return;
    this.events = buildWave(this.level);
    this.evIdx = 0;
    this.waveT = 0;
    this.waveActive = true;
    this.autoT = 0;
    this.leakedThisWave = false;
    this.shield = this.towers.reduce((a, t) => a + (t.s.shield || 0), 0);
    for (const k in ENEMIES) {
      if (ENEMIES[k].from === this.level) this.hooks.toast(`🆕 新動物：${ENEMIES[k].icon} ${ENEMIES[k].name} — ${ENEMIES[k].desc}`);
    }
    if (this.level === 20) this.hooks.toast('⚠️ 從這關開始，BOSS 會從路徑中間突然冒出來！', 'warn');
    const isBoss = !!BOSS_AT[this.level];
    this.showBanner(`第 ${this.level} 關`, isBoss ? '👑 BOSS 關卡' : this.mapDef.name, isBoss ? '#c05cff' : '#ff8a3d');
    sfx('waveStart');
    this.hooks.hud();
  }
  showBanner(text, sub, color, dur = 1.8) { this.banner = { text, sub, color, t: 0, dur }; }
  completeWave() {
    this.waveActive = false;
    const L = this.level;
    const bonus = 20 + L * 4;
    let mine = 0, heal = 0;
    for (const tw of this.towers) {
      if (tw.s.kind === 'mine') {
        mine += tw.s.gold;
        if (tw.s.interest) mine += Math.min(200, Math.floor(this.gold * tw.s.interest));
        this.effects.push({ type: 'text', x: tw.x, y: tw.y - 16, text: '+💰', color: '#ffd84a', t: 0, dur: 1.2 });
      }
      if (tw.s.kind === 'heal') heal += tw.s.heal;
    }
    this.gold += bonus + mine;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + heal);
    const stars = this.leakedThisWave ? 1 : 2;
    this.hooks.waveDone({ level: L, bonus, mine, heal: this.hp - before, stars });
    if (this.hp > before) {
      for (let i = 0; i < 4; i++) this.effects.push({ type: 'heart', x: this.map.base.x + (Math.random() - 0.5) * 30, y: this.map.base.y, t: -i * 0.15, dur: 1.2 });
    }
    if (L >= this.endLevel) {
      this.over = true;
      this.showBanner('大勝利！', '🎉 本章通關 🎉', '#ffb800', 3);
      for (let i = 0; i < 120; i++) {
        this.effects.push({ type: 'confetti', x: Math.random() * WIDTH, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 120, t: -Math.random() * 0.8, dur: 3.5, rot: Math.random() * 6, hue: Math.floor(Math.random() * 360) });
      }
      sfx('victory');
      setTimeout(() => { if (this.running) this.hooks.victory(); }, 1600);
      return;
    }
    this.showBanner('過關！', '⭐'.repeat(stars), '#4fbf6b', 1.4);
    sfx('waveClear');
    this.level++;
    for (const k of TOWER_ORDER) {
      if (TOWERS[k].unlock === this.level) {
        this.hooks.toast(`🔓 新塔解鎖：${TOWERS[k].icon} ${TOWERS[k].name}！`, 'good');
        setTimeout(() => sfx('unlock'), 700);
      }
    }
    if (BOSS_AT[this.level]) this.hooks.toast(`👑 下一關是 BOSS 關：${BOSSES[BOSS_AT[this.level]].icon} ${BOSSES[BOSS_AT[this.level]].name}`, 'boss');
    if (this.autoNext) this.autoT = this.t + 2.5;
    this.hooks.hud();
  }
  gameOver() {
    if (this.over) return;
    this.over = true;
    this.defeated = true;
    this.baseShake = 1.5;
    this.burst(this.map.base.x, this.map.base.y, 20, 'debris');
    sfx('defeat');
    setTimeout(() => { if (this.running) this.hooks.defeat(); }, 1400);
  }

  // ---------- 出怪 ----------
  spawnStep(dt) {
    this.waveT += dt;
    for (const ev of this.events) {
      if (ev.raid && !ev.warned && this.waveT >= ev.t - 3) {
        ev.warned = true;
        const p = this.map.posAt(this.map.mids[ev.mid % this.map.mids.length]);
        this.effects.push({ type: 'warn', x: p.x, y: p.y, t: 0, dur: 3 });
        sfx('warn');
        this.hooks.toast(`⚠️ ${RAIDS[ev.type].icon} ${RAIDS[ev.type].name} 即將從路徑中間衝出來！`, 'warn');
      }
    }
    while (this.evIdx < this.events.length && this.waveT >= this.events[this.evIdx].t) {
      this.spawn(this.events[this.evIdx]);
      this.evIdx++;
    }
  }
  spawn(ev) {
    const L = this.level;
    let def, hp, gold, dist = 0;
    if (ev.boss) {
      def = BOSSES[ev.type]; hp = def.hp; gold = def.gold;
    } else if (ev.raid) {
      def = RAIDS[ev.type];
      hp = def.hp * hpMult(L) * (L >= 40 ? 1.5 : L >= 30 ? 1.8 : 2.5);
      gold = Math.round(def.gold * (1 + 0.03 * (L - 20)));
      dist = this.map.mids[ev.mid % this.map.mids.length];
    } else {
      def = ENEMIES[ev.type]; hp = def.hp * hpMult(L);
      gold = Math.max(1, Math.round(def.gold * (1 + 0.04 * (L - 1))));
    }
    const e = this.makeEnemy(ev.type, def, { hp, gold, dist, boss: ev.boss, raid: ev.raid });
    if (ev.raid) {
      this.shake = 0.5;
      e.rise = true;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 140;
        this.effects.push({ type: 'dirt', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, t: 0, dur: 0.8 });
      }
      this.effects.push({ type: 'shock', x: e.x, y: e.y, r: 1.5 * TILE, t: 0, dur: 0.5, color: '#6b4b33' });
      sfx('raid');
    }
    if (ev.boss) {
      this.shake = 0.6;
      this.showBanner('⚠ BOSS 來襲 ⚠', `${def.icon} ${def.name}`, '#e0403a', 2.4);
      this.hooks.toast(`👑 BOSS 登場：${def.icon} ${def.name} — ${def.desc}`, 'boss');
      sfx('boss');
    }
  }
  makeEnemy(type, def, o) {
    const e = {
      type, def, hp: o.hp, maxHp: o.hp, gold: o.gold, dist: o.dist || 0, speed: def.speed,
      armor: def.armor || 0, air: !!def.air, size: o.size || def.size || 1, boss: !!o.boss, raid: !!o.raid,
      leak: def.leak || 1, x: 0, y: 0, face: -1, curSpeed: def.speed,
      slowF: 1, slowUntil: 0, frozenUntil: 0, stunUntil: 0, burnDps: 0, burnUntil: 0, poisonDps: 0, poisonUntil: 0,
      vuln: 0, vulnUntil: 0, heldUntil: 0, pullX: 0, pullY: 0, roarUntil: 0, diveUntil: 0,
      burrowed: false, burrowT: 2 + Math.random() * 2, healT: 1, skillT: def.skillCd || 0, summonT: 8,
      revealed: false, mark: 0, flash: 0, walk: Math.random() * 10, noSplit: !!o.noSplit, spikeHit: {},
      born: this.rt, squash: 0,
    };
    e.r = 13 * e.size;
    const p = this.map.posAt(e.dist);
    e.x = p.x; e.y = p.y;
    this.enemies.push(e);
    return e;
  }

  // ---------- 狀態效果 ----------
  canBeHit(e) { return !e.dead && !e.leaked && !e.burrowed && !(e.diveUntil > this.t); }
  targetable(e, s) {
    if (!this.canBeHit(e)) return false;
    if (e.def.invis && !e.revealed) return false;
    if (e.air && !s.air) return false;
    return true;
  }
  applySlow(e, f, dur) {
    if (e.def.noSlow) return;
    if (e.boss || e.raid) f = 1 - (1 - f) * 0.5;
    const t = this.t;
    if (t > e.slowUntil || f < e.slowF) e.slowF = f;
    e.slowUntil = Math.max(e.slowUntil, t + dur);
  }
  freeze(e, dur) {
    if (e.def.noSlow) return;
    if (e.boss || e.raid) { this.applySlow(e, 0.4, dur); return; }
    e.frozenUntil = Math.max(e.frozenUntil, this.t + dur);
  }
  knockback(e, amt) {
    const f = e.boss ? 0.12 : e.raid ? 0.3 : 1;
    e.dist = Math.max(0, e.dist - amt * f);
  }
  addPoison(e, dps, dur) {
    e.poisonDps = Math.max(e.poisonUntil > this.t ? e.poisonDps : 0, dps);
    e.poisonUntil = this.t + dur;
  }
  addBurn(e, dps, dur) {
    e.burnDps = Math.max(e.burnUntil > this.t ? e.burnDps : 0, dps);
    e.burnUntil = this.t + dur;
  }
  damage(e, amt, o = {}) {
    if (!this.canBeHit(e)) return 0;
    if (e.armor && !o.pierce) {
      // 單發攻擊扣固定護甲；持續傷害改成百分比減傷
      if (o.dot) amt *= 1 - Math.min(0.5, e.armor * 0.04);
      else amt = Math.max(amt * 0.2, amt - e.armor);
    }
    let v = 1 + e.mark;
    if (e.vulnUntil > this.t) v += e.vuln;
    amt *= v;
    e.hp -= amt;
    if (!o.dot) { e.flash = 0.08; e.squash = 0.15; }
    if (e.hp <= 0) this.kill(e);
    return amt;
  }
  kill(e) {
    if (e.dead) return;
    e.dead = true;
    const g = Math.round(e.gold * this.goldTalent * (this.goldDoubleUntil > this.t ? 2 : 1));
    this.gold += g;
    if (g > 0) this.effects.push({ type: 'text', x: e.x, y: e.y - 10, text: `+${g}`, color: '#ffd84a', t: 0, dur: 0.8, small: true });
    this.effects.push({ type: 'poof', x: e.x, y: e.y, icon: e.def.icon, size: 26 * e.size, face: e.face, t: 0, dur: e.boss ? 1.6 : 0.9 });
    this.effects.push({ type: 'puff', x: e.x, y: e.y, r: 12 * e.size, t: 0, dur: 0.35 });
    this.burst(e.x, e.y, e.boss || e.raid ? 16 : 4, 'star');
    if (g > 0) this.coinFly(e.x, e.y);
    sfx('pop');
    if (e.def.split && !e.noSplit) {
      for (let i = 0; i < e.def.split; i++) {
        this.makeEnemy(e.type, e.def, { hp: e.maxHp * 0.35, gold: 1, dist: Math.max(0, e.dist + (i ? -12 : 8)), size: 0.65, noSplit: true });
      }
    }
    if (e.boss || e.raid) {
      this.shake = 0.4;
      for (let i = 0; i < 3; i++) this.effects.push({ type: 'boom', x: e.x + (Math.random() - 0.5) * 40, y: e.y + (Math.random() - 0.5) * 40, r: 50, t: -i * 0.15, dur: 0.5 });
      this.burst(e.x, e.y, 30, 'confettiBurst');
      sfx('bossDown');
      if (e.boss) {
        this.hooks.toast(`🎉 打敗 BOSS：${e.def.name}！`, 'good');
        this.showBanner('擊退 BOSS！', `${e.def.icon} ${e.def.name}`, '#4fbf6b', 1.8);
      }
    }
  }
  onLeak(e) {
    e.leaked = true;
    if (!e.boss && this.shield > 0) {
      this.shield--;
      this.effects.push({ type: 'text', x: this.map.base.x, y: this.map.base.y - 26, text: '🛡️ 擋下！', color: '#9fffc0', t: 0, dur: 1 });
      this.effects.push({ type: 'ring', x: this.map.base.x, y: this.map.base.y, r: 34, color: '#9fffc0', t: 0, dur: 0.5, grow: true });
      sfx('shield');
      return;
    }
    this.hp -= e.leak;
    this.leakedThisWave = true;
    this.hurtFlash = 0.35;
    this.baseShake = 0.5;
    this.burst(this.map.base.x, this.map.base.y, 6, 'debris');
    sfx('hurt');
    this.effects.push({ type: 'text', x: this.map.base.x, y: this.map.base.y - 26, text: `-${e.leak}❤️`, color: '#ff6b6b', t: 0, dur: 1 });
    this.hooks.hurt();
    if (this.hp <= 0) { this.hp = 0; this.gameOver(); }
  }

  // ---------- 技能 ----------
  skillReady(id) { return (this.skillCd[id] || 0) <= this.t; }
  useSkill(id) {
    if (this.over) return;
    const sk = SKILLS.find(s => s.id === id);
    if (!this.skillReady(id)) return;
    if (this.gold < sk.cost) { this.hooks.toast('💸 金幣不夠！', 'warn'); return; }
    if (sk.target) {
      this.targeting = this.targeting === id ? null : id;
      this.placing = null;
      this.hooks.hud();
      return;
    }
    this.castSkill(sk);
  }
  castSkill(sk, x, y) {
    if (this.gold < sk.cost || !this.skillReady(sk.id)) return;
    this.gold -= sk.cost;
    this.skillCd[sk.id] = this.t + sk.cd * this.skillCdMul;
    const t = this.t;
    switch (sk.id) {
      case 'heal':
        this.hp = Math.min(this.maxHp, this.hp + 5);
        this.effects.push({ type: 'text', x: this.map.base.x, y: this.map.base.y - 26, text: '+5❤️', color: '#7dff9a', t: 0, dur: 1.2 });
        for (let i = 0; i < 6; i++) this.effects.push({ type: 'heart', x: this.map.base.x + (Math.random() - 0.5) * 40, y: this.map.base.y, t: -i * 0.1, dur: 1.2 });
        sfx('heal');
        break;
      case 'strike':
        this.projectiles.push({ kind: 'strike', x, y, t: 0, dur: 0.9, dmg: 150 + this.level * 25 });
        sfx('plane');
        break;
      case 'freeze':
        for (const e of this.enemies) {
          if (e.boss || e.raid) this.applySlow(e, 0.4, 3);
          else e.frozenUntil = Math.max(e.frozenUntil, t + 3);
        }
        this.effects.push({ type: 'screen', color: 'rgba(160,220,255,', t: 0, dur: 0.8 });
        for (let i = 0; i < 40; i++) this.effects.push({ type: 'flake', x: Math.random() * WIDTH, y: Math.random() * HEIGHT, t: -Math.random() * 0.4, dur: 1.4 });
        sfx('freezeAll');
        break;
      case 'double':
        this.goldDoubleUntil = t + 30;
        for (let i = 0; i < 10; i++) this.coinFly(this.map.base.x + (Math.random() - 0.5) * 80, this.map.base.y, i * 0.05);
        sfx('coins');
        this.hooks.toast('✨ 金幣雙倍 30 秒！', 'good');
        break;
    }
    this.hooks.hud();
  }

  // ---------- 主迴圈 ----------
  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.updateCosmetic(dt);
      if (!this.over) {
        let total = dt * this.speed;
        while (total > 1e-6) { const st = Math.min(total, 1 / 60); this.update(st); total -= st; }
      } else {
        this.updateEffects(dt);
      }
    }
    this.render();
    requestAnimationFrame(this.loop);
  }

  // 只影響畫面、不影響遊戲結果的動畫（用真實時間）
  updateCosmetic(dt) {
    this.rt += dt;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    this.baseShake = Math.max(0, this.baseShake - dt);
    const amb = AMBIENT[this.chapter];
    for (const a of this.ambient) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.ph += dt;
      if (a.kind === 'petal' || a.kind === 'leaf') a.x += Math.sin(a.ph * 1.5) * 20 * dt;
      if (a.x < -30 || a.x > WIDTH + 30 || a.y < -30 || a.y > HEIGHT + 30 || (a.life && a.ph > a.life)) Object.assign(a, this.newAmbient(amb, false));
    }
    for (const c of this.clouds) { c.x += 12 * dt; if (c.x > WIDTH + 200) c.x = -200; }
  }
  newAmbient(amb, anywhere) {
    const a = { kind: amb.kind, ph: Math.random() * 6, life: 0 };
    switch (amb.kind) {
      case 'petal': case 'leaf':
        a.icon = amb.icons[Math.floor(Math.random() * amb.icons.length)];
        a.x = anywhere ? Math.random() * WIDTH : -20; a.y = Math.random() * HEIGHT;
        a.vx = 20 + Math.random() * 25; a.vy = amb.kind === 'leaf' ? 10 + Math.random() * 15 : (Math.random() - 0.5) * 10;
        a.size = a.icon === '🦋' ? 16 : 12;
        break;
      case 'snow':
        a.x = Math.random() * WIDTH; a.y = anywhere ? Math.random() * HEIGHT : -10;
        a.vx = -8 + Math.random() * 6; a.vy = 20 + Math.random() * 30; a.size = 1.5 + Math.random() * 2.5;
        break;
      case 'sand':
        a.x = anywhere ? Math.random() * WIDTH : -20; a.y = Math.random() * HEIGHT;
        a.vx = 80 + Math.random() * 80; a.vy = (Math.random() - 0.5) * 10; a.size = 1 + Math.random() * 1.5;
        break;
      case 'ember':
        a.x = Math.random() * WIDTH; a.y = anywhere ? Math.random() * HEIGHT : HEIGHT + 10;
        a.vx = (Math.random() - 0.5) * 15; a.vy = -(20 + Math.random() * 40); a.size = 1.5 + Math.random() * 2;
        a.life = 3 + Math.random() * 6;
        break;
    }
    return a;
  }

  update(dt) {
    this.t += dt;
    if (this.waveActive) this.spawnStep(dt);
    this.computeBuffs();
    for (const e of this.enemies) if (!e.dead && !e.leaked) this.updateEnemy(e, dt);
    for (const tw of this.towers) if (!tw.dead) this.updateTower(tw, dt);
    this.updateFields(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.enemies = this.enemies.filter(e => !e.dead && !e.leaked);
    if (this.towers.some(t => t.dead)) {
      this.towers = this.towers.filter(t => !t.dead);
      if (this.selected && this.selected.dead) this.selected = null;
      this.hooks.hud();
    }
    const boss = this.enemies.some(e => e.boss);
    if (boss !== this.bossAlive) { this.bossAlive = boss; if (this.hooks.bossMusic) this.hooks.bossMusic(boss); }
    if (this.over) return;
    if (this.waveActive && this.evIdx >= this.events.length && this.enemies.length === 0) this.completeWave();
    if (!this.waveActive && this.autoNext && this.autoT && this.t >= this.autoT) this.startWave();
  }

  computeBuffs() {
    const sup = this.towers.filter(t => t.s.kind === 'support');
    for (const tw of this.towers) {
      let rb = 0, rt = 0, db = 0;
      for (const sp of sup) {
        if (sp === tw) continue;
        if (hypot(sp.x, sp.y, tw.x, tw.y) <= sp.s.range * TILE + 1) {
          rb = Math.max(rb, sp.s.rangeBuff || 0);
          rt = Math.max(rt, sp.s.rateBuff || 0);
          db = Math.max(db, sp.s.dmgBuff || 0);
        }
      }
      tw.rangeMult = this.rangeTalent * (1 + rb);
      tw.rateMult = 1 + rt;
      tw.dmgMult = this.dmgTalent * (1 + db);
      tw.buffed = rb > 0 || rt > 0 || db > 0;
    }
    const radars = sup.filter(t => t.s.reveal);
    for (const e of this.enemies) {
      e.revealed = false; e.mark = 0;
      for (const r of radars) {
        if (hypot(r.x, r.y, e.x, e.y) <= r.s.reveal * TILE * this.rangeTalent) {
          e.revealed = true;
          e.mark = Math.max(e.mark, r.s.mark || 0);
        }
      }
    }
  }

  updateEnemy(e, dt) {
    const t = this.t;
    e.flash = Math.max(0, e.flash - dt);
    e.squash = Math.max(0, e.squash - dt);
    if (e.burnUntil > t) this.damage(e, e.burnDps * dt, { dot: true });
    if (e.poisonUntil > t && !e.dead) this.damage(e, e.poisonDps * dt, { dot: true });
    if (e.dead) return;

    if (e.def.burrow) {
      e.burrowT -= dt;
      if (e.burrowT <= 0) { e.burrowed = !e.burrowed; e.burrowT = e.burrowed ? 1.5 : 3.5; }
    }
    if (e.def.healer) {
      e.healT -= dt;
      if (e.healT <= 0) {
        e.healT = 1;
        let any = false;
        for (const o of this.enemies) {
          if (o === e || o.dead || o.hp >= o.maxHp) continue;
          if (hypot(o.x, o.y, e.x, e.y) < 1.6 * TILE) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.05); any = true; }
        }
        if (any) this.effects.push({ type: 'ring', x: e.x, y: e.y, r: 1.6 * TILE, color: '#7dff9a', t: 0, dur: 0.5, grow: true });
      }
    }
    if (e.def.regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.def.regen * dt);
    if (e.boss) this.bossSkill(e, dt);

    let sp = e.speed;
    if (e.roarUntil > t) sp *= 1.5;
    if (e.def.skill === 'dive' && e.hp < e.maxHp * 0.3) sp *= 1.8;
    if (e.frozenUntil > t || e.stunUntil > t) sp = 0;
    else if (e.heldUntil > t) sp = 0;
    else if (e.slowUntil > t) sp *= e.slowF;
    e.curSpeed = sp;
    e.dist += sp * TILE * dt;
    if (sp > 0) e.walk += dt * (0.6 + sp * 0.5);
    if (e.dist >= this.map.length) { this.onLeak(e); return; }
    const p = this.map.posAt(e.dist);
    e.x = p.x; e.y = p.y;
    if (p.dx > 0) e.face = 1; else if (p.dx < 0) e.face = -1;
  }

  bossSkill(e, dt) {
    const t = this.t;
    if (e.def.skill === 'fire') {
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 12;
        for (let i = 0; i < 3; i++) {
          this.makeEnemy('bat', ENEMIES.bat, { hp: ENEMIES.bat.hp * hpMult(this.level), gold: 2, dist: Math.max(0, e.dist - 18 * i) });
        }
        this.effects.push({ type: 'text', x: e.x, y: e.y - 50, text: '召喚蝙蝠！', color: '#ffb0ff', t: 0, dur: 1.2 });
      }
    }
    e.skillT -= dt;
    if (e.skillT > 0) return;
    e.skillT = e.def.skillCd;
    const say = txt => this.effects.push({ type: 'text', x: e.x, y: e.y - 50, text: txt, color: '#ffffff', t: 0, dur: 1.3, big: true });
    switch (e.def.skill) {
      case 'stomp': {
        say('踩踏！');
        sfx('stomp');
        this.shake = 0.35;
        this.burst(e.x, e.y + 20, 12, 'dust');
        this.effects.push({ type: 'shock', x: e.x, y: e.y, r: 2.2 * TILE, t: 0, dur: 0.6 });
        for (const tw of this.towers) if (hypot(tw.x, tw.y, e.x, e.y) <= 2.2 * TILE) tw.stunUntil = t + 2.5;
        break;
      }
      case 'roar':
        say('吼——！');
        sfx('roar');
        this.shake = 0.3;
        this.effects.push({ type: 'shock', x: e.x, y: e.y, r: 5 * TILE, t: 0, dur: 0.8, color: '#ffcc55' });
        for (const o of this.enemies) o.roarUntil = t + 3;
        break;
      case 'dive':
        say('潛水！');
        sfx('splash');
        for (let i = 0; i < 10; i++) {
          const a = Math.PI + Math.random() * Math.PI, s = 60 + Math.random() * 80;
          this.effects.push({ type: 'drop', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, dur: 0.6 });
        }
        e.diveUntil = t + 2;
        break;
      case 'rock': {
        const cand = this.towers.filter(tw => !tw.dead && tw.s.kind !== 'trap' && hypot(tw.x, tw.y, e.x, e.y) <= 4.5 * TILE);
        if (!cand.length) { e.skillT = 2; return; }
        const tw = cand[Math.floor(Math.random() * cand.length)];
        say('丟石頭！');
        sfx('throw');
        this.projectiles.push({ kind: 'rock', sx: e.x, sy: e.y - 20, tx: tw.x, ty: tw.y, tower: tw, t: 0, dur: 1.0 });
        break;
      }
      case 'fire':
        say('烈焰咆哮！');
        sfx('fireRoar');
        this.shake = 0.3;
        for (let i = 0; i < 24; i++) {
          const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 100;
          this.effects.push({ type: 'flame', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, dur: 0.7 });
        }
        this.effects.push({ type: 'shock', x: e.x, y: e.y, r: 3 * TILE, t: 0, dur: 0.7, color: '#ff7a2f' });
        for (const o of this.enemies) { o.slowUntil = 0; o.frozenUntil = 0; o.heldUntil = 0; }
        for (const tw of this.towers) if (hypot(tw.x, tw.y, e.x, e.y) <= 2 * TILE) tw.stunUntil = t + 1.5;
        break;
    }
  }

  // ---------- 炮塔 ----------
  acquire(tw, R, minR = 0, exclude = null) {
    let best = null, bv = 0;
    for (const e of this.enemies) {
      if (exclude && exclude.includes(e)) continue;
      if (!this.targetable(e, tw.s)) continue;
      const d = hypot(e.x, e.y, tw.x, tw.y);
      if (d > R + e.r * 0.5 || d < minR) continue;
      let v;
      switch (tw.mode) {
        case 'last': v = -e.dist; break;
        case 'strong': v = e.hp; break;
        case 'close': v = -d; break;
        default: v = e.dist;
      }
      if (best === null || v > bv) { best = e; bv = v; }
    }
    return best;
  }
  inRange(x, y, R, air) {
    return this.enemies.filter(e => this.canBeHit(e) && (air || !e.air) && hypot(e.x, e.y, x, y) <= R + e.r * 0.5);
  }

  updateTower(tw, dt) {
    const s = tw.s, t = this.t;
    tw.flash = Math.max(0, tw.flash - dt);
    tw.firing = Math.max(0, tw.firing - dt);
    tw.R = (s.range || 0) * TILE * tw.rangeMult;
    if (tw.stunUntil > t) { tw.target = null; return; }
    const R = tw.R, rate = (s.rate || 0) * tw.rateMult, dmg = (s.dmg || 0) * tw.dmgMult;
    if (s.rate) tw.cd = Math.max(0, tw.cd - dt);
    const muzzle = () => ({ x: tw.x + Math.cos(tw.angle) * 20, y: tw.y + Math.sin(tw.angle) * 20 });
    const aim = e => { tw.angle = Math.atan2(e.y - tw.y, e.x - tw.x); };

    switch (s.kind) {
      case 'bullet': {
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        if (tw.cd <= 0) {
          tw.cd = 1 / rate;
          const m = muzzle();
          this.projectiles.push({ kind: 'bullet', x: m.x, y: m.y, target: tg, spd: 14 * TILE, dmg, pierce: s.pierce, color: s.projColor });
          tw.flash = 0.05;
          sfx('mg');
        }
        break;
      }
      case 'spread': {
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        if (tw.cd <= 0) {
          tw.cd = 1 / rate;
          const m = muzzle(), n = s.pellets, spd = 11 * TILE;
          for (let i = 0; i < n; i++) {
            const a = tw.angle + (n > 1 ? (i / (n - 1) - 0.5) * s.spread : 0) + (Math.random() - 0.5) * 0.08;
            this.projectiles.push({ kind: 'pellet', x: m.x, y: m.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: R * 1.1 / spd, dmg, knock: (s.knock || 0) * TILE, air: s.air });
          }
          tw.flash = 0.1;
          this.burst(m.x, m.y, 3, 'smokePuff');
          sfx('shotgun');
        }
        break;
      }
      case 'aura': {
        tw.pulse -= dt;
        if (tw.pulse > 0) break;
        const list = this.inRange(tw.x, tw.y, R, s.air);
        if (!list.length) { tw.pulse = 0; break; }
        tw.pulse = 0.5;
        tw.flash = 0.12;
        this.effects.push({ type: 'ring', x: tw.x, y: tw.y, r: R, color: s.color, t: 0, dur: 0.5, faint: true });
        if (s.freezeChance) sfx('freeze'); else if (s.poisonDps) sfx('poison');
        for (const e of list) {
          if (dmg) this.damage(e, dmg * 0.5, { pierce: true });
          if (e.dead) continue;
          if (s.slow) this.applySlow(e, s.slow, 0.7);
          if (s.freezeChance && Math.random() < s.freezeChance) this.freeze(e, s.freezeDur);
          if (s.poisonDps) this.addPoison(e, s.poisonDps * tw.dmgMult, s.poisonDur);
          if (s.vuln) {
            if (e.vulnUntil < t) e.vuln = 0;
            e.vuln = Math.max(e.vuln, s.vuln);
            e.vulnUntil = t + 0.7;
          }
        }
        break;
      }
      case 'beam': {
        let tg = tw.target;
        if (!tg || !this.targetable(tg, s) || hypot(tg.x, tg.y, tw.x, tw.y) > R + tg.r * 0.5) {
          tg = this.acquire(tw, R);
          if (tg !== tw.target) { tw.beamT = 0; if (tg) sfx('laser'); }
          tw.target = tg;
        }
        if (!tg) break;
        aim(tg);
        tw.beamT += dt;
        tw.beamM = 1 + (s.rampMax - 1) * Math.min(1, tw.beamT / s.rampTime);
        this.damage(tg, dmg * tw.beamM * dt, { dot: true });
        if (s.splash) {
          for (const e of this.inRange(tg.x, tg.y, s.splash * TILE, true)) {
            if (e !== tg) this.damage(e, dmg * tw.beamM * dt * 0.5, { dot: true });
          }
        }
        break;
      }
      case 'trap': {
        for (const e of this.enemies) {
          if (e.air || !this.canBeHit(e)) continue;
          if (Math.abs(e.x - tw.x) > TILE * 0.5 || Math.abs(e.y - tw.y) > TILE * 0.5) continue;
          if (t - (e.spikeHit[tw.id] || -9) < 0.6) continue;
          e.spikeHit[tw.id] = t;
          this.damage(e, dmg);
          if (s.poisonDps && !e.dead) this.addPoison(e, s.poisonDps * tw.dmgMult, s.poisonDur);
          tw.flash = 0.12;
          sfx('spike');
          tw.uses--;
          if (tw.uses <= 0) {
            tw.dead = true;
            this.effects.push({ type: 'text', x: tw.x, y: tw.y, text: '陷阱壞了', color: '#ffffff', t: 0, dur: 1 });
            break;
          }
        }
        break;
      }
      case 'mortar': {
        const tg = this.acquire(tw, R, (s.minRange || 0) * TILE);
        if (!tg) break;
        aim(tg);
        if (tw.cd <= 0) {
          tw.cd = 1 / rate;
          const fl = 0.9;
          const p = this.map.posAt(tg.dist + tg.curSpeed * TILE * fl * 0.85);
          this.projectiles.push({ kind: 'shell', sx: tw.x, sy: tw.y, tx: p.x, ty: p.y, t: 0, dur: fl, dmg, splash: s.splash * TILE, burnDps: (s.burnDps || 0) * tw.dmgMult, burnDur: s.burnDur });
          tw.flash = 0.12;
          this.burst(tw.x, tw.y - 8, 3, 'smokePuff');
          sfx('mortar');
        }
        break;
      }
      case 'sniper': {
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        if (tw.cd <= 0) {
          tw.cd = 1 / rate;
          const crit = Math.random() < s.crit;
          this.damage(tg, dmg * (crit ? 3 : 1));
          const m = muzzle();
          this.effects.push({ type: 'line', x: m.x, y: m.y, x2: tg.x, y2: tg.y, color: crit ? '#ff4d4d' : '#ffffff', t: 0, dur: 0.15 });
          if (crit) this.effects.push({ type: 'text', x: tg.x, y: tg.y - 24, text: '暴擊！', color: '#ff4d4d', t: 0, dur: 0.8 });
          tw.flash = 0.1;
          sfx('sniper');
        }
        break;
      }
      case 'flame': {
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        tw.firing = 0.15;
        if (tw.cd <= 0) {
          tw.cd = 1 / rate;
          for (const e of this.enemies) {
            if (!this.canBeHit(e) || (e.air && !s.air)) continue;
            const d = hypot(e.x, e.y, tw.x, tw.y);
            if (d > R + e.r * 0.5) continue;
            const da = Math.abs(normAng(Math.atan2(e.y - tw.y, e.x - tw.x) - tw.angle));
            if (da > s.cone / 2 && d > e.r * 1.5) continue;
            this.damage(e, dmg, { dot: true });
            if (!e.dead) this.addBurn(e, s.burnDps * tw.dmgMult, s.burnDur);
          }
          for (let i = 0; i < 2; i++) {
            const a = tw.angle + (Math.random() - 0.5) * s.cone, sp = R * 1.6;
            const m = muzzle();
            this.effects.push({ type: 'flame', x: m.x, y: m.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: 0.55 });
          }
          sfx('flame');
        }
        break;
      }
      case 'chain': {
        if (tw.cd > 0) break;
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        tw.cd = 1 / rate;
        const hit = [tg], pts = [{ x: tw.x, y: tw.y - 12 }, { x: tg.x, y: tg.y }];
        let cur = tg, d = dmg;
        const zap = e => { this.damage(e, d); if (s.stun && !e.boss && !e.raid) e.stunUntil = Math.max(e.stunUntil, t + s.stun); };
        zap(tg);
        for (let i = 1; i < s.chains; i++) {
          let nb = null, nd = s.jump * TILE;
          for (const e of this.enemies) {
            if (hit.includes(e) || !this.targetable(e, s)) continue;
            const dd = hypot(e.x, e.y, cur.x, cur.y);
            if (dd < nd) { nd = dd; nb = e; }
          }
          if (!nb) break;
          d *= 0.85;
          zap(nb);
          hit.push(nb);
          pts.push({ x: nb.x, y: nb.y });
          cur = nb;
        }
        this.effects.push({ type: 'bolt', pts, t: 0, dur: 0.2 });
        tw.flash = 0.15;
        sfx('zap');
        break;
      }
      case 'missile': {
        if (tw.cd > 0) break;
        const first = this.acquire(tw, R);
        if (!first) break;
        aim(first);
        tw.cd = 1 / rate;
        const targets = [first];
        while (targets.length < s.count) {
          const nx = this.acquire(tw, R, 0, targets);
          if (!nx) break;
          targets.push(nx);
        }
        for (let i = 0; i < s.count; i++) {
          const tg = targets[i % targets.length];
          const a = tw.angle + (i - (s.count - 1) / 2) * 0.6;
          this.projectiles.push({ kind: 'missile', x: tw.x, y: tw.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, target: tg, spd: 7 * TILE, dmg, airMult: s.airMult, splash: s.splash * TILE, life: 3 });
        }
        tw.flash = 0.15;
        sfx('missile');
        break;
      }
      case 'wind': {
        if (tw.cd > 0) break;
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        tw.cd = 1 / rate;
        tw.flash = 0.2;
        sfx('wind');
        const list = s.all ? this.inRange(tw.x, tw.y, R, true).filter(e => this.targetable(e, s)) : [tg];
        for (const e of list) {
          this.damage(e, dmg);
          this.knockback(e, s.knock * TILE);
          this.effects.push({ type: 'swirl', x: e.x, y: e.y, t: 0, dur: 0.5 });
        }
        break;
      }
      case 'blackhole': {
        tw.cd = Math.max(0, tw.cd - dt);
        if (tw.cd > 0) break;
        const tg = this.acquire(tw, R);
        if (!tg) break;
        aim(tg);
        tw.cd = s.cd / tw.rateMult;
        this.fields.push({ x: tg.x, y: tg.y, r: s.radius * TILE, until: t + s.hold, dps: dmg, t: 0 });
        tw.flash = 0.3;
        sfx('blackhole');
        break;
      }
    }
  }

  updateFields(dt) {
    const t = this.t;
    for (const f of this.fields) {
      f.t += dt;
      for (const e of this.enemies) {
        if (!this.canBeHit(e)) continue;
        if (hypot(e.x, e.y, f.x, f.y) > f.r) continue;
        if (e.boss || e.raid) this.applySlow(e, 0.3, 0.2);
        else { e.heldUntil = t + 0.1; e.pullX = f.x; e.pullY = f.y; }
        this.damage(e, f.dps * dt, { dot: true });
      }
    }
    this.fields = this.fields.filter(f => t < f.until);
  }

  explode(x, y, r, dmg, o = {}) {
    for (const e of this.enemies) {
      if (!this.canBeHit(e)) continue;
      if (o.ground && e.air) continue;
      if (hypot(e.x, e.y, x, y) > r + e.r * 0.5) continue;
      this.damage(e, dmg * (o.airMult && e.air ? o.airMult : 1));
      if (o.burnDps && !e.dead) this.addBurn(e, o.burnDps, o.burnDur);
    }
    this.effects.push({ type: 'boom', x, y, r, t: 0, dur: 0.4, fire: !!o.burnDps });
    this.effects.push({ type: 'shock', x, y, r: r * 1.3, t: 0, dur: 0.3, color: 'rgba(255,240,200,0.9)' });
    this.burst(x, y, 4, 'debris');
    sfx('boom');
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      switch (p.kind) {
        case 'bullet': {
          const e = p.target;
          if (!this.canBeHit(e)) { p.done = true; break; }
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy), step = p.spd * dt;
          if (d <= step + e.r * 0.6) {
            this.damage(e, p.dmg, { pierce: p.pierce });
            this.effects.push({ type: 'spark', x: p.x + dx * 0.7, y: p.y + dy * 0.7, t: 0, dur: 0.12 });
            p.done = true;
          } else { p.x += dx / d * step; p.y += dy / d * step; p.a = Math.atan2(dy, dx); }
          break;
        }
        case 'pellet': {
          p.life -= dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.life <= 0) { p.done = true; break; }
          for (const e of this.enemies) {
            if (!this.canBeHit(e) || (e.air && !p.air)) continue;
            if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < e.r * e.r) {
              this.damage(e, p.dmg);
              if (p.knock) this.knockback(e, p.knock);
              p.done = true;
              break;
            }
          }
          break;
        }
        case 'shell': {
          p.t += dt;
          if (p.t >= p.dur) { p.done = true; this.explode(p.tx, p.ty, p.splash, p.dmg, { ground: true, burnDps: p.burnDps, burnDur: p.burnDur }); }
          break;
        }
        case 'missile': {
          p.life -= dt;
          let e = p.target;
          if (!e || !this.canBeHit(e)) {
            e = null;
            let bd = 260;
            for (const o of this.enemies) {
              if (!this.canBeHit(o)) continue;
              const d = hypot(o.x, o.y, p.x, p.y);
              if (d < bd) { bd = d; e = o; }
            }
            p.target = e;
          }
          if (e) {
            const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
            const k = Math.min(1, dt * 7);
            p.vx += (dx / d * p.spd - p.vx) * k;
            p.vy += (dy / d * p.spd - p.vy) * k;
            if (d < e.r + 4) { p.done = true; this.explode(p.x, p.y, p.splash, p.dmg, { airMult: p.airMult }); break; }
          }
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (Math.random() < 0.6) this.effects.push({ type: 'smoke', x: p.x, y: p.y, t: 0, dur: 0.4 });
          if (p.life <= 0) { p.done = true; this.explode(p.x, p.y, p.splash, p.dmg, { airMult: p.airMult }); }
          break;
        }
        case 'rock': {
          p.t += dt;
          if (p.t >= p.dur) {
            p.done = true;
            const tw = p.tower;
            if (!tw.dead) {
              tw.dead = true;
              this.shake = 0.3;
              this.effects.push({ type: 'boom', x: tw.x, y: tw.y, r: 36, t: 0, dur: 0.5 });
              this.burst(tw.x, tw.y, 14, 'debris');
              sfx('boom');
              this.hooks.toast(`🦍 金剛砸毀了你的 ${tw.def.icon}${tw.def.name}！`, 'warn');
            }
          }
          break;
        }
        case 'strike': {
          p.t += dt;
          if (p.t >= p.dur) {
            p.done = true;
            this.shake = 0.4;
            this.explode(p.x, p.y, 2 * TILE, p.dmg, {});
            for (let i = 0; i < 4; i++) this.effects.push({ type: 'boom', x: p.x + (Math.random() - 0.5) * 70, y: p.y + (Math.random() - 0.5) * 70, r: 40, t: -i * 0.08, dur: 0.45, fire: true });
          }
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);
  }

  updateEffects(dt) {
    for (const f of this.effects) {
      f.t += dt;
      if (f.t < 0 || f.vx === undefined) continue;
      f.x += f.vx * dt; f.y += f.vy * dt;
      const g = GRAVITY[f.type];
      if (g) f.vy += g * dt;
      if (f.type === 'dust' || f.type === 'smokePuff') { f.vx *= 1 - 3 * dt; f.vy *= 1 - 3 * dt; }
      if (f.type === 'confetti') f.x += Math.sin(f.t * 4 + f.rot) * 30 * dt;
    }
    this.effects = this.effects.filter(f => f.t < f.dur);
    this.shake = Math.max(0, this.shake - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  // ============================================================
  //  渲染
  // ============================================================
  renderBackground() {
    const cv = document.createElement('canvas');
    cv.width = WIDTH * DPR; cv.height = HEIGHT * DPR;
    const c = cv.getContext('2d');
    c.scale(DPR, DPR);
    const th = this.map.theme;
    for (let gx = 0; gx < COLS; gx++) for (let gy = 0; gy < ROWS; gy++) {
      c.fillStyle = (gx + gy) % 2 ? th.ground : th.ground2;
      c.fillRect(gx * TILE, gy * TILE, TILE, TILE);
    }
    const rng = mulberry32(this.chapter * 31 + 5);
    for (let i = 0; i < 160; i++) {
      c.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.05)';
      c.beginPath();
      c.arc(rng() * WIDTH, rng() * HEIGHT, 1.5 + rng() * 2.5, 0, Math.PI * 2);
      c.fill();
    }
    const pts = this.map.pts;
    const trace = () => { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); };
    c.lineJoin = 'round'; c.lineCap = 'round';
    trace(); c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = TILE * 0.98; c.stroke();
    trace(); c.strokeStyle = th.edge; c.lineWidth = TILE * 0.9; c.stroke();
    trace(); c.strokeStyle = th.path; c.lineWidth = TILE * 0.72; c.stroke();
    trace(); c.setLineDash([3, 16]); c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 4; c.stroke(); c.setLineDash([]);
    for (const d of this.map.decor) {
      c.fillStyle = 'rgba(0,0,0,0.13)';
      c.beginPath(); c.ellipse((d.gx + 0.5) * TILE, (d.gy + 0.5) * TILE + 13, 14, 5, 0, 0, Math.PI * 2); c.fill();
    }
    return cv;
  }

  // 會動的場景：搖擺的裝飾、旗子、農場
  drawScenery() {
    const c = this.ctx, rt = this.rt;
    this.map.decor.forEach((d, i) => {
      const sway = Math.sin(rt * 1.6 + i * 1.7) * 0.06;
      // 以底部為軸心搖擺
      const x = (d.gx + 0.5) * TILE, y = (d.gy + 0.5) * TILE + 12;
      c.save(); c.translate(x, y); c.rotate(sway);
      drawEmoji(c, d.icon, 0, -12, 30);
      c.restore();
    });
    const en = this.map.entry;
    c.save(); c.translate(en.x - 6, en.y + 8); c.rotate(Math.sin(rt * 4) * 0.12);
    drawEmoji(c, '🚩', 6, -12, 24);
    c.restore();
    const b = this.map.base;
    const sh = this.baseShake > 0 ? (Math.random() - 0.5) * 8 * Math.min(1, this.baseShake * 2) : 0;
    const breathe = 1 + Math.sin(rt * 2) * 0.03;
    const hpRatio = this.hp / this.maxHp;
    drawEmoji(c, this.defeated ? '🏚️' : '🏡', b.x + sh, b.y - 4, 42, false, 1, 0, 1 / breathe, breathe);
    if (!this.defeated && hpRatio < 0.35) drawEmoji(c, '💨', b.x + 14, b.y - 28 - (rt * 20 % 10), 16, false, 0.7);
  }

  drawAmbient() {
    const c = this.ctx;
    for (const cl of this.clouds) {
      c.fillStyle = 'rgba(0,0,0,0.06)';
      c.beginPath();
      c.ellipse(cl.x, cl.y, 110 * cl.s, 40 * cl.s, 0, 0, Math.PI * 2);
      c.ellipse(cl.x + 70 * cl.s, cl.y + 10, 70 * cl.s, 30 * cl.s, 0, 0, Math.PI * 2);
      c.fill();
    }
    for (const a of this.ambient) {
      switch (a.kind) {
        case 'petal': case 'leaf':
          drawEmoji(c, a.icon, a.x, a.y, a.size, a.icon === '🦋' && Math.sin(a.ph * 3) > 0, 0.85, Math.sin(a.ph * 2) * 0.6, a.icon === '🦋' ? Math.abs(Math.sin(a.ph * 12)) * 0.7 + 0.3 : 1);
          break;
        case 'snow':
          c.fillStyle = 'rgba(255,255,255,0.9)';
          c.beginPath(); c.arc(a.x + Math.sin(a.ph * 2) * 6, a.y, a.size, 0, Math.PI * 2); c.fill();
          break;
        case 'sand':
          c.fillStyle = 'rgba(200,160,90,0.45)';
          c.fillRect(a.x, a.y, a.size * 6, a.size);
          break;
        case 'ember': {
          const f = a.life ? 1 - a.ph / a.life : 1;
          c.fillStyle = `rgba(255,${120 + Math.floor(Math.sin(a.ph * 8) * 60)},40,${Math.max(0, f)})`;
          c.beginPath(); c.arc(a.x + Math.sin(a.ph * 3) * 5, a.y, a.size, 0, Math.PI * 2); c.fill();
          break;
        }
      }
    }
  }

  drawBanner() {
    const b = this.banner;
    if (!b) return;
    const c = this.ctx, p = b.t / b.dur;
    // 從左滑入 → 停留 → 往右滑出
    let x;
    if (b.t < 0.35) x = -WIDTH * (1 - easeOutBack(b.t / 0.35));
    else if (b.t > b.dur - 0.3) x = WIDTH * easeOutCubic((b.t - (b.dur - 0.3)) / 0.3);
    else x = 0;
    const alpha = Math.min(1, b.t * 6, (b.dur - b.t) * 4);
    const y = HEIGHT / 2;
    c.save();
    c.globalAlpha = Math.max(0, alpha) * 0.55;
    c.fillStyle = '#000';
    c.fillRect(0, y - 52, WIDTH, 104);
    c.globalAlpha = Math.max(0, alpha);
    c.translate(x + WIDTH / 2, y);
    c.fillStyle = b.color;
    c.fillRect(-WIDTH / 2, -44, WIDTH, 4);
    c.fillRect(-WIDTH / 2, 40, WIDTH, 4);
    const scale = 1 + Math.sin(p * Math.PI * 6) * 0.015;
    c.scale(scale, scale);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 46px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    c.lineWidth = 8; c.strokeStyle = 'rgba(40,20,10,0.9)';
    c.strokeText(b.text, 0, -10);
    c.fillStyle = b.color; c.fillText(b.text, 0, -10);
    c.font = `700 20px "Noto Sans TC","Microsoft JhengHei",${EMOJI_FONT}`;
    c.lineWidth = 5; c.strokeText(b.sub, 0, 26);
    c.fillStyle = '#fff'; c.fillText(b.sub, 0, 26);
    c.restore();
  }

  render() {
    const c = this.ctx, t = this.t;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.save();
    if (this.shake > 0) c.translate((Math.random() - 0.5) * 10 * this.shake, (Math.random() - 0.5) * 10 * this.shake);
    c.drawImage(this.bg, 0, 0, WIDTH, HEIGHT);

    // 突襲出口（洞穴）
    const holes = raidCountFor(this.level);
    for (let i = 0; i < holes; i++) {
      const p = this.map.posAt(this.map.mids[i]);
      c.fillStyle = 'rgba(60,35,20,0.55)';
      c.beginPath(); c.ellipse(p.x, p.y, 17, 10, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(20,10,5,0.7)';
      c.beginPath(); c.ellipse(p.x, p.y + 1, 11, 6, 0, 0, Math.PI * 2); c.fill();
    }
    this.drawScenery();

    // 放置預覽
    const m = this.mouse;
    if (this.placing && m) {
      const ok = this.canPlace(this.placing, m.gx, m.gy) && this.gold >= TOWERS[this.placing].cost;
      c.fillStyle = ok ? 'rgba(80,255,120,0.35)' : 'rgba(255,60,60,0.35)';
      c.fillRect(m.gx * TILE, m.gy * TILE, TILE, TILE);
      const def = TOWERS[this.placing];
      const cx = (m.gx + 0.5) * TILE, cy = (m.gy + 0.5) * TILE;
      if (def.range && def.kind !== 'trap') this.drawRange(cx, cy, def.range * TILE * this.rangeTalent, ok);
      drawEmoji(c, def.icon, cx, cy, 24, false, 0.7);
    }
    if (this.selected) {
      const s = this.selected;
      if (s.s.range && s.s.kind !== 'trap') this.drawRange(s.x, s.y, s.s.kind === 'support' ? s.s.range * TILE : s.R, true);
      if (s.s.reveal) this.drawRange(s.x, s.y, s.s.reveal * TILE * this.rangeTalent, true, true);
      if (s.s.minRange) { c.strokeStyle = 'rgba(255,80,80,0.6)'; c.setLineDash([4, 4]); c.beginPath(); c.arc(s.x, s.y, s.s.minRange * TILE, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    }

    for (const tw of this.towers) if (tw.s.kind === 'trap') this.drawTrap(tw);
    for (const f of this.fields) this.drawField(f);
    for (const e of this.enemies) if (!e.air) this.drawEnemy(e);
    for (const tw of this.towers) if (tw.s.kind !== 'trap') this.drawTower(tw);
    for (const tw of this.towers) if (tw.s.kind === 'beam' && tw.target && !tw.dead && tw.stunUntil <= t) this.drawBeam(tw);
    for (const e of this.enemies) if (e.air) this.drawEnemy(e);
    for (const p of this.projectiles) this.drawProjectile(p);
    for (const f of this.effects) this.drawEffect(f);
    this.drawAmbient();

    // 空襲瞄準
    if (this.targeting && m) {
      c.strokeStyle = '#ff4d4d'; c.lineWidth = 3;
      c.beginPath(); c.arc(m.x, m.y, 2 * TILE, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(m.x - 14, m.y); c.lineTo(m.x + 14, m.y); c.moveTo(m.x, m.y - 14); c.lineTo(m.x, m.y + 14); c.stroke();
      c.fillStyle = 'rgba(255,60,60,0.12)'; c.beginPath(); c.arc(m.x, m.y, 2 * TILE, 0, Math.PI * 2); c.fill();
    }
    c.restore();

    this.drawBossBars();
    if (this.defeated) {
      c.fillStyle = 'rgba(40,30,30,0.35)';
      c.fillRect(0, 0, WIDTH, HEIGHT);
    }
    this.drawBanner();
    if (this.hurtFlash > 0) {
      c.fillStyle = `rgba(255,0,0,${this.hurtFlash * 0.5})`;
      c.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (this.goldDoubleUntil > t) {
      c.fillStyle = 'rgba(255,215,0,0.9)';
      c.font = `bold 14px ${EMOJI_FONT}`;
      c.textAlign = 'right';
      c.fillText(`✨ 金幣 ×2  ${Math.ceil(this.goldDoubleUntil - t)}s`, WIDTH - 10, HEIGHT - 10);
    }
  }

  drawRange(x, y, r, ok, dashed) {
    const c = this.ctx;
    c.fillStyle = ok ? 'rgba(255,255,255,0.13)' : 'rgba(255,80,80,0.12)';
    c.strokeStyle = ok ? 'rgba(255,255,255,0.75)' : 'rgba(255,80,80,0.7)';
    c.lineWidth = 2;
    if (dashed) c.setLineDash([6, 6]);
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (!dashed) c.fill();
    c.stroke();
    c.setLineDash([]);
  }

  drawTrap(tw) {
    const c = this.ctx, x = tw.x, y = tw.y;
    c.fillStyle = 'rgba(80,60,40,0.35)';
    rrect(c, x - 20, y - 20, 40, 40, 8); c.fill();
    c.fillStyle = tw.flash > 0 ? '#ffffff' : (tw.s.poisonDps ? '#8fd14f' : '#c7ccd6');
    c.strokeStyle = '#555c68'; c.lineWidth = 1;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sx = x - 13 + i * 13, sy = y - 9 + j * 12;
      c.beginPath(); c.moveTo(sx - 5, sy + 5); c.lineTo(sx, sy - 6); c.lineTo(sx + 5, sy + 5); c.closePath(); c.fill(); c.stroke();
    }
    const f = tw.uses / tw.s.uses;
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x - 16, y + 16, 32, 4);
    c.fillStyle = '#ffd84a'; c.fillRect(x - 16, y + 16, 32 * f, 4);
    if (tw === this.selected) { c.strokeStyle = '#ffffff'; c.lineWidth = 2; rrect(c, x - 21, y - 21, 42, 42, 9); c.stroke(); }
  }

  drawTower(tw) {
    const c = this.ctx, x = tw.x, y = tw.y, def = tw.def, s = tw.s, t = this.t;
    // 放置時彈出、升級時跳一下、開火時壓扁
    const age = this.rt - tw.born, up = this.rt - tw.upT;
    let sc = age < 0.4 ? Math.max(0.01, easeOutBack(age / 0.4)) : 1;
    if (up < 0.4) sc *= 1 + Math.sin(up / 0.4 * Math.PI) * 0.25;
    const k = Math.min(1, tw.flash * 8);
    const sx = sc * (1 + k * 0.08), sy = sc * (1 - k * 0.08);
    c.save();
    c.translate(x, y + 18); c.scale(sx, sy); c.translate(-x, -(y + 18));
    if (tw.lv >= MAX_LV) {
      // 終極等級：金色光環
      const pulse = 0.5 + Math.sin(this.rt * 4 + tw.id) * 0.5;
      c.fillStyle = `rgba(255,200,40,${0.18 + pulse * 0.15})`;
      c.beginPath(); c.arc(x, y, 27 + pulse * 2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,215,80,0.9)'; c.lineWidth = 2; c.setLineDash([5, 5]); c.lineDashOffset = -this.rt * 20;
      c.beginPath(); c.arc(x, y, 26, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]); c.lineDashOffset = 0;
    }
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath(); c.ellipse(x + 2, y + 17, 19, 6, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(x, y - 20, x, y + 20);
    g.addColorStop(0, shade(def.color, 0.35));
    g.addColorStop(1, shade(def.color, -0.15));
    c.fillStyle = g;
    rrect(c, x - 19, y - 19, 38, 38, 11); c.fill();
    c.strokeStyle = shade(def.color, -0.4); c.lineWidth = 2.5; c.stroke();

    if (s.kind === 'support' || s.kind === 'mine' || s.kind === 'heal') {
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 15, t * 2, t * 2 + Math.PI * 1.2); c.stroke();
    }
    if (AIM_KINDS.has(s.kind) && s.kind !== 'blackhole') {
      c.save();
      c.translate(x, y); c.rotate(tw.angle);
      const recoil = tw.flash > 0 ? -3 : 0;
      c.fillStyle = '#3d4352';
      const len = s.kind === 'sniper' ? 28 : s.kind === 'mortar' ? 16 : 22, w = s.kind === 'mortar' ? 12 : s.kind === 'spread' ? 10 : 7;
      rrect(c, 4 + recoil, -w / 2, len, w, 3); c.fill();
      if (s.kind === 'bullet' && tw.branch === 0) { rrect(c, 4 + recoil, -w / 2 - 6, len - 4, 5, 2); c.fill(); }
      if (tw.flash > 0 && (s.kind === 'bullet' || s.kind === 'spread' || s.kind === 'sniper')) {
        c.fillStyle = '#ffe066';
        c.beginPath(); c.arc(len + 6, 0, 5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    if (s.kind === 'blackhole') {
      const ready = tw.cd <= 0;
      c.fillStyle = ready ? 'rgba(20,0,40,0.8)' : 'rgba(20,0,40,0.4)';
      c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill();
    }
    drawEmoji(c, def.icon, x, y - 1, 20, false, 1, s.kind === 'blackhole' ? t * 3 : 0);

    // 等級星星
    for (let i = 0; i < tw.lv; i++) {
      c.fillStyle = tw.lv >= MAX_LV ? '#ff9f1c' : '#ffd84a'; c.strokeStyle = '#8a6500'; c.lineWidth = 1;
      c.beginPath(); c.arc(x - (tw.lv - 1) * 4.5 + i * 9, y + 19, 3.5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (tw.lv >= MAX_LV) drawEmoji(c, '👑', x - 15, y - 17, 12, false, 1, -0.3);
    if (tw.branch != null) {
      c.fillStyle = tw.branch === 0 ? '#ff8a3d' : '#4f8ff0';
      c.beginPath(); c.arc(x + 15, y - 15, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(tw.branch === 0 ? 'A' : 'B', x + 15, y - 14.5);
    }
    if (tw.buffed) { c.fillStyle = '#5dff8a'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText('▲', x - 20, y + 4); }
    if (tw.stunUntil > t) drawEmoji(c, '💫', x, y - 24, 18, false, 1, t * 4);
    if (s.kind === 'mine') {
      // 金礦閃光
      const gl = (this.rt * 0.7 + tw.id * 0.37) % 1;
      if (gl < 0.15) drawEmoji(c, '✨', x + 10, y - 10, 12, false, 1 - gl / 0.15);
    }
    if (s.kind === 'heal') drawEmoji(c, '💗', x, y - 22 - (this.rt * 12 % 12), 10, false, 1 - (this.rt * 12 % 12) / 12);
    c.restore();
    if (tw === this.selected) { c.strokeStyle = '#ffffff'; c.lineWidth = 2.5; rrect(c, x - 22, y - 22, 44, 44, 13); c.stroke(); }
  }

  drawBeam(tw) {
    const c = this.ctx, e = tw.target;
    const sx = tw.x + Math.cos(tw.angle) * 18, sy = tw.y + Math.sin(tw.angle) * 18;
    const w = 2 + tw.beamM * 1.2;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,80,110,0.4)'; c.lineWidth = w + 6;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(e.x, e.y); c.stroke();
    c.strokeStyle = '#ff5d73'; c.lineWidth = w;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(e.x, e.y); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, w / 3);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(e.x, e.y); c.stroke();
    c.restore();
  }

  drawEnemy(e) {
    const c = this.ctx, t = this.t;
    let x = e.x, y = e.y;
    if (e.heldUntil > t) { x += (e.pullX - x) * 0.45; y += (e.pullY - y) * 0.45; }
    const size = 26 * e.size;
    const bob = Math.abs(Math.sin(e.walk * 9)) * 3 * Math.min(1, e.size);
    let alpha = 1;
    if (e.def.invis) alpha = e.revealed ? 0.75 : 0.22;
    if (e.diveUntil > t) alpha = 0.3;

    if (e.burrowed) {
      c.fillStyle = '#7a5532';
      c.beginPath(); c.ellipse(x, y + 6, size * 0.45, size * 0.22, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5c3d22';
      c.beginPath(); c.ellipse(x, y + 4, size * 0.25, size * 0.1, 0, 0, Math.PI * 2); c.fill();
      return;
    }
    const lift = e.air ? 14 + Math.sin(e.walk * 4) * 3 : 0;
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath(); c.ellipse(x, y + size * 0.42, size * (e.air ? 0.26 : 0.38), size * 0.12, 0, 0, Math.PI * 2); c.fill();
    if (e.diveUntil > t) {
      c.strokeStyle = 'rgba(120,200,255,0.8)'; c.lineWidth = 2;
      for (let i = 0; i < 2; i++) { c.beginPath(); c.ellipse(x, y + 8, size * (0.4 + i * 0.2 + (t % 1) * 0.2), size * 0.15, 0, 0, Math.PI * 2); c.stroke(); }
    }
    if (e.boss || e.raid) {
      c.fillStyle = e.boss ? 'rgba(200,60,255,0.18)' : 'rgba(255,60,60,0.18)';
      c.beginPath(); c.arc(x, y - lift, size * 0.6 + Math.sin(t * 5) * 2, 0, Math.PI * 2); c.fill();
    }
    // 出場彈出 / 突襲 BOSS 從地底升起、走路搖擺、被打壓扁
    const age = this.rt - e.born;
    let pop = 1, riseOff = 0;
    if (e.rise && age < 0.7) { riseOff = (1 - easeOutBack(age / 0.7)) * size * 0.9; alpha *= Math.min(1, age * 3); }
    else if (age < 0.3) pop = Math.max(0.05, easeOutBack(age / 0.3));
    const ey = y - bob - lift + riseOff;
    const sq = e.squash / 0.15;
    const waddle = e.curSpeed > 0 && !e.air ? Math.sin(e.walk * 9) * 0.09 : 0;
    drawEmoji(c, e.def.icon, x, ey, size * pop, e.face > 0, alpha, waddle, 1 + sq * 0.18, 1 - sq * 0.18);
    if (e.air) {
      // 飛行動物的翅膀風
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5;
      const wf = Math.sin(e.walk * 20) * 4;
      c.beginPath(); c.moveTo(x - size * 0.5, ey + wf); c.lineTo(x - size * 0.7, ey + wf - 3); c.moveTo(x + size * 0.5, ey + wf); c.lineTo(x + size * 0.7, ey + wf - 3); c.stroke();
    }
    if (e.flash > 0) {
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.beginPath(); c.arc(x, ey, size * 0.42, 0, Math.PI * 2); c.fill();
    }
    if (e.frozenUntil > t) {
      c.fillStyle = 'rgba(150,220,255,0.45)'; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5;
      rrect(c, x - size * 0.45, ey - size * 0.45, size * 0.9, size * 0.9, 6); c.fill(); c.stroke();
    } else if (e.slowUntil > t && e.slowF < 1) {
      drawEmoji(c, '❄️', x - size * 0.4, ey - size * 0.35, 10);
    }
    if (e.stunUntil > t) drawEmoji(c, '💫', x, ey - size * 0.55, 12, false, 1, t * 5);
    if (e.burnUntil > t) drawEmoji(c, '🔥', x + size * 0.38, ey - size * 0.3, 11 + Math.sin(t * 20));
    if (e.poisonUntil > t) {
      c.fillStyle = 'rgba(140,220,60,0.8)';
      for (let i = 0; i < 2; i++) { c.beginPath(); c.arc(x - 6 + i * 12, ey - size * 0.5 - ((t * 20 + i * 7) % 10), 2.5, 0, Math.PI * 2); c.fill(); }
    }
    if (e.roarUntil > t) drawEmoji(c, '💢', x + size * 0.35, ey - size * 0.4, 11);
    if (e.boss) drawEmoji(c, '👑', x, ey - size * 0.62, 16);
    else if (e.raid) drawEmoji(c, '⭐', x, ey - size * 0.6, 13);

    if (e.hp < e.maxHp || e.boss || e.raid) {
      const w = Math.max(22, size * 0.9), h = e.boss ? 5 : 4, bx = x - w / 2, by = ey - size * 0.55 - 6;
      const f = Math.max(0, e.hp / e.maxHp);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(bx - 1, by - 1, w + 2, h + 2);
      c.fillStyle = f > 0.6 ? '#5ee06a' : f > 0.3 ? '#ffd23f' : '#ff5a5a';
      c.fillRect(bx, by, w * f, h);
    }
  }

  drawField(f) {
    const c = this.ctx;
    const g = c.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r);
    g.addColorStop(0, 'rgba(10,0,25,0.9)');
    g.addColorStop(0.5, 'rgba(90,40,160,0.45)');
    g.addColorStop(1, 'rgba(90,40,160,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(200,160,255,0.6)'; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = f.t * 4 + i * 2.1;
      c.beginPath(); c.arc(f.x, f.y, f.r * (0.3 + i * 0.22), a, a + 2); c.stroke();
    }
  }

  drawProjectile(p) {
    const c = this.ctx;
    switch (p.kind) {
      case 'bullet':
        if (p.a !== undefined) {
          c.strokeStyle = 'rgba(255,230,120,0.5)'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - Math.cos(p.a) * 12, p.y - Math.sin(p.a) * 12); c.stroke();
        }
        c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill();
        break;
      case 'pellet':
        c.fillStyle = '#ffb347'; c.beginPath(); c.arc(p.x, p.y, 2.5, 0, Math.PI * 2); c.fill();
        break;
      case 'shell': {
        const f = p.t / p.dur;
        const x = p.sx + (p.tx - p.sx) * f, y = p.sy + (p.ty - p.sy) * f - Math.sin(f * Math.PI) * 90;
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(p.sx + (p.tx - p.sx) * f, p.sy + (p.ty - p.sy) * f, 5, 2, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3b3b3b'; c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'missile': {
        const a = Math.atan2(p.vy, p.vx);
        c.save(); c.translate(p.x, p.y); c.rotate(a);
        c.fillStyle = '#e6e9ef'; rrect(c, -7, -3, 14, 6, 3); c.fill();
        c.fillStyle = '#ff5a5a'; c.beginPath(); c.moveTo(7, -3); c.lineTo(11, 0); c.lineTo(7, 3); c.fill();
        c.restore();
        break;
      }
      case 'rock': {
        const f = p.t / p.dur;
        const x = p.sx + (p.tx - p.sx) * f, y = p.sy + (p.ty - p.sy) * f - Math.sin(f * Math.PI) * 110;
        c.fillStyle = 'rgba(255,0,0,0.25)'; c.beginPath(); c.arc(p.tx, p.ty, 22, 0, Math.PI * 2); c.fill();
        drawEmoji(c, '🪨', x, y, 26, false, 1, f * 8);
        break;
      }
      case 'strike': {
        const f = p.t / p.dur;
        c.strokeStyle = `rgba(255,60,60,${0.5 + f * 0.5})`; c.lineWidth = 3;
        c.beginPath(); c.arc(p.x, p.y, 2 * TILE * (1 - f * 0.3), 0, Math.PI * 2); c.stroke();
        drawEmoji(c, '✈️', p.x - 200 + f * 400, p.y - 60, 28);
        break;
      }
    }
  }

  drawEffect(f) {
    const c = this.ctx;
    if (f.t < 0) return;
    const p = f.t / f.dur;
    switch (f.type) {
      case 'ring':
        c.strokeStyle = f.color; c.globalAlpha = (1 - p) * (f.faint ? 0.3 : 0.8); c.lineWidth = f.faint ? 2 : 3;
        c.beginPath(); c.arc(f.x, f.y, f.grow ? f.r * (0.4 + p * 0.6) : f.r * (0.85 + p * 0.15), 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
        break;
      case 'shock':
        c.strokeStyle = f.color || '#8a5a2b'; c.globalAlpha = 1 - p; c.lineWidth = 6 * (1 - p) + 1;
        c.beginPath(); c.arc(f.x, f.y, f.r * p, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
        break;
      case 'boom': {
        c.globalAlpha = 1 - p;
        c.fillStyle = f.fire ? '#ff8a3d' : '#ffd166';
        c.beginPath(); c.arc(f.x, f.y, f.r * (0.4 + p * 0.6), 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff3c4';
        c.beginPath(); c.arc(f.x, f.y, f.r * 0.4 * (1 - p), 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
        break;
      }
      case 'poof': {
        // 可愛版：動物被打暈，轉圈圈飛走
        const y = f.y - p * 40;
        drawEmoji(c, f.icon, f.x + p * 20 * f.face, y, f.size * (1 - p * 0.3), f.face > 0, 1 - p, p * 6);
        drawEmoji(c, '💫', f.x, y - f.size * 0.5, 14, false, 1 - p, p * 8);
        break;
      }
      case 'text':
        c.globalAlpha = Math.min(1, (1 - p) * 2);
        c.font = `900 ${f.big ? 22 : f.small ? 13 : 16}px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 3; c.strokeStyle = 'rgba(60,30,10,0.8)';
        c.strokeText(f.text, f.x, f.y - p * 26);
        c.fillStyle = f.color; c.fillText(f.text, f.x, f.y - p * 26);
        c.globalAlpha = 1;
        break;
      case 'spark':
        c.fillStyle = `rgba(255,240,150,${1 - p})`;
        c.beginPath(); c.arc(f.x, f.y, 4 * (1 - p) + 1, 0, Math.PI * 2); c.fill();
        break;
      case 'line':
        c.strokeStyle = f.color; c.globalAlpha = 1 - p; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x2, f.y2); c.stroke();
        c.globalAlpha = 1;
        break;
      case 'bolt': {
        c.globalAlpha = 1 - p;
        for (const [col, w] of [['rgba(178,141,255,0.6)', 6], ['#ffffff', 2]]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath();
          for (let i = 1; i < f.pts.length; i++) {
            const a = f.pts[i - 1], b = f.pts[i];
            c.moveTo(a.x, a.y);
            for (let k = 1; k <= 4; k++) {
              const q = k / 4;
              const jx = k < 4 ? (Math.random() - 0.5) * 12 : 0, jy = k < 4 ? (Math.random() - 0.5) * 12 : 0;
              c.lineTo(a.x + (b.x - a.x) * q + jx, a.y + (b.y - a.y) * q + jy);
            }
          }
          c.stroke();
        }
        c.globalAlpha = 1;
        break;
      }
      case 'flame': {
        const r = 4 + p * 10;
        c.fillStyle = p < 0.4 ? `rgba(255,230,120,${1 - p})` : `rgba(255,${Math.round(140 - p * 100)},40,${1 - p})`;
        c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'smoke':
        c.fillStyle = `rgba(220,220,220,${0.5 * (1 - p)})`;
        c.beginPath(); c.arc(f.x, f.y, 2 + p * 4, 0, Math.PI * 2); c.fill();
        break;
      case 'swirl':
        drawEmoji(c, '🌪️', f.x, f.y - 6, 20, false, 1 - p, p * 10);
        break;
      case 'dirt':
        c.fillStyle = `rgba(110,75,40,${1 - p})`;
        c.beginPath(); c.arc(f.x, f.y, 4, 0, Math.PI * 2); c.fill();
        break;
      case 'warn': {
        const pulse = (Math.sin(f.t * 12) + 1) / 2;
        c.fillStyle = `rgba(255,40,40,${0.15 + pulse * 0.25})`;
        c.beginPath(); c.arc(f.x, f.y, 26 + pulse * 6, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(80,40,20,0.9)'; c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + 0.3, l = 8 + p * 20;
          c.moveTo(f.x, f.y); c.lineTo(f.x + Math.cos(a) * l, f.y + Math.sin(a) * l * 0.6);
        }
        c.stroke();
        drawEmoji(c, '⚠️', f.x, f.y - 34, 22 + pulse * 4);
        break;
      }
      case 'dust':
        c.fillStyle = `rgba(150,120,80,${0.5 * (1 - p)})`;
        c.beginPath(); c.arc(f.x, f.y, 3 + p * 6, 0, Math.PI * 2); c.fill();
        break;
      case 'smokePuff':
        c.fillStyle = `rgba(230,230,230,${0.6 * (1 - p)})`;
        c.beginPath(); c.arc(f.x, f.y, 3 + p * 8, 0, Math.PI * 2); c.fill();
        break;
      case 'puff':
        c.fillStyle = `rgba(255,255,255,${0.7 * (1 - p)})`;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.256;
          c.beginPath(); c.arc(f.x + Math.cos(a) * f.r * p * 1.5, f.y + Math.sin(a) * f.r * p * 1.5, f.r * 0.5 * (1 - p * 0.5), 0, Math.PI * 2); c.fill();
        }
        break;
      case 'star':
        drawEmoji(c, '⭐', f.x, f.y, 10 * (1 - p * 0.5), false, 1 - p, f.rot + p * 6);
        break;
      case 'debris':
        c.save(); c.translate(f.x, f.y); c.rotate(f.rot + p * 10);
        c.fillStyle = `rgba(110,80,50,${1 - p})`; c.fillRect(-3, -2, 6, 4);
        c.restore();
        break;
      case 'confetti': case 'confettiBurst':
        c.save(); c.translate(f.x, f.y); c.rotate(f.rot + f.t * 6);
        c.fillStyle = `hsla(${f.hue},85%,60%,${Math.min(1, (1 - p) * 3)})`;
        c.fillRect(-4, -2, 8, 4 * Math.abs(Math.cos(f.t * 8)) + 0.5);
        c.restore();
        break;
      case 'coin': {
        const e = easeOutCubic(p), tx = 150, ty = -20;
        const x = f.sx + (tx - f.sx) * e, y = f.sy + (ty - f.sy) * e - Math.sin(p * Math.PI) * f.arc;
        drawEmoji(c, '🪙', x, y, 14, false, p > 0.85 ? (1 - p) / 0.15 : 1, 0, Math.abs(Math.cos(f.t * 10)) * 0.8 + 0.2, 1);
        break;
      }
      case 'heart':
        drawEmoji(c, '❤️', f.x + Math.sin(f.t * 6) * 6, f.y - p * 50, 14 * (0.6 + p * 0.6), false, 1 - p);
        break;
      case 'flake':
        drawEmoji(c, '❄️', f.x, f.y + p * 20, 14, false, Math.sin(p * Math.PI), p * 3);
        break;
      case 'drop':
        c.fillStyle = `rgba(120,200,255,${1 - p})`;
        c.beginPath(); c.arc(f.x, f.y, 3, 0, Math.PI * 2); c.fill();
        break;
      case 'beamup': {
        const g = c.createLinearGradient(f.x, f.y - 80, f.x, f.y + 20);
        g.addColorStop(0, 'rgba(255,230,100,0)');
        g.addColorStop(1, `rgba(255,230,100,${0.6 * (1 - p)})`);
        c.fillStyle = g;
        c.fillRect(f.x - 20 * (1 - p * 0.5), f.y - 80, 40 * (1 - p * 0.5), 100);
        break;
      }
      case 'screen':
        c.fillStyle = f.color + (0.45 * (1 - p)) + ')';
        c.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
        break;
    }
  }

  drawBossBars() {
    const c = this.ctx;
    const list = this.enemies.filter(e => e.boss || e.raid).slice(0, 3);
    list.forEach((e, i) => {
      const w = 320, h = 14, x = (WIDTH - w) / 2, y = 10 + i * 26;
      c.fillStyle = 'rgba(40,20,10,0.65)';
      rrect(c, x - 34, y - 4, w + 44, h + 8, 8); c.fill();
      drawEmoji(c, e.def.icon, x - 18, y + h / 2, 18);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x, y, w, h);
      c.fillStyle = e.boss ? '#c05cff' : '#ff6060';
      c.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), h);
      c.fillStyle = '#fff'; c.font = 'bold 11px "Noto Sans TC",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`${e.def.name}  ${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`, x + w / 2, y + h / 2 + 0.5);
    });
  }
}
