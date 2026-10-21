'use strict';
// ============================================================
//  介面：存檔、選單、章節、天賦、商店、資訊面板、技能列
// ============================================================

const $ = id => document.getElementById(id);

// ---------- 存檔 ----------
const Save = {
  key: 'animalTD_save_v1',
  data: { unlocked: 1, stars: {}, talents: {} },
  load() {
    try {
      const s = localStorage.getItem(this.key);
      if (s) Object.assign(this.data, JSON.parse(s));
    } catch (e) { /* 無法存取 localStorage 時就只在本次遊玩有效 */ }
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { } },
  talent(id) { return this.data.talents[id] || 0; },
  totalStars() { return Object.values(this.data.stars).reduce((a, b) => a + b, 0); },
  spentStars() {
    let n = 0;
    for (const t of TALENTS) for (let lv = 0; lv < this.talent(t.id); lv++) n += talentCost(lv);
    return n;
  },
  freeStars() { return this.totalStars() - this.spentStars(); },
  recordStars(level, stars) {
    if ((this.data.stars[level] || 0) < stars) { this.data.stars[level] = stars; this.save(); }
  },
  chapterStars(ch) {
    let n = 0;
    for (let L = ch * 10 + 1; L <= ch * 10 + 10; L++) n += this.data.stars[L] || 0;
    return n;
  },
  talentValues() {
    const v = {};
    for (const t of TALENTS) v[t.id] = this.talent(t.id) * t.per;
    return v;
  },
};

// ---------- 畫面切換 ----------
let game = null;
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id !== 'game') Music.play('menu');
  if (id === 'menu') $('menu-stars').textContent = `⭐ ${Save.freeStars()}`;
  if (id === 'chapters') renderChapters();
  if (id === 'talents') renderTalents();
}
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));
// 點按鈕後取消焦點，避免空白鍵重複觸發；順便播放點擊音效
document.addEventListener('click', e => {
  const b = e.target.closest('button, .shop-item, .chapter');
  if (!b) return;
  if (b.blur) b.blur();
  if (!b.disabled) SoundFX.play('click');
});

// ---------- 音量 ----------
const lastVol = { music: SoundFX.settings.music || 0.5, sfx: SoundFX.settings.sfx || 0.7 };
function toggleVolume(kind) {
  const v = SoundFX.settings[kind];
  if (v > 0) { lastVol[kind] = v; SoundFX.setVolume(kind, 0); }
  else SoundFX.setVolume(kind, lastVol[kind] || 0.5);
  updateAudioButtons();
}
function updateAudioButtons() {
  $('btn-music').textContent = SoundFX.settings.music > 0 ? '🎵' : '🔇';
  $('btn-music').classList.toggle('off', SoundFX.settings.music <= 0);
  $('btn-sfx').textContent = SoundFX.settings.sfx > 0 ? '🔊' : '🔈';
  $('btn-sfx').classList.toggle('off', SoundFX.settings.sfx <= 0);
}
$('btn-music').addEventListener('click', () => toggleVolume('music'));
$('btn-sfx').addEventListener('click', () => toggleVolume('sfx'));
function audioSliders() {
  const row = (kind, label) => `
    <label class="slider-row"><span>${label}</span>
      <input type="range" min="0" max="100" value="${Math.round(SoundFX.settings[kind] * 100)}" data-vol="${kind}">
      <b>${Math.round(SoundFX.settings[kind] * 100)}</b></label>`;
  return `<div class="sliders">${row('music', '🎵 背景音樂')}${row('sfx', '🔊 音效')}</div>`;
}
function bindSliders(card) {
  card.querySelectorAll('[data-vol]').forEach(inp => inp.addEventListener('input', () => {
    const v = +inp.value / 100;
    SoundFX.setVolume(inp.dataset.vol, v);
    if (v > 0) lastVol[inp.dataset.vol] = v;
    inp.nextElementSibling.textContent = inp.value;
    if (inp.dataset.vol === 'sfx') SoundFX.play('coin');
    updateAudioButtons();
  }));
}
function showAudioSettings() {
  const card = openModal(`<div class="big-emoji">🔊</div><h2>音量設定</h2>${audioSliders()}
    <div class="btns"><button class="btn primary" id="m-close">完成</button></div>`);
  bindSliders(card);
  card.querySelector('#m-close').addEventListener('click', closeModal);
}
$('btn-audio').addEventListener('click', showAudioSettings);
updateAudioButtons();

