// The director: the story's state. It plays the chapters on the recitation's clock (camera, captions, time of
// day, gusts, where the boat is) and dips to paper between shots that don't join. The story can be paused,
// stepped, scrubbed and restarted; read slowly it holds at the end of each chapter until asked to go on; and
// the viewer may look a little way around any shot (it drifts back when let go, while playing). Whatever the
// jump, the story's state is rebuilt from (chapter, u) alone. While no story plays the viewer roams (roam.js).
import * as THREE from 'three';
import { G } from '../core/shared.js';
import { surfaceHeight } from '../world/terrain.js';
import { passageNear, TUNNEL_LEN } from '../world/tunnel.js';
import { inMouthBox } from '../world/layout.js';
import { timeAt, mixTime } from '../world/daylight.js';
import { CHAPTERS } from './chapters.js';
import { AUDIO, NARRATION } from './narration.js';
import { Roam, HOME } from './roam.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => (v && v.isVector3 ? [v.x, v.y, v.z] : v);
const lastTime = (t) => (Array.isArray(t) ? t[t.length - 1] : t);
const DIP_IN = 0.55, DIP_OUT = 0.7, BLEND = 2.4, TIME_BLEND = 2.6, CUT_HOLD = 1.3;
// looking around a shot: how far (radians), how near / far the lens, and how long before it drifts back
const LOOK_YAW = 0.62, LOOK_PITCH = 0.34, ZOOM_IN = 0.55, ZOOM_OUT = 1.2, LOOK_BACK = 3.5;
const MOORED = { z: 55, moored: true, visible: true };

export class Director {
  constructor({ camera, daylight, canvas, renderer, sound, captions }) {
    this.camera = camera;
    this.renderer = renderer;
    this.sound = sound;
    this.captions = captions;
    this.exposure = 1;
    this.daylight = daylight;
    this.chapters = CHAPTERS;
    // each shot's window comes from the recitation: it begins in the pause before its words and lasts until
    // the next one begins; a window shorter than the shot was made for plays the first part of the move at its pace
    CHAPTERS.forEach((c, i) => {
      const n = NARRATION[i];
      c.dur0 ??= c.dur;
      c.t0 = n.t0; c.cue = n.cue; c.chars = n.chars;
      c.dur = (NARRATION[i + 1]?.t0 ?? AUDIO.duration) - n.t0;
      c.span ??= Math.min(1, c.dur / c.dur0);
    });
    this.duration = AUDIO.duration;
    this.at = 0;             // the story's clock (seconds of the recitation)
    // a chapter without its own time keeps the one the text has reached
    let cur = 'morning';
    for (const c of CHAPTERS) { c._time = c.time ?? cur; cur = lastTime(c._time); }
    this.active = false;
    this.paused = false;
    this.pace = 'flow';      // 'flow': on through; 'slow': hold at each chapter's end
    this.holding = false;
    this.released = -1;      // the chapter whose hold was let go
    this.i = -1;
    this.t = 0;
    this.dip = null;         // { phase: 'in'|'out', t, target, at? }
    this.from = null;
    this.story = { chapter: -1, u: 0, boat: { ...MOORED } };
    this.off = { yaw: 0, pitch: 0, zoom: 1, ty: 0, tp: 0, tz: 1, still: 0, touching: false };
    this.gust = { on: false, speed: 0, end: 0, next: 9 };
    this.mistK = 1;
    this.returnTime = null;
    this.worldRate = 1;      // 0 while the world's motion is paused
    this.reduce = false;     // prefers-reduced-motion: a gentler storm of petals, softer gusts
    this.speed = 1;          // (debugging) play faster
    this.listeners = new Set();
    this.roam = new Roam({ camera, canvas });
  }
  onChange(fn) { this.listeners.add(fn); }
  _changed() { for (const f of this.listeners) f(this); }
  get chapter() { return this.chapters[this.i]; }

