// 声: the recitation (on unless the viewer turns it off) and the sounds of the place (off until turned on).
// The recitation follows the story's clock (the director asks it to run from a time, or to hold); if it cannot
// play — missing, too slow to arrive — it says why once and the story goes on silent. A browser that won't
// play sound before the viewer has touched the page only holds it back: the story runs silent meanwhile, and
// the first touch or key brings the voice in where the story has got to.
// The place is made here rather than recorded: the creek (running water: filtered noise with a slow swell),
// a breeze that rises with the gusts, and now and then a bird.
export class Sound {
  constructor(src, { onFail } = {}) {
    this.src = src;
    this.onFail = onFail;
    this.voice = null;
    this.narrate = false;
    this.starting = false;
    this.blocked = false;     // refused until the viewer touches the page
    this.unlocked = false;
    this.waited = 0;
    this._last = -1;
    this.ambient = false;
    this.ctx = null;
    this.duck = 0;
  }

  // ---------------------------------------------------------------- the recitation
  _voice() {
    if (this.voice && !this.voice.error) return this.voice;
    const v = new Audio();
    v.preload = 'auto';
    v.addEventListener('error', () => this.fail('音频文件无法加载'));
    v.src = this.src;
    this.voice = v;
    return v;
  }
  setNarrate(on) {
    this.narrate = !!on;
    this.waited = 0;
    if (on) this._voice().load();
    else this.hold();
    return this.narrate;
  }
  // (in a touch, click or key: a play begun there opens the element to later plays, which some browsers need)
  unlock() {
    if (this.blocked) { this.blocked = false; this.unlocked = false; }
    if (!this.narrate || this.unlocked) return;
    const v = this._voice();
    this.unlocked = true;
    if (!v.paused || this.starting) return;
    const p = v.play();
    p?.catch?.(() => { /* (paused at once: only the opening counts) */ });
    v.pause();
  }
  // play from `at` (if not already playing)
  run(at, rate = 1) {
    const v = this.voice;
    if (!v || !v.paused || this.starting) return;
    this.starting = true;
    try { if (v.readyState >= 1 && Math.abs(v.currentTime - at) > 0.2) v.currentTime = at; } catch { /* not seekable yet */ }
    v.playbackRate = rate;
    const p = v.play();
    const done = () => { this.starting = false; };
    if (!p) { done(); return; }
    p.then(done, (e) => {
      done();
      if (e && e.name === 'AbortError') return; // (paused again before it began)
      if (e && e.name === 'NotAllowedError') { if (!this.blocked) { this.blocked = true; this.onBlocked?.(); } return; }
      this.fail('音频无法播放');
    });
  }
  hold() { if (this.voice && !this.voice.paused) this.voice.pause(); }
  seek(at) {
    const v = this.voice;
    if (!v || v.readyState < 1) return;
    try { v.currentTime = at; } catch { /* ignore */ }
  }
  // the recording's time while it is really playing, else null (and after waiting too long, give up)
  clock(dt) {
    const v = this.voice;
    if (!v || v.paused || this.starting || v.seeking || v.readyState < 3) return this._wait(dt);
    const t = v.currentTime;
    const fresh = t !== this._last;
    this._last = t;
    this.waited = 0;
    return { t, fresh };
  }
  _wait(dt) {
    this.waited += dt;
    if (this.waited > 8) this.fail('音频加载太慢');
    return null;
  }
  fail(why) {
    if (!this.narrate) return;
    this.narrate = false;
    this.waited = 0;
    this.hold();
    this.onFail?.(why);
  }

  // ---------------------------------------------------------------- the place
  setAmbient(on) {
    this.ambient = !!on;
    if (on && !this.ctx) this._build();
    if (!this.ctx) return this.ambient;
    if (on) this.ctx.resume();
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(on ? 1 : 0, t, 0.6);
    if (!on) setTimeout(() => { if (!this.ambient) this.ctx.suspend(); }, 2500);
    return this.ambient;
  }
  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.ambient = false; this.onFail?.('此浏览器不支持网页音频', 'ambient'); return; }
    const ctx = (this.ctx = new AC());
    const sr = ctx.sampleRate, n = sr * 6;
    // brown-ish noise (loops unnoticed at this length)
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035; d[i] = last * 3.2; }
    }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * 2; s.start(0, Math.random() * 5); return s; };
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // water: a band of the noise, its level swelling slowly
    const w = noise(), wb = ctx.createBiquadFilter(), wh = ctx.createBiquadFilter();
    wb.type = 'bandpass'; wb.frequency.value = 900; wb.Q.value = 0.55;
    wh.type = 'highshelf'; wh.frequency.value = 2500; wh.gain.value = 6;
    this.water = ctx.createGain(); this.water.gain.value = 0;
    w.connect(wb).connect(wh).connect(this.water).connect(this.master);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.13; lg.gain.value = 180;
    lfo.connect(lg).connect(wb.frequency); lfo.start();
    // wind: the low noise, louder in the gusts
    const a = noise(), al = ctx.createBiquadFilter();
    al.type = 'lowpass'; al.frequency.value = 380; al.Q.value = 0.3;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    a.connect(al).connect(this.wind).connect(this.master);
    this.windF = al.frequency;
    this.birdAt = 3;
  }
  // per frame: how near water is (0..1), how windy (0..1), whether birds could be heard, whether the voice speaks
  update(dt, { water = 0, wind = 0, birds = true } = {}) {
    if (!this.ctx || !this.ambient) return;
    const t = this.ctx.currentTime;
    this.duck += ((this.narrate && this.voice && !this.voice.paused ? 1 : 0) - this.duck) * Math.min(1, dt * 2);
    const k = 1 - 0.45 * this.duck;
    this.water.gain.setTargetAtTime(0.05 + 0.3 * water * k, t, 0.4);
    this.wind.gain.setTargetAtTime((0.05 + 0.22 * wind) * k, t, 0.5);
    this.windF.setTargetAtTime(300 + 500 * wind, t, 0.5);
    if (birds) {
      this.birdAt -= dt;
      if (this.birdAt < 0) { this.birdAt = 5 + Math.random() * 11; this._bird(0.035 * k); }
    }
  }
  // a short phrase of chirps, somewhere off to one side
  _bird(vol) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = vol;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); } else out.connect(this.master);
    const base = 2600 + Math.random() * 1400, notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const s = t0 + i * (0.11 + Math.random() * 0.06), d = 0.06 + Math.random() * 0.05;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      const f = base * (0.9 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.3), s + d * 0.6);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, s + d);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, s + d);
      o.connect(g).connect(out);
      o.start(s); o.stop(s + d + 0.02);
    }
  }
}
