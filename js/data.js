'use strict';
// ============================================================
//  遊戲資料：炮塔、動物、BOSS、地圖、技能、天賦、關卡產生
// ============================================================

const TILE = 48, COLS = 20, ROWS = 12;
const WIDTH = COLS * TILE, HEIGHT = ROWS * TILE;
const TOTAL_LEVELS = 50;

// ---------- 炮塔 ----------
// kind 決定行為；數值為 Lv1，升級倍率見 computeStats()
const TOWERS = {
  mg: {
    name: '機槍塔', icon: '🔫', color: '#5b8def', unlock: 1, cost: 50, kind: 'bullet',
    range: 2.8, rate: 5, dmg: 5, air: true, projColor: '#ffd84a',
    desc: '射速快、傷害低的主力塔，可攻擊飛行動物。',
    branches: [
      { name: '雙管機槍', desc: '射速 ×2', mul: { rate: 2 } },
      { name: '穿甲彈', desc: '無視護甲，傷害 ×1.7', mul: { dmg: 1.7 }, set: { pierce: true } },
    ],
  },
  shotgun: {
    name: '散彈塔', icon: '💥', color: '#e8894a', unlock: 1, cost: 70, kind: 'spread',
    range: 2.3, rate: 1.0, dmg: 7, pellets: 6, spread: 0.9, air: false,
    desc: '近距離扇形噴出多發子彈，適合清一整群。無法打飛行。',
    branches: [
      { name: '霰彈風暴', desc: '彈丸 6 → 11 發', set: { pellets: 11 } },
      { name: '震撼彈', desc: '傷害 ×1.3，擊退敵人', mul: { dmg: 1.3 }, set: { knock: 0.35 } },
    ],
  },
  freeze: {
    name: '冰凍塔', icon: '❄️', color: '#7fd3f7', unlock: 3, cost: 80, kind: 'aura',
    range: 2.3, dmg: 1, slow: 0.55, freezeChance: 0.08, freezeDur: 1.0, air: true,
    desc: '範圍內動物緩速，並有機率被凍住。BOSS 只會減速。',
    branches: [
      { name: '絕對零度', desc: '凍結機率大幅提升', set: { freezeChance: 0.22, freezeDur: 1.4 } },
      { name: '冰霜爆裂', desc: '傷害 ×6、範圍 ×1.2', mul: { dmg: 6, range: 1.2 } },
    ],
  },
  laser: {
    name: '雷射塔', icon: '🔴', color: '#ff5d73', unlock: 6, cost: 120, kind: 'beam',
    range: 3.0, dmg: 9, rampMax: 4, rampTime: 3, air: true,
    desc: '持續光束，鎖定同一目標越久傷害越高（最高 ×4）。',
    branches: [
      { name: '高能聚焦', desc: '最高增傷 ×4 → ×8', set: { rampMax: 8 } },
      { name: '散射光束', desc: '光束擊中點周圍也受傷', set: { splash: 0.9 } },
    ],
  },
  spike: {
    name: '地刺陷阱', icon: '🪤', color: '#a88b6a', unlock: 9, cost: 40, kind: 'trap',
    onPath: true, range: 0.5, dmg: 30, uses: 25, air: false,
    desc: '唯一能放在路徑上的陷阱，踩到就受傷。有使用次數，升級會補滿。',
    branches: [
      { name: '鋼鐵尖刺', desc: '次數大增、傷害 ×1.3', mul: { dmg: 1.3 }, set: { uses: 70 } },
      { name: '毒刺', desc: '踩到的動物會中毒', set: { poisonDps: 25, poisonDur: 3 } },
    ],
  },
  mortar: {
    name: '迫擊炮', icon: '💣', color: '#8d7b5a', unlock: 12, cost: 130, kind: 'mortar',
    range: 6, minRange: 1.6, rate: 0.45, dmg: 35, splash: 1.2, air: false,
    desc: '射程極遠的範圍爆炸，但太近的打不到，也打不到飛行。',
    branches: [
      { name: '集束彈', desc: '爆炸範圍 ×1.5、傷害 ×1.3', mul: { splash: 1.5, dmg: 1.3 } },
      { name: '燃燒彈', desc: '爆炸後持續燃燒', set: { burnDps: 30, burnDur: 3 } },
    ],
  },
  sniper: {
    name: '狙擊塔', icon: '🎯', color: '#4e6b4a', unlock: 15, cost: 150, kind: 'sniper',
    range: 8, rate: 0.4, dmg: 90, crit: 0.2, air: true, defaultMode: 'strong',
    desc: '超遠射程、高單發傷害，預設優先打血最多的。20% 機率暴擊 ×3。',
    branches: [
      { name: '爆頭專家', desc: '暴擊機率 55%', set: { crit: 0.55 } },
      { name: '速射步槍', desc: '射速 ×2.2', mul: { rate: 2.2 } },
    ],
  },
  goldmine: {
    name: '金礦塔', icon: '💰', color: '#f2c94c', unlock: 18, cost: 150, kind: 'mine',
    gold: 35,
    desc: '每過一關產出金幣，越早蓋越划算。',
    branches: [
      { name: '富礦脈', desc: '產量 ×1.8', mul: { gold: 1.8 } },
      { name: '複利投資', desc: '額外獲得目前金幣 6% 的利息（上限 200）', set: { interest: 0.06 } },
    ],
  },
  flame: {
    name: '火焰塔', icon: '🔥', color: '#ff7a2f', unlock: 21, cost: 140, kind: 'flame',
    range: 2.0, rate: 8, dmg: 2, burnDps: 8, burnDur: 2, cone: 0.8, air: false,
    desc: '朝前方噴火，範圍內動物都會燃燒。無法打飛行。',
    branches: [
      { name: '藍色烈焰', desc: '燃燒傷害 ×2.5', mul: { burnDps: 2.5, dmg: 1.5 } },
      { name: '長程噴射', desc: '射程 ×1.45、火焰更寬', mul: { range: 1.45, cone: 1.5 } },
    ],
  },
  radar: {
    name: '雷達塔', icon: '📡', color: '#5ec7a5', unlock: 24, cost: 140, kind: 'support',
    range: 2.5, rangeBuff: 0.2, reveal: 3.5,
    desc: '周圍的塔射程 +20%，並讓隱形的變色龍現形。',
    branches: [
      { name: '廣域雷達', desc: '加成與偵測範圍 ×1.5', mul: { range: 1.5, reveal: 1.5 } },
      { name: '弱點標記', desc: '偵測範圍內的動物受到傷害 +20%', set: { mark: 0.2 } },
    ],
  },
  tesla: {
    name: '電擊塔', icon: '⚡', color: '#b28dff', unlock: 27, cost: 170, kind: 'chain',
    range: 3, rate: 0.8, dmg: 28, chains: 4, jump: 2, air: true,
    desc: '閃電在多個動物之間跳躍（4 次）。',
    branches: [
      { name: '超導線圈', desc: '跳躍 4 → 9 次', set: { chains: 9 } },
      { name: '麻痺電流', desc: '被電到的動物暈眩 0.5 秒', set: { stun: 0.5 } },
    ],
  },
  missile: {
    name: '飛彈塔', icon: '🚀', color: '#9aa3b2', unlock: 30, cost: 200, kind: 'missile',
    range: 5, rate: 0.6, dmg: 45, splash: 0.9, airMult: 2, count: 1, air: true,
    desc: '追蹤飛彈，範圍爆炸，對飛行動物傷害 ×2。',
    branches: [
      { name: '多重飛彈', desc: '一次發射 3 枚', set: { count: 3 } },
      { name: '重型彈頭', desc: '傷害 ×2、爆炸範圍 ×1.5', mul: { dmg: 2, splash: 1.5 } },
    ],
  },
  heal: {
    name: '補血站', icon: '💚', color: '#6fdc8c', unlock: 33, cost: 220, kind: 'heal',
    heal: 1,
    desc: '每過一關替農場回血（不會超過上限）。',
    branches: [
      { name: '急救中心', desc: '每關回 3 血', set: { heal: 3 } },
      { name: '防護罩', desc: '每關擋下 2 隻衝進農場的動物（BOSS 除外）', set: { shield: 2 } },
    ],
  },
  poison: {
    name: '毒霧塔', icon: '☠️', color: '#8fd14f', unlock: 36, cost: 160, kind: 'aura',
    range: 2.5, poisonDps: 10, poisonDur: 3, vuln: 0.15, air: true,
    desc: '範圍內動物中毒持續扣血，並且受到的傷害增加。',
    branches: [
      { name: '劇毒', desc: '中毒傷害 ×3', mul: { poisonDps: 3 } },
      { name: '腐蝕', desc: '受到傷害 +50%', set: { vuln: 0.5 } },
    ],
  },
  wind: {
    name: '旋風塔', icon: '🌪️', color: '#9fd5f5', unlock: 39, cost: 180, kind: 'wind',
    range: 2.5, rate: 0.35, dmg: 12, knock: 1.4, air: true,
    desc: '把動物往回吹一段路。BOSS 很重，吹不太動。',
    branches: [
      { name: '颶風', desc: '擊退距離 ×1.8', mul: { knock: 1.8 } },
      { name: '龍捲風', desc: '同時吹走範圍內所有動物', set: { all: true } },
    ],
  },
  buff: {
    name: '強化塔', icon: '⚙️', color: '#ff9fd0', unlock: 42, cost: 220, kind: 'support',
    range: 2.0, rateBuff: 0.25,
    desc: '周圍的塔攻擊速度 +25%。',
    branches: [
      { name: '超頻', desc: '攻速加成 +50%', set: { rateBuff: 0.5 } },
      { name: '全面強化', desc: '周圍的塔傷害再 +30%', set: { dmgBuff: 0.3 } },
    ],
  },
  magnet: {
    name: '磁力塔', icon: '🧲', color: '#e05d5d', unlock: 45, cost: 190, kind: 'aura',
    range: 2.6, slow: 0.7, vuln: 0.3, air: true,
    desc: '磁場拉住動物使其減速，並讓牠受到的傷害 +30%。',
    branches: [
      { name: '強力磁場', desc: '減速效果大幅提升', set: { slow: 0.45 } },
      { name: '電磁共振', desc: '受到傷害 +70%', set: { vuln: 0.7 } },
    ],
  },
  blackhole: {
    name: '黑洞塔', icon: '🌀', color: '#5a3d8a', unlock: 48, cost: 400, kind: 'blackhole',
    range: 3.5, cd: 12, hold: 3, radius: 1.6, dmg: 60, air: true,
    desc: '終極武器！製造黑洞把一群動物吸住並持續絞殺。冷卻較長。',
    branches: [
      { name: '時空裂縫', desc: '冷卻 12 → 7 秒', set: { cd: 7 } },
      { name: '奇點', desc: '黑洞傷害 ×3', mul: { dmg: 3 } },
    ],
  },
};
const TOWER_ORDER = ['mg', 'shotgun', 'freeze', 'laser', 'spike', 'mortar', 'sniper', 'goldmine', 'flame',
  'radar', 'tesla', 'missile', 'heal', 'poison', 'wind', 'buff', 'magnet', 'blackhole'];