  // ---------------------------------------------------------------- transport
  start(i = 0) {
    this.active = true;
    this.paused = false;
    this.holding = false;
    this.released = -1;
    this.returnTime = null;
    this.roam.release();
    this.recenter(true);
    this.i = -1;
    this.go(i);
    this._changed();
  }
  restart() { this.start(0); }
  stop() {
    if (!this.active && !this.dip) return;
    this.captions.hide();
    this.captions.uncard();
    this.captions.dipDark(false);
    this.holding = false;
    this.dip = { phase: 'in', t: 0, target: -1 };
  }
  prev() { this.go(Math.max(0, this.i - (this.t < 2 || this.holding ? 1 : 0))); }
  next() { this.go(this.i + 1); }
  togglePause() {
    if (!this.active) return;
    if (this.holding) { this.resume(); return; }
    this.paused = !this.paused;
    this._changed();
  }
  // go on from a hold at a chapter's end (at the last one: back to the peach wood)
  resume() {
    if (!this.holding) return;
    this.holding = false;
    this.released = this.i;
    this.paused = false;
    if (this.i + 1 >= this.chapters.length) this.stop();
    else this.go(this.i + 1);
    this._changed();
  }
  setPace(p) {
    this.pace = p === 'slow' ? 'slow' : 'flow';
    if (this.pace === 'flow' && this.holding && this.i + 1 < this.chapters.length) this.resume();
    this._changed();
  }
  // a jump by the viewer to chapter i (from its beginning)
  go(i, seek = true) {
    if (i >= this.chapters.length) { this.stop(); return; }
    if (!this.active) { this.start(i); return; }
    i = Math.max(0, i);
    const ch = this.chapters[i];
    if (seek) { this.holding = false; this.released = -1; }
    // shots that join blend; a jump dips to paper (the paper down just as the words' shot begins); cards cover their own jump
    const far = this._pose(ch, 0).p.distanceTo(this.camera.position) > 30;
    const dip = this._needsDip(i) || (seek && i !== this.i + 1 && !ch.cut);
    if (seek) this._seek(ch.t0 - (dip ? DIP_IN + 0.12 : 0));
    if (dip) {
      this.captions.hide();
      this.captions.dipDark(ch.dip === 'dark');
      this.dip = { phase: 'in', t: 0, target: i };
    } else this._enter(i, this.i < 0 || far || (seek && i !== this.i + 1));
    this._changed();
  }
  // a jump to any moment (the progress bar)
  seekTo(at) {
    at = clamp(at, 0, this.duration - 0.05);
    const i = this._chapterAt(at);
    if (!this.active) { this.start(i); }
    this.holding = false;
    this.released = -1;
    if (i === this.i && !this.dip) {
      this._seek(at);
      this._enter(i, true);
      return;
    }
    this.captions.hide();
    this.captions.dipDark(false);
    this.dip = { phase: 'in', t: 0, target: i, at };
    this._changed();
  }
  _seek(at) {
    this.at = clamp(at, 0, this.duration);
    this.sound.seek(this.at);
  }
  _chapterAt(at) {
    let i = 0;
    while (i + 1 < this.chapters.length && at >= this.chapters[i + 1].t0) i++;
    return i;
  }
  _needsDip(i) {
    const ch = this.chapters[i], prev = this.chapters[i - 1];
    if (!ch || ch.cut || (prev && prev.cut)) return false;
    if (ch.dip) return true; // (a stretch of the way passed over)
    return this._pose(ch, 0).p.distanceTo(this.camera.position) > 30;
  }
  // where reading slowly waits in chapter i: after its words, before the next shot's move (or dip) begins
  _holdAt(i) {
    const ch = this.chapters[i], next = this.chapters[i + 1];
    if (!next) return ch.t0 + ch.dur - 0.25;
    const end = next.t0 - (this._needsDip(i + 1) ? DIP_IN + 0.12 : 0) - 0.02;
    const said = ch.cue ? ch.cue[1] + 0.3 : end - 0.6;
    return Math.min(end, Math.max(said, end - 0.6));
  }
  _leave() {
    // back to the peach wood, morning, the boat at the pool
    this.active = false;
    this.paused = false;
    this.holding = false;
    this.i = -1;
    this.captions.uncard();
    this.captions.hide();
    this.roam.placeNow(HOME);
    this.roam.release();
    this.recenter(true);
    this.returnTime = { from: this.daylight.state, t: 0 };
    this.sound.hold();
    this.at = 0;
    this.story.chapter = -1;
    this.story.boat = { ...MOORED };
    this._changed();
  }
  _enter(i, snap) {
    const ch = this.chapters[i];
    this.i = i;
    this.t = Math.max(0, this.at - ch.t0);
    const u = clamp(this.t / ch.dur, 0, 1);
    this.capOn = false;
    this.captions.hide();
    this.from = snap ? null : { p: this.camera.position.clone(), d: this.camera.getWorldDirection(new THREE.Vector3()), fov: this.camera.fov };
    this.timeFrom = snap && !ch.cut ? null : this.daylight.state;
    // (gusts already past, on a jump into the middle, are not blown again)
    this.firedGusts = new Set(snap ? (ch.gusts || []).filter((g) => g < u) : []);
    if (ch.cut) this.captions.card(ch);
    else this.captions.uncard();
    if (!ch.cut) this.recenter(false);
    this._apply(0, snap);
    this._changed();
  }