function openModal(html, cls = '') {
  const card = $('modal-card');
  card.className = 'modal-card ' + cls;
  card.innerHTML = html;
  $('modal').classList.remove('hidden');
  return card;
}
function closeModal() { $('modal').classList.add('hidden'); }

// ---------- 章節 ----------
function drawMiniMap(cv, def) {
  const w = 300, h = 180, sc = w / WIDTH;
  cv.width = w * DPR; cv.height = h * DPR;
  const c = cv.getContext('2d');
  c.scale(DPR, DPR);
  c.fillStyle = def.theme.ground; c.fillRect(0, 0, w, h);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const trace = () => {
    c.beginPath();
    def.path.forEach(([x, y], i) => { const px = (x + 0.5) * TILE * sc, py = (y + 0.5) * TILE * sc; i ? c.lineTo(px, py) : c.moveTo(px, py); });
  };
  trace(); c.strokeStyle = def.theme.edge; c.lineWidth = TILE * sc * 0.9; c.stroke();
  trace(); c.strokeStyle = def.theme.path; c.lineWidth = TILE * sc * 0.7; c.stroke();
  const last = def.path[def.path.length - 1];
  const bx = Math.min(COLS - 1, Math.max(0, last[0])), by = Math.min(ROWS - 1, Math.max(0, last[1]));
  c.font = `20px ${EMOJI_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('🏡', (bx + 0.5) * TILE * sc, (by + 0.5) * TILE * sc);
  c.fillText(def.icon, w - 18, 18);
}

function renderChapters() {
  $('chap-stars').textContent = `⭐ ${Save.totalStars()} / ${TOTAL_LEVELS * 2}`;
  const list = $('chapter-list');
  list.innerHTML = '';
  MAPS.forEach((def, i) => {
    const locked = i + 1 > Save.data.unlocked;
    const card = document.createElement('div');
    card.className = 'chapter' + (locked ? ' locked' : '');
    const boss = BOSSES[BOSS_AT[i * 10 + 10]];
    const raid = i * 10 + 10 >= 20 ? `　突襲：${RAIDS[raidTypeFor(Math.max(20, i * 10 + 1))].icon}` : '';
    card.innerHTML = `
      <canvas></canvas>
      <h3>${def.icon} 第 ${i + 1} 章・${def.name}</h3>
      <div class="meta"><span>第 ${i * 10 + 1} – ${i * 10 + 10} 關・${def.desc}</span><span>⭐ ${Save.chapterStars(i)}/20</span></div>
      <div class="boss">👑 BOSS：${boss.icon} ${boss.name}${raid}</div>
      ${locked ? '<div class="lock">🔒</div>' : ''}`;
    drawMiniMap(card.querySelector('canvas'), def);
    if (!locked) card.addEventListener('click', () => startGame(i));
    list.appendChild(card);
  });
}

// ---------- 天賦 ----------
function renderTalents() {
  $('talent-stars').textContent = `可用 ⭐ ${Save.freeStars()}`;
  const list = $('talent-list');
  list.innerHTML = '';
  for (const t of TALENTS) {
    const lv = Save.talent(t.id), cost = talentCost(lv), max = lv >= t.max;
    const el = document.createElement('div');
    el.className = 'talent';
    el.innerHTML = `
      <div class="t-head"><span class="t-icon">${t.icon}</span>${t.name}</div>
      <div class="t-desc">${t.desc}</div>
      <div class="pips">${Array.from({ length: t.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
      <div class="t-desc">目前：${lv ? t.fmt(lv * t.per) : '—'}</div>
      <button class="btn small ${max ? '' : 'primary'}" ${max || Save.freeStars() < cost ? 'disabled' : ''}>${max ? '已滿級' : `升級（⭐ ${cost}）`}</button>`;
    el.querySelector('button').addEventListener('click', () => {
      if (Save.freeStars() < cost || max) return;
      Save.data.talents[t.id] = lv + 1;
      Save.save();
      renderTalents();
    });
    list.appendChild(el);
  }
}
$('btn-reset-talent').addEventListener('click', () => { Save.data.talents = {}; Save.save(); renderTalents(); });

// ---------- 說明 ----------
function showHelp() {
  const towers = TOWER_ORDER.map(k => `<div>${TOWERS[k].icon} ${TOWERS[k].name}<small>（第${TOWERS[k].unlock}關）</small></div>`).join('');
  const enemies = Object.values(ENEMIES).map(e => `<div>${e.icon} ${e.name}</div>`).join('');
  openModal(`
    <h2>📖 遊戲說明</h2>
    <h3>🎯 目標</h3>
    <p>動物們沿著小路要衝進你的農場 🏡！在路邊放置炮塔把牠們打暈趕跑，每打暈一隻就能拿到金幣，用金幣蓋更多、更強的塔。</p>
    <h3>🕹️ 操作</h3>
    <ul>
      <li>點右側商店的塔 → 點地圖空地放置（按住 <span class="kbd">Shift</span> 可連續放）</li>
      <li>點已放置的塔可以 <b>升級</b>、<b>賣出</b>、切換 <b>攻擊目標</b></li>
      <li>每座塔最高 3 級，升到第 3 級時要從兩條路線 <b>A / B 選一條</b></li>
      <li><span class="kbd">空白鍵</span> 開始下一關、<span class="kbd">Esc</span> 或右鍵取消</li>
    </ul>
    <h3>👑 BOSS</h3>
    <p>每 10 關會有大 BOSS。從第 20 關起，<b>狼王、野牛首領、熊大王</b>會從路徑中間的洞穴突然冒出來（地上會先出現 ⚠️ 警告），所以整條路都要有防守！</p>
    <h3>⭐ 星星與天賦</h3>
    <p>每過一關得 ⭐1，沒有動物衝進農場再 +⭐1。星星可以在主選單的「天賦升級」永久強化。</p>
    <h3>🗼 炮塔（每 3 關解鎖一種）</h3>
    <div class="help-grid">${towers}</div>
    <h3>🐾 動物</h3>
    <div class="help-grid">${enemies}</div>
    <div class="btns"><button class="btn primary" id="m-close">知道了！</button></div>`, 'help');
  $('m-close').addEventListener('click', closeModal);
}

// ---------- 遊戲 ----------
const hooks = {
  toast, hud: () => UI.refresh(true),
  bossMusic(on) { if (game) Music.play(on ? 'boss' : 'map' + game.chapter); },
  hurt() { const el = $('hud-hp').parentElement; el.classList.remove('hp-flash'); void el.offsetWidth; el.classList.add('hp-flash'); },
  waveDone(info) {
    Save.recordStars(info.level, info.stars);
    let msg = `✅ 第 ${info.level} 關完成！ ${'⭐'.repeat(info.stars)}  獎勵 💰${info.bonus}`;
    if (info.mine) msg += `  金礦 +${info.mine}`;
    if (info.heal) msg += `  補血 +${info.heal}`;
    toast(msg, 'good');
  },
  victory() {
    Music.stop();
    const ch = game.chapter;
    if (Save.data.unlocked < ch + 2) { Save.data.unlocked = Math.min(MAPS.length, ch + 2); Save.save(); }
    const final = ch === MAPS.length - 1;
    const card = openModal(`
      <div class="big-emoji">${final ? '🏆' : '🎉'}</div>
      <h2>${final ? '恭喜全破 50 關！' : `${MAPS[ch].name} 通關！`}</h2>
      <p>${final ? '所有動物都乖乖回家了，你是最強的農場守護者！' : `解鎖新地圖：${MAPS[ch + 1].icon} ${MAPS[ch + 1].name}`}</p>
      <p>本章星星：⭐ ${Save.chapterStars(ch)} / 20　可用星星：⭐ ${Save.freeStars()}</p>
      <div class="btns">
        ${final ? '' : '<button class="btn primary" id="m-next">▶ 前往下一章</button>'}
        <button class="btn" id="m-talent">⭐ 天賦升級</button>
        <button class="btn" id="m-menu">回主選單</button>
      </div>`);
    if (!final) card.querySelector('#m-next').addEventListener('click', () => { closeModal(); startGame(ch + 1); });
    card.querySelector('#m-talent').addEventListener('click', () => { closeModal(); endGame(); show('talents'); });
    card.querySelector('#m-menu').addEventListener('click', () => { closeModal(); endGame(); show('menu'); });
  },
  defeat() {
    Music.stop();
    const card = openModal(`
      <div class="big-emoji">😵</div>
      <h2>農場被攻陷了…</h2>
      <p>你撐到了第 ${game.level} 關。用賺到的星星強化天賦再挑戰吧！</p>
      <p>可用星星：⭐ ${Save.freeStars()}</p>
      <div class="btns">
        <button class="btn primary" id="m-retry">🔄 重新挑戰本章</button>
        <button class="btn" id="m-talent">⭐ 天賦升級</button>
        <button class="btn" id="m-menu">回主選單</button>
      </div>`);
    card.querySelector('#m-retry').addEventListener('click', () => { closeModal(); startGame(game.chapter); });
    card.querySelector('#m-talent').addEventListener('click', () => { closeModal(); endGame(); show('talents'); });
    card.querySelector('#m-menu').addEventListener('click', () => { closeModal(); endGame(); show('menu'); });
  },
};

function startGame(ch) {
  endGame();
  show('game');
  game = new Game($('board'), ch, { hooks, talents: Save.talentValues() });
  game.autoNext = $('chk-auto').checked;
  setSpeed(1);
  Music.play('map' + ch);
  SoundFX.setDuck(false);
  $('hud-map').textContent = `${MAPS[ch].icon} ${MAPS[ch].name}`;
  $('toasts').innerHTML = '';
  UI.build();
  fitBoard();
  toast(`${MAPS[ch].icon} 第 ${ch + 1} 章「${MAPS[ch].name}」— 先放幾座塔，再按「開始」！`);
}
function endGame() {
  if (game) { game.destroy(); game = null; }
}

function setSpeed(s) {
  if (game) game.speed = s;
  document.querySelectorAll('#speed-btns button').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
}
document.querySelectorAll('#speed-btns button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('chk-auto').addEventListener('change', e => { if (game) { game.autoNext = e.target.checked; if (!game.waveActive && game.autoNext) game.autoT = game.t + 1; } });
$('btn-wave').addEventListener('click', () => { if (game) game.startWave(); });
$('btn-pause').addEventListener('click', pauseGame);

function pauseGame() {
  if (!game || game.over) return;
  game.paused = true;
  SoundFX.setDuck(true);
  const card = openModal(`
    <div class="big-emoji">⏸️</div><h2>暫停中</h2>
    ${audioSliders()}
    <div class="btns">
      <button class="btn primary" id="m-resume">▶ 繼續遊戲</button>
      <button class="btn" id="m-help">📖 遊戲說明</button>
      <button class="btn" id="m-retry">🔄 重新開始本章</button>
      <button class="btn red" id="m-menu">離開到主選單</button>
    </div>`);
  bindSliders(card);
  const resume = () => { closeModal(); SoundFX.setDuck(false); if (game) game.paused = false; };
  card.querySelector('#m-resume').addEventListener('click', resume);
  card.querySelector('#m-help').addEventListener('click', () => {
    showHelp();
    $('m-close').addEventListener('click', () => { SoundFX.setDuck(false); if (game) game.paused = false; });
  });
  card.querySelector('#m-retry').addEventListener('click', () => { closeModal(); startGame(game.chapter); });
  card.querySelector('#m-menu').addEventListener('click', () => { closeModal(); SoundFX.setDuck(false); endGame(); show('menu'); });
}
window.addEventListener('keydown', e => {
  if (e.key === 'p' || e.key === 'P') {
    if (!$('modal').classList.contains('hidden')) return;
    pauseGame();
  }
});

// 讓畫布在可用空間內保持 5:3 比例
function fitBoard() {
  const wrap = $('board-wrap'), cv = $('board');
  if (!wrap || !$('game').classList.contains('active')) return;
  const narrow = window.innerWidth <= 900;
  const aw = wrap.clientWidth - 16;
  const ah = narrow ? Infinity : wrap.clientHeight - 16;
  const scale = Math.min(aw / WIDTH, ah / HEIGHT);
  cv.style.width = Math.floor(WIDTH * scale) + 'px';
  cv.style.height = Math.floor(HEIGHT * scale) + 'px';
}
window.addEventListener('resize', fitBoard);

// ---------- 提示訊息 ----------
function toast(msg, type = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, type === 'boss' ? 4500 : 3200);
}

// 重新觸發一次 CSS 動畫
function bump(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---------- 遊戲內介面 ----------
function fmt(n) { return Math.round(n * 10) / 10; }
function pct(n) { return Math.round(n * 100) + '%'; }

function statLines(s, tw) {
  const dm = tw ? tw.dmgMult : 1, rm = tw ? tw.rangeMult : 1, sm = tw ? tw.rateMult : 1;
  const L = [];
  const k = s.kind;
  if (s.dmg) L.push([k === 'beam' || k === 'blackhole' || k === 'aura' ? '每秒傷害' : k === 'spread' ? '每發傷害' : '傷害', fmt(s.dmg * dm) + (k === 'spread' ? ` × ${s.pellets}` : '')]);
  if (s.rate) L.push(['攻速', `${fmt(s.rate * sm)} 次/秒`]);
  if (s.range && k !== 'trap') L.push([k === 'support' ? '加成範圍' : '射程', `${fmt(s.range * (k === 'support' ? 1 : rm))} 格`]);
  if (s.minRange) L.push(['最短射程', `${s.minRange} 格`]);
  if (s.splash) L.push(['爆炸範圍', `${fmt(s.splash)} 格`]);
  if (s.rampMax) L.push(['最大增傷', `×${s.rampMax}`]);
  if (s.slow) L.push(['緩速', pct(1 - s.slow)]);
  if (s.freezeChance) L.push(['凍結機率', pct(s.freezeChance) + ' / 0.5秒']);
  if (s.poisonDps) L.push(['中毒', `${fmt(s.poisonDps * dm)}/秒 · ${s.poisonDur}秒`]);
  if (s.burnDps) L.push(['燃燒', `${fmt(s.burnDps * dm)}/秒 · ${s.burnDur}秒`]);
  if (s.vuln) L.push(['受傷增加', '+' + pct(s.vuln)]);
  if (s.chains) L.push(['跳躍次數', s.chains]);
  if (s.stun) L.push(['暈眩', `${s.stun} 秒`]);
  if (s.knock) L.push(['擊退', `${fmt(s.knock)} 格`]);
  if (s.crit) L.push(['暴擊率', pct(s.crit)]);
  if (s.count > 1) L.push(['飛彈數', s.count]);
  if (s.airMult) L.push(['對空', `×${s.airMult}`]);
  if (s.uses) L.push(['使用次數', tw ? `${tw.uses} / ${s.uses}` : s.uses]);
  if (s.gold) L.push(['每關產出', `💰${s.gold}`]);
  if (s.interest) L.push(['利息', pct(s.interest)]);
  if (s.heal) L.push(['每關補血', `❤️${s.heal}`]);
  if (s.shield) L.push(['防護罩', `每關 ${s.shield} 次`]);
  if (s.rangeBuff) L.push(['射程加成', '+' + pct(s.rangeBuff)]);
  if (s.reveal) L.push(['偵測隱形', `${fmt(s.reveal)} 格`]);
  if (s.mark) L.push(['弱點標記', '+' + pct(s.mark)]);
  if (s.rateBuff) L.push(['攻速加成', '+' + pct(s.rateBuff)]);
  if (s.dmgBuff) L.push(['傷害加成', '+' + pct(s.dmgBuff)]);
  if (s.cd) L.push(['冷卻', `${fmt(s.cd)} 秒`]);
  if (s.hold) L.push(['持續', `${s.hold} 秒`]);
  if (AIM_KINDS.has(k) || k === 'aura' || k === 'trap') L.push(['打飛行', s.air ? '✔ 可以' : '✘ 不行']);
  return L.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}

const UI = {
  key: '',
  hoverType: null,
  build() {
    const shop = $('shop');
    shop.innerHTML = '';
    for (const k of TOWER_ORDER) {
      const d = TOWERS[k];
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.type = k;
      el.innerHTML = `<div class="si-icon">${d.icon}</div><div class="si-name">${d.name}</div><div class="si-cost"></div>`;
      el.addEventListener('click', () => { if (game) game.startPlacing(k); });
      el.addEventListener('mouseenter', () => { this.hoverType = k; this.refresh(true); });
      el.addEventListener('mouseleave', () => { this.hoverType = null; this.refresh(true); });
      shop.appendChild(el);
    }
    const sk = $('skills');
    sk.innerHTML = '';
    for (const s of SKILLS) {
      const b = document.createElement('button');
      b.className = 'skill';
      b.dataset.id = s.id;
      b.title = `${s.name}：${s.desc}（冷卻 ${s.cd} 秒）`;
      b.innerHTML = `<span class="sk-icon">${s.icon}</span><span class="sk-cost">💰${s.cost}</span><div class="sk-cd"></div><div class="sk-cdt"></div>`;
      b.addEventListener('click', () => { if (game) game.useSkill(s.id); });
      sk.appendChild(b);
    }
    this.key = '';
    this.prevGold = undefined;
    this.refresh(true);
  },

  refresh(force) {
    const g = game;
    if (!g) return;
    $('hud-level').textContent = g.level;
    $('hud-hp').textContent = `${g.hp}/${g.maxHp}`;
    const gold = Math.floor(g.gold);
    if (this.prevGold !== undefined && gold > this.prevGold) bump($('hud-gold').parentElement, 'gold-bump');
    this.prevGold = gold;
    $('hud-gold').textContent = gold;

    for (const el of $('shop').children) {
      const k = el.dataset.type, d = TOWERS[k], un = g.isUnlocked(k);
      el.classList.toggle('locked', !un);
      el.classList.toggle('poor', un && g.gold < d.cost);
      el.classList.toggle('active', g.placing === k);
      el.querySelector('.si-cost').textContent = un ? `💰${d.cost}` : `🔒 第${d.unlock}關`;
      const isNew = un && d.unlock === g.level && d.unlock > g.startLevel;
      const badge = el.querySelector('.new');
      if (isNew && !badge) el.insertAdjacentHTML('beforeend', '<span class="new">NEW</span>');
      else if (!isNew && badge) badge.remove();
    }

    for (const b of $('skills').children) {
      const s = SKILLS.find(x => x.id === b.dataset.id);
      const left = Math.max(0, (g.skillCd[s.id] || 0) - g.t), total = s.cd * g.skillCdMul;
      b.querySelector('.sk-cd').style.height = left > 0 ? `${left / total * 100}%` : '0';
      b.querySelector('.sk-cdt').textContent = left > 0 ? Math.ceil(left) : '';
      if (b.dataset.cooling === '1' && left <= 0) bump(b, 'ready');
      b.dataset.cooling = left > 0 ? '1' : '0';
      b.disabled = g.over || left > 0 || g.gold < s.cost;
      b.classList.toggle('active', g.targeting === s.id);
    }

    const wb = $('btn-wave');
    if (g.waveActive) { wb.disabled = true; wb.textContent = `⚔️ 第 ${g.level} 關進行中…`; }
    else {
      wb.disabled = g.over;
      const boss = BOSS_AT[g.level] ? ' 👑' : '';
      wb.textContent = g.autoNext && g.autoT ? `⏳ 第 ${g.level} 關即將開始…` : `▶ 開始第 ${g.level} 關${boss}`;
    }

    // 資訊面板只在內容改變時重畫
    const sel = g.selected;
    const showType = g.placing || this.hoverType;
    let key;
    if (sel) {
      key = ['sel', sel.id, sel.lv, sel.branch, sel.mode, sel.uses, g.gold >= g.upgradeCostOf(sel), sel.buffed, fmt(sel.dmgMult), fmt(sel.rateMult)].join('|');
    } else if (showType) key = ['type', showType, g.isUnlocked(showType)].join('|');
    else key = ['idle', g.level, g.waveActive, g.shield].join('|');
    if (!force && key === this.key) return;
    if (key === this.key && force && !sel) return;
    this.key = key;
    this.renderInfo(sel, showType);
  },

  renderInfo(sel, showType) {
    const g = game, info = $('info');
    if (sel) {
      const d = sel.def, s = sel.s, cost = g.upgradeCostOf(sel), can = g.gold >= cost;
      let up = '';
      if (sel.lv === 1) {
        up = `<button class="btn green" data-act="up" ${can ? '' : 'disabled'}>⬆ 升到 Lv2（💰${cost}）</button>`;
      } else if (sel.lv === 2) {
        up = `<div class="desc">升到 Lv3 請選一條路線（💰${cost}）：</div>` + d.branches.map((b, i) =>
          `<button class="btn ${i ? 'primary' : 'green'} branch" data-act="br" data-b="${i}" ${can ? '' : 'disabled'}><span>${i ? 'B' : 'A'}．${b.name}</span><small>${b.desc}</small></button>`).join('');
      } else {
        up = `<div class="desc">🏅 已滿級：${sel.branch ? 'B' : 'A'}．${d.branches[sel.branch].name}</div>`;
      }
      const modes = AIM_KINDS.has(s.kind) ? `<div class="desc">攻擊目標：</div><div class="modes">${TARGET_MODES.map(([m, n]) =>
        `<button data-mode="${m}" class="${sel.mode === m ? 'on' : ''}">${n}</button>`).join('')}</div>` : '';
      info.innerHTML = `
        <h4>${d.icon} ${d.name} <span class="lv">Lv${sel.lv}</span>${sel.buffed ? '<span class="lv" style="background:#d8ffe2">▲ 強化中</span>' : ''}</h4>
        <div class="desc">${d.desc}</div>
        <dl class="stats">${statLines(s, sel)}</dl>
        ${modes}
        ${up}
        <div class="row"><button class="btn red small" data-act="sell">賣出（+💰${g.sellValue(sel)}）</button><button class="btn small" data-act="close">關閉</button></div>`;
      info.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'up') g.upgrade(sel);
        else if (a === 'br') g.upgrade(sel, +b.dataset.b);
        else if (a === 'sell') g.sell(sel);
        else if (a === 'close') { g.selected = null; this.refresh(true); }
      }));
      info.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => g.setMode(sel, b.dataset.mode)));
      return;
    }
    if (showType) {
      const d = TOWERS[showType], un = g.isUnlocked(showType);
      info.innerHTML = `
        <h4>${d.icon} ${d.name} <span class="lv">💰${d.cost}</span></h4>
        <div class="desc">${d.desc}</div>
        ${un ? '' : `<div class="desc" style="color:#c63f3f">🔒 第 ${d.unlock} 關解鎖</div>`}
        <dl class="stats">${statLines(computeStats(d, 1, null))}</dl>
        <div class="desc">Lv3 路線：<br>A．${d.branches[0].name} — ${d.branches[0].desc}<br>B．${d.branches[1].name} — ${d.branches[1].desc}</div>
        ${g.placing === showType ? '<div class="desc">👉 點地圖放置，右鍵 / Esc 取消</div>' : ''}`;
      return;
    }
    const sum = waveSummary(g.level);
    info.innerHTML = `
      <h4>${g.waveActive ? '⚔️ 本關敵人' : '🔍 下一關敵人'}</h4>
      <div class="wave-preview">${sum.map(s => `<span class="${s.boss || s.raid ? 'bossy' : ''}" title="${s.name}">${s.icon}×${s.n}${s.raid ? ' 突襲' : s.boss ? ' BOSS' : ''}</span>`).join('')}</div>
      ${g.shield ? `<div class="desc">🛡️ 防護罩剩 ${g.shield} 次</div>` : ''}
      <div class="tips">
        💡 點商店的塔，再點地圖空地放置。<br>
        💡 點已放的塔可升級 / 賣出。<br>
        💡 <span class="kbd">空白鍵</span> 開始、<span class="kbd">P</span> 暫停、<span class="kbd">Esc</span> 取消。
      </div>`;
  },
};
setInterval(() => { if (game && $('modal').classList.contains('hidden')) UI.refresh(false); }, 120);

// ---------- 啟動 ----------
Save.load();
$('btn-play').addEventListener('click', () => show('chapters'));
$('btn-talent').addEventListener('click', () => show('talents'));
$('btn-help').addEventListener('click', showHelp);
show('menu');