// 需要「瞄準」的塔（有砲管、可切換目標模式）
const AIM_KINDS = new Set(['bullet', 'spread', 'beam', 'mortar', 'sniper', 'flame', 'chain', 'missile', 'wind', 'blackhole']);
const TARGET_MODES = [['first', '最前'], ['last', '最後'], ['strong', '最強'], ['close', '最近']];

// 炮塔最高 4 級：Lv2 一般強化、Lv3 選 A/B 路線、Lv4 終極強化
const MAX_LV = 4;
const LV_DMG = [1, 1.6, 2.4, 3.6], LV_RANGE = [1, 1.1, 1.2, 1.3], LV_RATE = [1, 1.1, 1.25, 1.4];
// Lv4 額外加成（套在路線效果之後，所以路線設定的數值也會再變強）
const LV4_ADD = { heal: 1, shield: 1, chains: 2, pellets: 2, count: 1, crit: 0.1, stun: 0.2, mark: 0.1, interest: 0.02, freezeChance: 0.05, rampMax: 1, vuln: 0.1 };
const LV4_MUL = { uses: 1.35, knock: 1.2, splash: 1.15, freezeDur: 1.2, poisonDur: 1.2, burnDur: 1.2, hold: 1.3 };
function computeStats(def, lv, branch) {
  const i = lv - 1, s = {};
  for (const k in def) if (k !== 'branches' && k !== 'desc' && k !== 'name') s[k] = def[k];
  if (def.dmg) s.dmg = def.dmg * LV_DMG[i];
  if (def.poisonDps) s.poisonDps = def.poisonDps * LV_DMG[i];
  if (def.burnDps) s.burnDps = def.burnDps * LV_DMG[i];
  if (def.range) s.range = def.range * LV_RANGE[i];
  if (def.reveal) s.reveal = def.reveal * LV_RANGE[i];
  if (def.rate) s.rate = def.rate * LV_RATE[i];
  if (def.slow) s.slow = def.slow - 0.05 * i;
  if (def.freezeChance) s.freezeChance = def.freezeChance + 0.02 * i;
  if (def.uses) s.uses = Math.round(def.uses * [1, 1.4, 1.8, 1.8][i]);
  if (def.gold) s.gold = Math.round(def.gold * [1, 1.8, 2.8, 4][i]);
  if (def.heal) s.heal = [1, 2, 2, 2][i];
  if (def.rangeBuff) s.rangeBuff = def.rangeBuff + 0.05 * i;
  if (def.rateBuff) s.rateBuff = def.rateBuff + 0.05 * i;
  if (def.cd) s.cd = def.cd * [1, 0.9, 0.8, 0.7][i];
  if (def.vuln) s.vuln = def.vuln + 0.05 * Math.min(i, 2);
  if (branch != null) {
    const b = def.branches[branch];
    if (b.mul) for (const k in b.mul) s[k] = (s[k] || 0) * b.mul[k];
    if (b.set) Object.assign(s, b.set);
  }
  if (lv >= 4) {
    for (const k in LV4_ADD) if (s[k]) s[k] += LV4_ADD[k];
    for (const k in LV4_MUL) if (s[k]) s[k] *= LV4_MUL[k];
    if (s.uses) s.uses = Math.round(s.uses);
    // 減速數值越小越強
    if (s.slow) s.slow = Math.max(0.3, s.slow - 0.05);
  }
  return s;
}
function upgradeCost(def, lv) { return Math.round(def.cost * [0.8, 1.5, 2.5][lv - 1]); }