  // ---------------------------------------------------------------- looking around a shot
  lookBy(dx, dy) {
    if (!this.chapter || this.chapter.cut) return;
    const O = this.off, k = 0.0032 * O.zoom;
    O.ty = clamp(O.ty - dx * k, -LOOK_YAW, LOOK_YAW);
    O.tp = clamp(O.tp - dy * k, -LOOK_PITCH, LOOK_PITCH);
    O.still = 0;
  }
  zoomBy(f) {
    if (!this.chapter || this.chapter.cut) return;
    const O = this.off;
    O.tz = clamp(O.tz * f, ZOOM_IN, ZOOM_OUT);
    O.still = 0;
  }
  touch(on) { this.off.touching = on; this.off.still = 0; }
  recenter(now) {
    const O = this.off;
    O.ty = O.tp = 0; O.tz = 1;
    if (now) { O.yaw = O.pitch = 0; O.zoom = 1; }
  }
  get offCenter() {
    const O = this.off;
    return this.active && (Math.abs(O.ty) > 0.03 || Math.abs(O.tp) > 0.03 || Math.abs(O.tz - 1) > 0.03);
  }
  _look(dt) {
    const O = this.off;
    if (!O.touching) O.still += dt;
    if (!this.paused && !this.holding && O.still > LOOK_BACK) {
      const k = 1 - Math.exp(-dt * 0.7);
      O.ty -= O.ty * k; O.tp -= O.tp * k; O.tz += (1 - O.tz) * k;
    }
    const k = 1 - Math.exp(-dt * 7);
    O.yaw += (O.ty - O.yaw) * k;
    O.pitch += (O.tp - O.pitch) * k;
    O.zoom += (O.tz - O.zoom) * k;
  }

