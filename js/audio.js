'use strict';
// ============================================================
//  音效與背景音樂：全部用 Web Audio 即時合成，不需要音檔
// ============================================================

const SoundFX = (() => {
  let ctx = null, master, sfxBus, musicBus, noiseBuf;
  const settings = { music: 0.5, sfx: 0.7 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('animalTD_audio') || '{}')); } catch (e) { }
  const last = {};

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    applyVolumes();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  let duck = 1;
  function applyVolumes() {
    if (!ctx) return;
    const now = ctx.currentTime;
    sfxBus.gain.setTargetAtTime(settings.sfx * settings.sfx, now, 0.05);
    musicBus.gain.setTargetAtTime(settings.music * settings.music * 0.55 * duck, now, 0.15);
  }

  // 基本音源：振盪器
  function tone(o) {
    const t0 = o.at !== undefined ? o.at : ctx.currentTime + (o.t || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + (o.slide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = o.vib;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
    }
    const a = o.a || 0.005, v = o.vol || 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    if (o.hold) g.gain.setValueAtTime(v, t0 + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }
  // 基本音源：白噪音 + 濾波
  function noise(o) {
    const t0 = o.at !== undefined ? o.at : ctx.currentTime + (o.t || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.ft || 'lowpass';
    filt.frequency.setValueAtTime(o.f || 2000, t0);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
    if (o.q) filt.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + (o.a || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filt); filt.connect(g); g.connect(o.dest || sfxBus);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + o.dur + 0.05);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  const rnd = a => 1 + (Math.random() - 0.5) * a;
  const notes = (list, o) => list.forEach((n, i) => n && tone(Object.assign({ f: N(n), t: i * (o.step || 0.08), dur: o.dur || 0.15 }, o)));

  const SFX = {
    // ---- 炮塔 ----
    mg() { noise({ dur: 0.05, vol: 0.1, ft: 'highpass', f: 2500 }); tone({ f: 900 * rnd(0.2), f2: 260, type: 'square', dur: 0.04, vol: 0.035 }); },
    shotgun() { noise({ dur: 0.16, vol: 0.28, f: 1800, f2: 300 }); tone({ f: 160, f2: 50, dur: 0.12, vol: 0.2 }); },
    laser() { tone({ f: 1400 * rnd(0.1), f2: 700, type: 'sawtooth', dur: 0.12, vol: 0.04, lp: 3000 }); },
    mortar() { tone({ f: 140, f2: 45, dur: 0.22, vol: 0.3 }); noise({ dur: 0.1, vol: 0.12, f: 900 }); },
    sniper() { noise({ dur: 0.08, vol: 0.25, ft: 'highpass', f: 1500 }); tone({ f: 2200, f2: 180, type: 'square', dur: 0.14, vol: 0.06 }); },
    flame() { noise({ dur: 0.18, vol: 0.06, ft: 'bandpass', f: 700 * rnd(0.3), q: 0.8 }); },
    zap() { tone({ f: 1800 * rnd(0.3), f2: 120, type: 'sawtooth', dur: 0.13, vol: 0.07, lp: 4000 }); noise({ dur: 0.09, vol: 0.08, ft: 'highpass', f: 3000 }); },
    missile() { noise({ dur: 0.35, vol: 0.12, ft: 'bandpass', f: 400, f2: 2200, q: 2 }); },
    wind() { noise({ dur: 0.45, vol: 0.14, ft: 'bandpass', f: 300, f2: 1200, q: 3, a: 0.12 }); },
    freeze() { tone({ f: 2000 * rnd(0.2), f2: 3200, type: 'triangle', dur: 0.1, vol: 0.03 }); tone({ f: 2600, type: 'sine', t: 0.04, dur: 0.12, vol: 0.02 }); },
    poison() { tone({ f: 260 * rnd(0.3), f2: 520, type: 'sine', dur: 0.08, vol: 0.025 }); },
    blackhole() { tone({ f: 320, f2: 35, dur: 1.1, vol: 0.25, vib: 18 }); noise({ dur: 1.0, vol: 0.08, f: 400, f2: 80 }); },
    spike() { tone({ f: 340 * rnd(0.2), f2: 200, type: 'square', dur: 0.06, vol: 0.06, lp: 1500 }); },
    boom() { noise({ dur: 0.45, vol: 0.32, f: 1200, f2: 90 }); tone({ f: 95, f2: 32, dur: 0.35, vol: 0.32 }); },
    // ---- 動物 ----
    pop() { const f = 520 * rnd(0.35); tone({ f, f2: f * 1.9, dur: 0.12, vol: 0.13, slide: 0.08 }); tone({ f: f * 1.5, f2: f * 2.6, type: 'triangle', dur: 0.1, vol: 0.05, t: 0.02 }); },
    coin() { tone({ f: N(83), type: 'square', dur: 0.06, vol: 0.04, lp: 5000 }); tone({ f: N(88), type: 'square', t: 0.06, dur: 0.18, vol: 0.04, lp: 5000 }); },
    hurt() { tone({ f: 320, f2: 90, type: 'square', dur: 0.32, vol: 0.14, lp: 1600 }); noise({ dur: 0.25, vol: 0.14, f: 900 }); },
    shield() { notes([79, 86], { type: 'triangle', vol: 0.1, step: 0.06, dur: 0.2 }); },
    warn() { for (let i = 0; i < 4; i++) tone({ f: i % 2 ? 660 : 880, type: 'square', t: i * 0.22, dur: 0.2, vol: 0.06, lp: 2500 }); },
    raid() { noise({ dur: 0.6, vol: 0.3, f: 500, f2: 60 }); tone({ f: 70, f2: 35, dur: 0.6, vol: 0.35 }); tone({ f: 200, f2: 120, type: 'sawtooth', dur: 0.5, vol: 0.08, lp: 900, t: 0.1 }); },
    boss() { tone({ f: 110, f2: 55, type: 'sawtooth', dur: 1.4, vol: 0.18, lp: 700, vib: 6 }); noise({ dur: 1.2, vol: 0.12, f: 600, f2: 120, a: 0.2 }); notes([57, 0, 56, 0, 55], { type: 'square', vol: 0.06, step: 0.18, dur: 0.25, lp: 1500 }); },
    bossDown() { notes([72, 76, 79, 84, 88], { type: 'square', vol: 0.07, step: 0.09, dur: 0.25, lp: 4000 }); },
    stomp() { tone({ f: 70, f2: 28, dur: 0.5, vol: 0.45 }); noise({ dur: 0.4, vol: 0.2, f: 300, f2: 60 }); },
    roar() { tone({ f: 180, f2: 70, type: 'sawtooth', dur: 1.0, vol: 0.16, lp: 900, vib: 10 }); noise({ dur: 0.9, vol: 0.14, ft: 'bandpass', f: 500, q: 1, a: 0.1 }); },
    splash() { noise({ dur: 0.5, vol: 0.18, ft: 'bandpass', f: 1200, f2: 300, q: 1 }); tone({ f: 600, f2: 200, dur: 0.2, vol: 0.06 }); },
    throw() { noise({ dur: 0.4, vol: 0.12, ft: 'bandpass', f: 300, f2: 900, q: 2 }); },
    fireRoar() { noise({ dur: 0.9, vol: 0.22, ft: 'bandpass', f: 500, f2: 1500, q: 0.7, a: 0.1 }); tone({ f: 140, f2: 60, type: 'sawtooth', dur: 0.9, vol: 0.12, lp: 800 }); },
    // ---- 玩家操作 ----
    click() { tone({ f: 900, f2: 1200, dur: 0.04, vol: 0.04 }); },
    place() { tone({ f: 220, f2: 520, dur: 0.12, vol: 0.18 }); noise({ dur: 0.12, vol: 0.08, f: 800, t: 0.06 }); },
    upgrade() { notes([72, 76, 79, 84], { type: 'triangle', vol: 0.12, step: 0.06, dur: 0.18 }); },
    sell() { notes([84, 79, 76], { type: 'square', vol: 0.04, step: 0.06, dur: 0.12, lp: 4000 }); },
    deny() { tone({ f: 200, type: 'square', dur: 0.12, vol: 0.05, lp: 1000 }); tone({ f: 150, type: 'square', t: 0.1, dur: 0.15, vol: 0.05, lp: 1000 }); },
    heal() { notes([72, 76, 79, 83, 86], { type: 'sine', vol: 0.12, step: 0.07, dur: 0.3 }); },
    plane() { noise({ dur: 0.9, vol: 0.12, ft: 'bandpass', f: 200, f2: 900, q: 1.5, a: 0.3 }); tone({ f: 90, f2: 140, type: 'sawtooth', dur: 0.9, vol: 0.05, lp: 500 }); },
    freezeAll() { for (let i = 0; i < 8; i++) tone({ f: N(84 + (i * 5) % 14), type: 'triangle', t: i * 0.05, dur: 0.3, vol: 0.05 }); noise({ dur: 0.6, vol: 0.08, ft: 'highpass', f: 4000 }); },
    coins() { for (let i = 0; i < 6; i++) { tone({ f: N(83 + i % 2 * 5), type: 'square', t: i * 0.07, dur: 0.08, vol: 0.035, lp: 5000 }); } },
    unlock() { notes([84, 88, 91, 96], { type: 'triangle', vol: 0.08, step: 0.05, dur: 0.3 }); },
    waveStart() { notes([67, 72, 76], { type: 'square', vol: 0.06, step: 0.1, dur: 0.18, lp: 3000 }); tone({ f: N(79), type: 'square', t: 0.3, dur: 0.4, vol: 0.06, lp: 3000 }); },
    waveClear() { notes([72, 76, 79, 0, 76, 84], { type: 'triangle', vol: 0.12, step: 0.09, dur: 0.25 }); },
    victory() { notes([72, 72, 72, 76, 79, 0, 76, 79, 84], { type: 'square', vol: 0.07, step: 0.13, dur: 0.3, lp: 3500 }); notes([48, 0, 0, 52, 55, 0, 52, 55, 60], { type: 'triangle', vol: 0.15, step: 0.13, dur: 0.35 }); },
    defeat() { notes([67, 66, 65, 64], { type: 'sawtooth', vol: 0.06, step: 0.32, dur: 0.4, lp: 1200 }); tone({ f: N(52), f2: N(40), type: 'triangle', t: 1.3, dur: 1.2, vol: 0.15 }); },
  };
  // 同一種音效的最短間隔，避免機槍一秒響幾十次
  const GAP = { mg: 0.07, pop: 0.035, flame: 0.14, freeze: 0.4, poison: 0.5, laser: 0.25, spike: 0.08, boom: 0.06, shotgun: 0.08, coin: 0.06, zap: 0.08, missile: 0.1, sniper: 0.06, mortar: 0.1 };

  function play(name) {
    if (!ctx || ctx.state !== 'running' || settings.sfx <= 0) return;
    const now = ctx.currentTime, gap = GAP[name] !== undefined ? GAP[name] : 0.03;
    if (last[name] && now - last[name] < gap) return;
    last[name] = now;
    if (SFX[name]) SFX[name]();
  }
  function save() { try { localStorage.setItem('animalTD_audio', JSON.stringify(settings)); } catch (e) { } }

  return {
    init, play, tone, noise, N, settings,
    get ctx() { return ctx; },
    get musicBus() { return musicBus; },
    unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setVolume(kind, v) { settings[kind] = v; applyVolumes(); save(); },
    setDuck(on) { duck = on ? 0.35 : 1; applyVolumes(); },
  };
})();

// ============================================================
//  背景音樂：依地圖產生旋律的小型編曲器
// ============================================================
const Music = (() => {
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygdom: [0, 1, 4, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
  };
  // kick / snare / hat / bass：16 格節奏，x 代表打一下
  const TRACKS = {
    menu: { bpm: 100, root: 60, scale: 'major', prog: [0, 4, 5, 3], seed: 1, lead: 'triangle', leadVol: 0.09,
      kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'x.....x.x.....x.', arp: 'square' },
    map0: { bpm: 116, root: 65, scale: 'major', prog: [0, 5, 3, 4], seed: 11, lead: 'square', leadVol: 0.05, lp: 2800,
      kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x..x..x.x..x..x.', arp: 'triangle' },
    map1: { bpm: 104, root: 62, scale: 'dorian', prog: [0, 3, 0, 4], seed: 23, lead: 'triangle', leadVol: 0.1,
      kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...xx', bass: 'x.....x...x.....', arp: 'square', pad: true },
    map2: { bpm: 92, root: 69, scale: 'minor', prog: [0, 5, 2, 6], seed: 37, lead: 'triangle', leadVol: 0.09, bells: true,
      kick: 'x.......x.......', snare: '............x...', hat: '....x.......x...', bass: 'x.......x.......', pad: true },
    map3: { bpm: 108, root: 64, scale: 'phrygdom', prog: [0, 1, 0, 6], seed: 41, lead: 'sawtooth', leadVol: 0.04, lp: 1800,
      kick: 'x..x....x..x....', snare: '....x.......x..x', hat: '..x...x...x...x.', bass: 'x..x....x..x....', arp: 'triangle' },
    map4: { bpm: 128, root: 60, scale: 'minor', prog: [0, 5, 6, 4], seed: 53, lead: 'square', leadVol: 0.045, lp: 2400,
      kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxx.xxx.xxx.xxx.', bass: 'x.xx.xx.x.xx.xx.', arp: 'sawtooth' },
    boss: { bpm: 144, root: 57, scale: 'minor', prog: [0, 0, 5, 4], seed: 67, lead: 'sawtooth', leadVol: 0.045, lp: 2200,
      kick: 'x...x...x...x.x.', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', bass: 'xxx.xxx.xxx.xx.x', arp: 'square' },
  };

  function degMidi(tr, deg, oct) {
    const sc = SCALES[tr.scale];
    const o = Math.floor(deg / 7), i = ((deg % 7) + 7) % 7;
    return tr.root + sc[i] + 12 * (o + oct);
  }
  function genMelody(tr) {
    const rng = mulberry32(tr.seed * 99 + 1);
    const rhythms = ['x.x.x.x.x...x.x.', 'x...x.x.x.x.x...', 'x.xxx...x.x.x...', 'x..x..x.x...x...', 'x.x.x...xxx.x...', 'x...x...x.x.x.x.'];
    const bars = [];
    let deg = 7;
    for (let b = 0; b < 4; b++) {
      const r = rhythms[Math.floor(rng() * rhythms.length)];
      const chord = tr.prog[b % tr.prog.length];
      const bar = new Array(16).fill(null);
      for (let s = 0; s < 16; s++) {
        if (r[s] !== 'x') continue;
        if (s % 4 === 0) {
          // 強拍落在和弦音上，聽起來比較穩
          let best = deg, bd = 99;
          for (const c of [chord, chord + 2, chord + 4]) for (const oc of [0, 7, 14]) {
            const d = c + oc;
            if (Math.abs(d - deg) < bd && d >= 4 && d <= 13) { bd = Math.abs(d - deg); best = d; }
          }
          deg = best;
        } else {
          deg += [-2, -1, -1, 1, 1, 2][Math.floor(rng() * 6)];
          deg = Math.max(4, Math.min(13, deg));
        }
        let len = 1;
        while (s + len < 16 && r[s + len] !== 'x' && len < 4) len++;
        bar[s] = { deg, len };
      }
      bars.push(bar);
    }
    const cadence = bars[3].slice();
    for (let s = 8; s < 16; s++) cadence[s] = null;
    cadence[8] = { deg: 7, len: 8 };
    return [bars[0], bars[1], bars[2], bars[3], bars[0], bars[1], bars[2], cadence];
  }

  let cur = null, curName = null, step = 0, next = 0;
  const out = () => SoundFX.musicBus;
  function voice(midi, at, dur, type, vol, lp, vib) {
    SoundFX.tone({ f: SoundFX.N(midi), at, dur, type, vol, lp, vib, a: 0.01, hold: dur * 0.6, dest: out() });
  }
  function drums(tr, s, at) {
    if (tr.kick[s] === 'x') SoundFX.tone({ f: 150, f2: 40, at, dur: 0.16, vol: 0.5, slide: 0.12, dest: out() });
    if (tr.snare[s] === 'x') {
      SoundFX.noise({ at, dur: 0.13, vol: 0.16, ft: 'highpass', f: 1200, dest: out() });
      SoundFX.tone({ f: 220, f2: 140, at, dur: 0.08, vol: 0.1, type: 'triangle', dest: out() });
    }
    if (tr.hat[s] === 'x') SoundFX.noise({ at, dur: 0.035, vol: 0.05, ft: 'highpass', f: 7000, dest: out() });
  }
  function playStep(st, at) {
    const tr = cur, s = st % 16, bar = Math.floor(st / 16) % 8;
    const sd = 60 / tr.bpm / 4;
    const chord = tr.prog[bar % tr.prog.length];
    drums(tr, s, at);
    if (tr.bass[s] === 'x') voice(degMidi(tr, chord, -2), at, sd * 1.8, 'triangle', 0.24);
    if (tr.arp && s % 2 === 0) {
      const tones = [0, 2, 4, 7];
      voice(degMidi(tr, chord + tones[(s / 2) % 4], 0), at, sd * 1.4, tr.arp, 0.025, 2000);
    }
    if (tr.pad && s === 0) {
      for (const k of [0, 2, 4]) voice(degMidi(tr, chord + k, -1), at, sd * 15, 'sine', 0.035);
    }
    const m = tr.melody[bar][s];
    if (m) {
      voice(degMidi(tr, m.deg, 0), at, m.len * sd * 0.92, tr.lead, tr.leadVol, tr.lp || 3200, m.len > 2 ? 4 : 0);
      if (tr.bells) voice(degMidi(tr, m.deg, 1), at, 0.4, 'sine', 0.03);
    }
  }
  function tick() {
    const ctx = SoundFX.ctx;
    if (!ctx || !cur || ctx.state !== 'running' || SoundFX.settings.music <= 0) return;
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
    while (next < ctx.currentTime + 0.15) {
      playStep(step, next);
      next += 60 / cur.bpm / 4;
      step++;
    }
  }
  setInterval(tick, 25);

  return {
    play(name) {
      if (curName === name) return;
      curName = name;
      cur = TRACKS[name];
      if (!cur.melody) cur.melody = genMelody(cur);
      step = 0;
      next = SoundFX.ctx ? SoundFX.ctx.currentTime + 0.1 : 0;
    },
    stop() { cur = null; curName = null; },
    get current() { return curName; },
  };
})();

// 瀏覽器規定要使用者先互動才能出聲音
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => SoundFX.unlock(), { capture: true }));
document.addEventListener('visibilitychange', () => {
  const ctx = SoundFX.ctx;
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});