// ---------- 動物 ----------
const ENEMIES = {
  rabbit:    { name: '小白兔', icon: '🐰', hp: 22, speed: 1.5, gold: 3, from: 1, desc: '普通的兔子' },
  mouse:     { name: '小老鼠', icon: '🐭', hp: 12, speed: 2.1, gold: 2, from: 2, group: 1.6, desc: '成群結隊、跑很快' },
  boar:      { name: '野豬', icon: '🐗', hp: 75, speed: 0.9, armor: 3, gold: 7, from: 4, desc: '有護甲，減少每發子彈的傷害' },
  eagle:     { name: '老鷹', icon: '🦅', hp: 32, speed: 1.7, gold: 6, air: true, from: 5, desc: '飛行！散彈、迫擊炮、火焰、地刺打不到' },
  bat:       { name: '蝙蝠', icon: '🦇', hp: 18, speed: 2.3, gold: 4, air: true, from: 7, group: 1.4, desc: '成群的飛行動物' },
  cheetah:   { name: '獵豹', icon: '🐆', hp: 36, speed: 3.0, gold: 6, from: 8, desc: '速度超快' },
  frog:      { name: '青蛙', icon: '🐸', hp: 40, speed: 1.3, gold: 5, split: 2, from: 11, desc: '被打暈後分裂成 2 隻小青蛙' },
  kangaroo:  { name: '袋鼠', icon: '🦘', hp: 55, speed: 2.4, gold: 6, from: 13, desc: '又快又耐打' },
  rhino:     { name: '犀牛', icon: '🦏', hp: 220, speed: 0.65, armor: 8, gold: 14, from: 15, leak: 2, desc: '超厚護甲，用穿甲彈或範圍傷害對付' },
  mole:      { name: '地鼠', icon: '🐹', hp: 70, speed: 1.1, gold: 8, burrow: true, from: 18, desc: '會鑽到地下，這時打不到' },
  monkey:    { name: '猴子', icon: '🐒', hp: 60, speed: 1.2, gold: 9, healer: true, from: 22, desc: '會替周圍的同伴補血，優先打掉！' },
  chameleon: { name: '變色龍', icon: '🦎', hp: 48, speed: 1.4, gold: 8, invis: true, from: 26, desc: '隱形！需要雷達塔才能鎖定' },
  polar:     { name: '北極熊', icon: '🐻‍❄️', hp: 170, speed: 0.8, armor: 4, gold: 14, noSlow: true, from: 32, leak: 2, desc: '不怕冷，免疫緩速與冰凍' },
};