  // ---------------------------------------------------------------- per frame
  _pose(ch, u) {
    const e = ch.ease ?? 0.5;
    const ue = u + (ss(u) - u) * e;
    const r = ch.cam(ue * (ch.span ?? 1));
    const p = V(r.p);
    if (r.above != null) {
      // follow the ground smoothly (a small average so the lens doesn't bob over every tussock)
      let h = 0;
      for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) h += surfaceHeight(p.x + dx, p.z + dz);
      p.y = h / 5 + r.above;
    }
    return { p, l: V(r.l), fov: r.fov ?? ch.fov ?? 50 };
  }
  _clampGround(p) {
    if (inMouthBox(p.x, p.z, -1)) return;
    const q = passageNear(p.x, p.z);
    if (q.d < 4 && q.s > -4 && q.s < TUNNEL_LEN + 4) return;
    p.y = Math.max(p.y, surfaceHeight(p.x, p.z) + 0.6);
  }
  // the boat as the story has it at chapter i, u: its own if it has one, else where the last one left it
  _boatAt(i, u) {
    for (let j = i; j >= 0; j--) {
      const c = this.chapters[j];
      if (c.boat) return { z: 55, moored: false, visible: true, ...c.boat((j === i ? u : 1) * (c.span ?? 1)) };
    }
    return { ...MOORED };
  }
  // snap: a jump; everything that eases takes its value at once
  _apply(dt, snap = false) {
    const ch = this.chapters[this.i];
    const u = clamp(this.t / ch.dur, 0, 1);
    const k = (rate) => (snap ? 1 : Math.min(1, dt * rate));
    const cam = this.camera;
    // a card holds the last view until it is opaque, then cuts behind it
    const hold = ch.cut && this.t < CUT_HOLD;
    if (!hold) {
      const pose = this._pose(ch, u);
      if (!ch.inside) this._clampGround(pose.p);
      let p = pose.p, d = pose.l.clone().sub(pose.p).normalize(), fov = pose.fov;
      if (this.from && !ch.cut) {
        const b = ss(this.t / BLEND);
        p = this.from.p.clone().lerp(p, b);
        d = this.from.d.clone().lerp(d, b).normalize();
        fov = this.from.fov + (fov - this.from.fov) * b;
      }
      // the viewer's own look around the shot (turning in place: the eye itself never moves)
      const O = this.off;
      if (Math.abs(O.yaw) + Math.abs(O.pitch) > 1e-4) {
        const yaw = Math.atan2(d.x, d.z) + O.yaw, pitch = clamp(Math.asin(clamp(d.y, -1, 1)) + O.pitch, -1.3, 1.3);
        d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      }
      fov *= O.zoom;
      cam.position.copy(p);
      cam.lookAt(p.clone().add(d));
      if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
      // time of day
      const target = timeAt(ch._time, u);
      if (this.timeFrom && !ch.cut) this.daylight.apply(mixTime(this.timeFrom, target, ss(this.t / TIME_BLEND)));
      else this.daylight.apply(target);
      // a chapter's own mist (the forest reach: mist lying on the water between the trees)
      this.mistK += ((ch.mist ?? 1) - this.mistK) * k(0.8);
      G.uMist.value *= this.mistK;
    }
    this.story.boat = this._boatAt(this.i, u);
    this.story.chapter = this.i;
    this.story.u = u;
    // the eye adapting: opening up in the dark passage, dazzled for a moment when it opens out
    const ex = typeof ch.exposure === 'function' ? ch.exposure(u * (ch.span ?? 1)) : ch.exposure ?? 1;
    this._expose(ex, snap ? 1e3 : dt, ex < this.exposure ? 0.9 : 1.6);
    // petals: fewer in the passage, none over the basin (they're masked there anyway)
    const pa = ch.petals ?? 1;
    G.uPetalAmt.value += (pa - G.uPetalAmt.value) * k(1.5);
    const st = (ch.storm ?? 0) * pa * (this.reduce ? 0.35 : 1);
    G.uPetalStorm.value += (st - G.uPetalStorm.value) * k(1.2);
    // scripted gusts
    for (const gu of ch.gusts || []) if (u >= gu && !this.firedGusts.has(gu)) { this.firedGusts.add(gu); this.fireGust(1.25); }
    // captions: up a little before the words, lit as they are read, kept up while a slow reading waits
    if (!ch.cut) {
      const from = ch.cue ? Math.max(0.3, ch.cue[0] - ch.t0 - 0.7) : 0.8;
      const on = this.t > from && (this.t < ch.dur - 0.45 || this.holding) && !this.dip;
      if (on !== this.capOn) {
        this.capOn = on;
        if (on) this.captions.show(ch);
        else this.captions.hide();
      }
      this.captions.dark(G.uNight.value > 0.5);
    }
    this.captions.light(ch, this.at);
  }

  _expose(target, dt, rate) {
    this.exposure += (target - this.exposure) * Math.min(1, dt * rate); // dt >= 1 snaps
    if (this.renderer) this.renderer.toneMappingExposure = this.exposure;
  }
  // a gust front rolling in from downwind of the camera, toward the mountain
  fireGust(strength = 1) {
    const d = G.uWind.value;
    const along = this.camera.position.x * d.x + this.camera.position.z * d.y;
    const speed = 10;
    G.uGust.value.set(along - 70, strength * (this.reduce ? 0.5 : 1), 16, speed);
    this.gust.on = true;
    this.gust.end = along + 110;
  }
  _gusts(dt) {
    const g = G.uGust.value;
    if (this.gust.on) {
      g.x += g.w * dt;
      if (g.x > this.gust.end) { this.gust.on = false; g.y = 0; }
    }
    // idle breezes now and then
    this.gust.next -= dt;
    if (this.gust.next < 0) {
      this.gust.next = (14 + Math.random() * 18) * (this.reduce ? 2 : 1);
      if (!this.gust.on) this.fireGust(0.55 + Math.random() * 0.4);
    }
  }

  // the clock: the recording while it is heard, else our own (also while the browser holds the sound back);
  // stopped while paused or holding
  _clock(dt) {
    const S = this.sound;
    const running = this.active && !this.paused && !this.holding;
    if (!running) { S.hold(); return; }
    if (S.narrate && !S.blocked && this.at < this.duration - 0.3) {
      S.run(this.at, this.speed);
      const c = S.clock(dt);
      if (!c) return; // waiting for the voice (it gives up after a while and the story goes on silent)
      if (Math.abs(c.t - this.at) > 2) { S.seek(this.at); return; } // (it began from elsewhere: bring it here)
      this.at = Math.min(this.duration, this.at + dt * this.speed);
      if (c.fresh) { const e = c.t - this.at; this.at = Math.abs(e) > 0.3 ? c.t : this.at + e * Math.min(1, dt * 3); }
      return;
    }
    S.hold();
    this.at = Math.min(this.duration, this.at + dt * this.speed);
  }

  update(dt) {
    this._gusts(dt * this.worldRate);
    this._clock(dt);
    if (this.dip) {
      const D = this.dip;
      D.t += dt;
      if (D.phase === 'in') {
        this.captions.dip(ss(D.t / DIP_IN));
        if (D.t >= DIP_IN + 0.12) {
          if (D.target < 0) this._leave();
          else {
            if (D.at != null) this._seek(D.at);
            this._enter(D.target, true);
          }
          D.phase = 'out';
          D.t = 0;
        }
      } else {
        this.captions.dip(1 - ss(D.t / DIP_OUT));
        if (D.t >= DIP_OUT) { this.dip = null; this.captions.dip(0); }
      }
      if (D.phase === 'in' && this.active) return; // hold the frame while the paper comes down
    }
    if (this.active && this.i >= 0) {
      const ch = this.chapters[this.i], next = this.chapters[this.i + 1];
      this.t = this.at - ch.t0;
      if (!this.dip && !this.paused && !this.holding) {
        // reading slowly (and at the very end): wait at the chapter's end until asked to go on
        const H = this._holdAt(this.i);
        if ((this.pace === 'slow' || !next) && this.released !== this.i && this.at >= H) {
          this.at = H;
          this.t = H - ch.t0;
          this.holding = true;
          this.sound.hold();
          this._changed();
        } else {
          const want = this._chapterAt(this.at);
          if (want > this.i + 1) { this._seek(this.at); this._enter(want, true); return; } // (back from a hidden tab: catch up)
          if (!next) { if (this.t >= ch.dur - 0.02) { this.stop(); return; } }
          else if (this.at >= next.t0 - (this._needsDip(this.i + 1) ? DIP_IN + 0.12 : 0)) {
            this.go(this.i + 1, false);
            if (this.dip) return;
          }
        }
      }
      this._look(dt);
      this._apply(dt);
      if (this.debugCam) this.debugCam(this.camera); // (debugging: look at a held shot from elsewhere)
      return;
    }
    // no story: the viewer's own way about
    const ex = this.roam.update(dt);
    G.uPetalAmt.value += (1 - G.uPetalAmt.value) * Math.min(1, dt * 1.5);
    // under the peach trees (and not far above them) the petals keep coming down in drifts
    const C = this.camera.position, inWood = C.z > 165 && C.z < 430 && C.y - surfaceHeight(C.x, C.z) < 40;
    const storm = inWood ? (this.reduce ? 0.2 : 0.55) : 0;
    G.uPetalStorm.value += (storm - G.uPetalStorm.value) * Math.min(1, dt * 1.2);
    this._expose(ex, dt, ex > this.exposure ? 0.9 : 1.5);
    this.story.boat = { ...MOORED };
    if (this.returnTime) {
      const R = this.returnTime;
      R.t += dt;
      this.daylight.apply(mixTime(R.from, 'morning', ss(R.t / 3)));
      if (R.t >= 3) this.returnTime = null;
    }
  }
  setBase(p, l) { this.roam.place(arr(p), arr(l)); }

  // (debugging) hold chapter i at u
  preview(i, u) {
    if (!this.active) this.start(i);
    this.dip = null;
    this.captions.dip(0);
    this._seek(this.chapters[i].t0 + u * this.chapters[i].dur);
    this.holding = false;
    this.paused = true;
    this._enter(i, true);
  }
}