// 每 10 關的大 BOSS（固定血量）
const BOSSES = {
  elephant: { name: '巨象王', icon: '🐘', hp: 2600, speed: 0.42, armor: 4, gold: 150, size: 2.0, skill: 'stomp', skillCd: 6, leak: 10, desc: '踩踏地面，讓附近的塔暈眩' },
  lion:     { name: '獅子王', icon: '🦁', hp: 7000, speed: 0.55, armor: 4, gold: 250, size: 2.0, skill: 'roar', skillCd: 8, leak: 10, desc: '怒吼讓全場動物加速' },
  croc:     { name: '鱷魚王', icon: '🐊', hp: 13000, speed: 0.45, armor: 8, gold: 350, size: 2.1, skill: 'dive', skillCd: 7, leak: 10, desc: '潛水時無敵，血量低時會狂暴加速' },
  gorilla:  { name: '金剛', icon: '🦍', hp: 22000, speed: 0.42, armor: 10, gold: 450, size: 2.2, skill: 'rock', skillCd: 10, leak: 10, desc: '丟石頭砸毀附近的一座塔！' },
  dragon:   { name: '遠古巨龍', icon: '🐉', hp: 42000, speed: 0.42, armor: 8, gold: 0, size: 2.4, air: true, skill: 'fire', skillCd: 9, leak: 20, desc: '飛行，噴火解除所有減速，還會召喚蝙蝠' },
};
const BOSS_AT = { 10: 'elephant', 20: 'lion', 30: 'croc', 40: 'gorilla', 50: 'dragon' };

// 第 20 關起從路徑中間突襲的 BOSS（血量隨關卡成長）
const RAIDS = {
  wolf:  { name: '狼王', icon: '🐺', hp: 170, speed: 1.0, armor: 3, gold: 40, size: 1.5, leak: 5 },
  bison: { name: '野牛首領', icon: '🦬', hp: 260, speed: 0.8, armor: 8, gold: 60, size: 1.6, leak: 5 },
  bear:  { name: '熊大王', icon: '🐻', hp: 300, speed: 0.85, armor: 6, gold: 80, size: 1.7, leak: 5, regen: 0.01 },
};
function raidTypeFor(L) { return L < 30 ? 'wolf' : L < 40 ? 'bison' : 'bear'; }
function raidCountFor(L) { return L >= 30 ? 2 : L >= 20 ? 1 : 0; }

// ---------- 地圖（每 10 關換一張） ----------
// path: 格子座標的轉折點；mids: 突襲 BOSS 出現點 [線段索引, 比例]
const MAPS = [
  {
    name: '青青草原', icon: '🌳', desc: '經典 W 型小路',
    theme: { ground: '#a6dc7a', ground2: '#9bd36e', path: '#f1d9a6', edge: '#d6b67e', decor: ['🌳', '🌼', '🌷', '🍄', '🌿', '🌻'] },
    path: [[-1, 1], [3, 1], [3, 10], [7, 10], [7, 3], [12, 3], [12, 10], [16, 10], [16, 1], [20, 1]],
    mids: [[4, 0.5], [2, 0.5]],
  },
  {
    name: '迷霧森林', icon: '🌲', desc: '連續雙 W 山路',
    theme: { ground: '#7fc06f', ground2: '#76b866', path: '#d9b98a', edge: '#b08e60', decor: ['🌲', '🌳', '🍄', '🪵', '🌿'] },
    path: [[-1, 2], [2, 2], [2, 9], [5, 9], [5, 2], [8, 2], [8, 9], [11, 9], [11, 2], [14, 2], [14, 9], [17, 9], [17, 2], [20, 2]],
    mids: [[6, 0.5], [10, 0.5]],
  },
  {
    name: '冰雪王國', icon: '⛄', desc: '橫向蛇行雪道',
    theme: { ground: '#eaf4fb', ground2: '#dcecf7', path: '#b9d3e8', edge: '#93b5d1', decor: ['⛄', '❄️', '🌲', '🧊'] },
    path: [[-1, 1], [17, 1], [17, 4], [2, 4], [2, 7], [17, 7], [17, 10], [20, 10]],
    mids: [[3, 0.5], [5, 0.5]],
  },
  {
    name: '炎熱沙漠', icon: '🌵', desc: '螺旋迷宮，農場在中央',
    theme: { ground: '#f3dca6', ground2: '#ecd296', path: '#d3a96a', edge: '#b48748', decor: ['🌵', '🪨', '🌴', '🏜️'] },
    path: [[-1, 1], [18, 1], [18, 10], [1, 10], [1, 4], [15, 4], [15, 7], [5, 7]],
    mids: [[2, 0.5], [4, 0.5]],
  },
  {
    name: '火山熔岩', icon: '🌋', desc: '大 W 熔岩峽谷',
    theme: { ground: '#6e5a55', ground2: '#665250', path: '#c9824f', edge: '#9a5530', decor: ['🌋', '🪨', '🔥', '💎'] },
    path: [[-1, 10], [2, 10], [2, 1], [6, 1], [6, 10], [10, 10], [10, 1], [14, 1], [14, 10], [18, 10], [18, 1], [20, 1]],
    mids: [[4, 0.5], [6, 0.5]],
  },
];

// ---------- 技能道具 ----------
const SKILLS = [
  { id: 'heal', name: '急救包', icon: '🩹', cost: 120, cd: 45, desc: '農場回復 5 點血' },
  { id: 'strike', name: '空襲', icon: '✈️', cost: 100, cd: 25, desc: '點擊地圖，對範圍內動物造成大量傷害', target: true },
  { id: 'freeze', name: '全場冰封', icon: '🧊', cost: 90, cd: 40, desc: '凍住所有動物 3 秒（BOSS 減速）' },
  { id: 'double', name: '金幣雙倍', icon: '✨', cost: 60, cd: 60, desc: '30 秒內打暈動物得到的金幣 ×2' },
];

// ---------- 永久天賦（用星星購買） ----------
const TALENTS = [
  { id: 'gold', name: '起始資金', icon: '💰', desc: '每張地圖開始時金幣 +60', max: 5, per: 60, fmt: v => `+${v}` },
  { id: 'hp', name: '堅固農場', icon: '🏡', desc: '農場血量 +3', max: 5, per: 3, fmt: v => `+${v}` },
  { id: 'dmg', name: '火力強化', icon: '💥', desc: '所有塔傷害 +6%', max: 5, per: 0.06, fmt: v => `+${Math.round(v * 100)}%` },
  { id: 'range', name: '遠視訓練', icon: '🔭', desc: '所有塔射程 +4%', max: 5, per: 0.04, fmt: v => `+${Math.round(v * 100)}%` },
  { id: 'bounty', name: '賞金獵人', icon: '🪙', desc: '打暈動物的金幣 +8%', max: 5, per: 0.08, fmt: v => `+${Math.round(v * 100)}%` },
  { id: 'refund', name: '二手市場', icon: '♻️', desc: '賣塔退款 +5%（基本 70%）', max: 5, per: 0.05, fmt: v => `+${Math.round(v * 100)}%` },
  { id: 'skill', name: '快速冷卻', icon: '⏱️', desc: '技能冷卻時間 -10%', max: 5, per: 0.1, fmt: v => `-${Math.round(v * 100)}%` },
];
function talentCost(lv) { return lv + 1; }

// ---------- 關卡產生 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hpMult(L) { return (1 + 0.1 * (L - 1)) * Math.pow(1.035, L - 1); }

// 回傳該關所有出怪事件 [{t, type, boss?, raid?, mid?}]，依時間排序
function buildWave(L) {
  const rng = mulberry32(L * 7919 + 13);
  const pool = Object.keys(ENEMIES).filter(k => ENEMIES[k].from <= L);
  const boss = BOSS_AT[L];
  let remaining = Math.round((9 + L * 1.1) * (boss ? 0.6 : 1));
  const gap = Math.max(0.32, 0.95 - L * 0.012);
  const ev = [];
  let t = 1;
  while (remaining > 0) {
    let type;
    // 偏向較新出現的動物，讓每關有新鮮感
    if (rng() < 0.45 && pool.length > 2) type = pool[pool.length - 1 - Math.floor(rng() * 3)];
    else type = pool[Math.floor(rng() * pool.length)];
    const d = ENEMIES[type];
    let n = 3 + Math.floor(rng() * 4);
    if (d.hp >= 150) n = Math.max(1, Math.round(n / 2));
    n = Math.min(n, remaining);
    const cnt = Math.round(n * (d.group || 1));
    for (let i = 0; i < cnt; i++) { ev.push({ t, type }); t += gap / (d.group || 1); }
    remaining -= n;
    t += 1.4;
  }
  const dur = t;
  if (boss) ev.push({ t: dur * 0.45, type: boss, boss: true });
  const rc = raidCountFor(L);
  for (let i = 0; i < rc; i++) {
    ev.push({ t: Math.max(5, dur * (0.3 + 0.35 * i)), type: raidTypeFor(L), raid: true, mid: i });
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

// 下一關預覽用：統計各種動物數量
function waveSummary(L) {
  const counts = new Map();
  for (const e of buildWave(L)) {
    const key = e.type;
    const c = counts.get(key) || { n: 0, boss: e.boss, raid: e.raid };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.entries()].map(([type, c]) => {
    const def = ENEMIES[type] || BOSSES[type] || RAIDS[type];
    return { type, icon: def.icon, name: def.name, n: c.n, boss: c.boss, raid: c.raid };
  });
}
