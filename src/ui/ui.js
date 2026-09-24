// The page's controls: at the bottom, the strip of scenes with the note of where the viewer is, and 循文入境
// (when no story plays), or the player (chapter, time, progress, transport, 目录, 朗读, ⋯, 退出); the chapter
// list, the settings, the words' notes and the scene's cards, notices, and the picture alone. Every key and every gesture on the view comes through here and goes to the
// story (director) while it plays, else to the walker (roam).
import * as THREE from 'three';
import { gestures } from './gestures.js';
import { PLACES } from '../story/roam.js';
import { landmarkAt } from '../story/landmarks.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const store = {
  get(k, d) { try { return localStorage.getItem('taoyuan.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('taoyuan.' + k, v); } catch { /* private mode: not remembered */ } },
};
const NUM = '一二三四五六七八九';
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const cn = (n) => (n < 10 ? NUM[n - 1] : n === 10 ? '十' : n < 20 ? '十' + NUM[n - 11] : NUM[Math.floor(n / 10) - 1] + '十' + (n % 10 ? NUM[(n % 10) - 1] : ''));

export class UI {
  constructor({ director, sound, captions, app, canvas, camera }) {
    this.d = director;
    this.s = sound;
    this.c = captions;
    this.app = app;
    this.canvas = canvas;
    this.camera = camera;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.bare = false;
    this.scrub = null;
    this.hintT = 0;
    this.cardT = 0;
    this.rc = new THREE.Raycaster();
    this.el = {
      body: document.body, journey: $('btnJourney'), prev: $('btnPrev'), play: $('btnPlay'), next: $('btnNext'), name: $('chapName'),
      no: $('chapNo'), clock: $('clock'), toc: $('btnToc'), voice: $('btnVoice'), more: $('btnMore'), exit: $('btnExit'),
      bottom: $('bottom'), scenes: $('scenes'), note: $('sceneNote'),
      progress: $('progress'), fill: $('progressFill'), knob: $('progressKnob'), ticks: $('ticks'), tip: $('scrubTip'),
      hold: $('holdTip'), holdMsg: $('holdMsg'), goOn: $('btnGoOn'), again: $('btnAgain'), recenter: $('btnRecenter'),
      hint: $('lookHint'), toast: $('toast'), word: $('word'), card: $('card'), show: $('btnShowUI'),
      panels: { more: $('morePanel'), toc: $('tocPanel'), help: $('helpPanel') },
    };
    this.c.onWord = (k, el) => this.word(k, el);
    this.sound = sound;
    sound.onFail = (why, what) => {
      this.toast(what === 'ambient' ? `环境声无法开启：${why}。` : `朗读未能播放（${why}），已保持无声阅读，可稍后在「朗读」重试。`, 6000);
      this.refresh();
    };
    sound.onBlocked = () => this.toast('浏览器暂未允许自动播放声音：点一下画面或任一按钮，朗读就从当前这句接上。', 7000);
    // any touch, click or key: the voice may be heard from now on
    for (const ev of ['click', 'keydown', 'touchend']) window.addEventListener(ev, () => sound.unlock(), true);
    this._settings();
    this._buttons();
    this._progress();
    this._toc();
    this._scenes();
    this._dock();
    this._keys();
    this._gestures();
    director.onChange(() => this.refresh());
    this.refresh();
    this.el.hint.textContent = this.coarse
      ? '拖动环顾 · 双指缩放 · 双击走过去 · 轻点景物看原文'
      : '拖动环顾 · W A S D 行走 · 滚轮前后 · 双击走过去 · 单击景物看原文 · 1–0 换景';
  }
  // the page has come up from under the loading seal (a notice given before then is given again now)
  shown() {
    if (this._early) { const [m, ms] = this._early; this._early = null; this.toast(m, ms); }
  }

  // ---------------------------------------------------------------- settings
  _settings() {
    const lite = this.coarse || Math.min(innerWidth, innerHeight) < 560;
    this.set('pace', store.get('pace', 'flow'));
    this.set('cap', store.get('cap', 'both'));
    this.set('quality', store.get('quality', lite ? 'lite' : 'high'));
    this.set('voice', store.get('voice', 'on'));   // (heard unless the viewer has turned it off)
    this.set('amb', 'off');
    this.set('motion', 'on');
    for (const seg of document.querySelectorAll('.seg')) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (b) this.set(seg.dataset.opt, b.dataset.v, true);
      });
    }
  }
  set(opt, v, byHand = false) {
    // (only a choice made by hand is remembered: a default stays a default, e.g. 轻量 on a phone)
    if (opt === 'pace') { this.d.setPace(v); if (byHand) store.set('pace', v); }
    else if (opt === 'cap') { this.c.setMode(v); if (byHand) store.set('cap', v); }
    else if (opt === 'quality') { this.app.setQuality(v); if (byHand) store.set('quality', v); }
    else if (opt === 'voice') {
      const on = this.s.setNarrate(v === 'on');
      if (byHand) store.set('voice', on ? 'on' : 'off');
      if (on && byHand && !this.d.active) this.toast('朗读已开启：开始「循文入境」后播放。');
    } else if (opt === 'amb') this.s.setAmbient(v === 'on');
    else if (opt === 'motion') this.app.setMotion(v === 'on');
    this._segs();
  }
  _segs() {
    const val = { pace: this.d.pace, cap: this.c.mode, quality: this.app.quality, voice: this.s.narrate ? 'on' : 'off', amb: this.s.ambient ? 'on' : 'off', motion: this.app.motion ? 'on' : 'off' };
    for (const seg of document.querySelectorAll('.seg')) {
      for (const b of seg.querySelectorAll('button')) {
        const on = b.dataset.v === val[seg.dataset.opt];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
    this.el.voice.setAttribute('aria-pressed', String(this.s.narrate));
    this.el.voice.textContent = this.s.narrate ? '朗读 · 开' : '朗读 · 关';
  }

  // ---------------------------------------------------------------- buttons and panels
  _buttons() {
    const E = this.el, d = this.d;
    E.journey.addEventListener('click', () => d.start(0));
    E.prev.addEventListener('click', () => d.prev());
    E.next.addEventListener('click', () => d.next());
    E.play.addEventListener('click', () => d.togglePause());
    E.exit.addEventListener('click', () => d.stop());
    E.goOn.addEventListener('click', () => d.resume());
    E.again.addEventListener('click', () => d.restart());
    E.recenter.addEventListener('click', () => d.recenter());
    E.voice.addEventListener('click', () => this.set('voice', this.s.narrate ? 'off' : 'on', true));
    E.toc.addEventListener('click', () => this.toggle('toc'));
    E.more.addEventListener('click', () => this.toggle('more'));
    E.show.addEventListener('click', () => this.setBare(false));
    $('actReset').addEventListener('click', () => { this.close(); if (d.active) d.recenter(); else d.roam.home(); });
    $('actShot').addEventListener('click', () => this.shot());
    $('actHide').addEventListener('click', () => { this.close(); this.setBare(true); });
    $('actRestart').addEventListener('click', () => { this.close(); d.restart(); });
    $('actHelp').addEventListener('click', () => this.toggle('help'));
    for (const p of Object.values(E.panels)) p.querySelector('.x')?.addEventListener('click', () => this.close());
    E.card.querySelector('.x').addEventListener('click', () => this.card(null));
    // a press anywhere else puts away a popover (not a sheet)
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.pop, #controls, .kw')) {
        if (this.open === 'more') this.close();
        E.word.classList.add('hidden');
      }
    }, true);
    window.addEventListener('resize', () => { if (this.open === 'more') this._anchor(E.panels.more, E.more); });
  }
  toggle(k) {
    if (this.open === k) { this.close(); return; }
    this.close();
    this.open = k;
    const P = this.el.panels[k];
    P.classList.remove('hidden');
    if (P.classList.contains('sheet')) { this.card(null); this.el.word.classList.add('hidden'); } // (the sheet stands where they would)
    else this._anchor(P, this.el.more);
    if (k === 'toc') {
      const cur = P.querySelector('li.now') || P.querySelector('li');
      cur?.scrollIntoView({ block: 'center' });
      (cur?.querySelector('button'))?.focus({ preventScroll: true });
    } else P.querySelector('button')?.focus({ preventScroll: true });
    this.el[k === 'more' || k === 'help' ? 'more' : k]?.setAttribute('aria-expanded', 'true');
  }
  close() {
    if (!this.open) return false;
    this.el.panels[this.open].classList.add('hidden');
    for (const b of [this.el.toc, this.el.more]) b.setAttribute('aria-expanded', 'false');
    this.open = null;
    this.canvas.focus({ preventScroll: true });
    return true;
  }
  setBare(on) {
    this.bare = on;
    this.el.body.classList.toggle('bare', on);
    this.el.show.classList.toggle('hidden', !on);
    if (on) { this.close(); this.card(null); }
  }
  // a popover just above the button that opened it, kept on the screen
  _anchor(P, btn) {
    const r = btn.getBoundingClientRect(), w = P.offsetWidth;
    const top = Math.min(r.top, document.getElementById('controls').getBoundingClientRect().top);
    P.style.transform = 'none';
    P.style.bottom = `${Math.round(innerHeight - top + 10)}px`;
    P.style.maxHeight = `${Math.round(top - 22)}px`;
    P.style.left = `${Math.round(clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12))}px`;
  }
  toast(msg, ms = 4200) {
    if (document.getElementById('ui').classList.contains('hidden')) { this._early = [msg, ms]; return; } // (not up yet)
    const T = this.el.toast;
    T.textContent = msg;
    T.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => T.classList.remove('on'), ms);
  }

  // ---------------------------------------------------------------- the story's state on the bar
  refresh() {
    const E = this.el, d = this.d, ch = d.chapter;
    E.body.classList.toggle('journey', d.active);
    const last = d.active && d.i === d.chapters.length - 1;
    E.play.dataset.state = d.holding || d.paused ? 'play' : 'pause';
    E.play.setAttribute('aria-label', d.holding || d.paused ? '继续' : '暂停');
    E.name.textContent = ch ? ch.name : '';
    E.no.textContent = ch ? `${String(d.i + 1).padStart(2, '0')} / ${d.chapters.length}` : '';
    E.hold.classList.toggle('hidden', !(d.active && d.holding));
    E.holdMsg.textContent = last ? '全文完' : '本幕读完';
    E.goOn.textContent = last ? '回到桃林' : '继续 ›';
    E.again.classList.toggle('hidden', !last);
    for (const li of this.tocItems) li.classList.toggle('now', d.active && +li.dataset.i === d.i);
    this._segs();
    if (!d.active) this.hintT = 0;
  }
  // per frame
  update(dt) {
    const E = this.el, d = this.d;
    if (d.active && this.scrub == null) this._fill(d.at / d.duration);
    if (d.active) {
      const c = `${mmss(this.scrub != null ? this.scrub * d.duration : d.at)} / ${mmss(d.duration)}`;
      if (c !== this._clockText) E.clock.textContent = this._clockText = c;
    }
    E.recenter.classList.toggle('hidden', !d.offCenter || this.bare);
    if (d.roam.here !== this._here) this._at(d.roam.here);
    // the hint fades once the viewer has found their feet
    this.hintT += dt;
    E.hint.classList.toggle('off', this.hintT > (this.movedOnce ? 6 : 30));
    if (this.cardT > 0 && (this.cardT -= dt) <= 0) this.card(null);
  }
  moved() { if (!this.movedOnce) { this.movedOnce = true; this.hintT = Math.max(this.hintT, 0); } }

  // ---------------------------------------------------------------- progress: shows, and scrubs
  _progress() {
    const E = this.el, d = this.d, P = E.progress;
    for (const ch of d.chapters.slice(1)) {
      const t = document.createElement('i');
      t.style.left = `${(ch.t0 / d.duration) * 100}%`;
      E.ticks.append(t);
    }
    const frac = (e) => { const r = P.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
    const tip = (f) => {
      const ch = d.chapters[d._chapterAt(f * d.duration)];
      E.tip.textContent = `${cn(d.chapters.indexOf(ch) + 1)} · ${ch.name}`;
      E.tip.style.left = `${f * 100}%`;
    };
    P.addEventListener('pointerdown', (e) => {
      P.setPointerCapture(e.pointerId);
      this.scrub = frac(e);
      P.classList.add('scrub');
      this._fill(this.scrub); tip(this.scrub);
    });
    P.addEventListener('pointermove', (e) => {
      const f = frac(e);
      if (this.scrub != null) { this.scrub = f; this._fill(f); }
      tip(f);
    });
    const end = (go) => {
      if (this.scrub == null) return;
      const f = this.scrub;
      this.scrub = null;
      P.classList.remove('scrub');
      if (go) d.seekTo(f * d.duration);
    };
    P.addEventListener('pointerup', () => end(true));
    P.addEventListener('pointercancel', () => end(false));
  }
  _fill(f) {
    const E = this.el;
    E.fill.style.width = `${f * 100}%`;
    E.knob.style.left = `${f * 100}%`;
    E.progress.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }

  // ---------------------------------------------------------------- the chapter list: the whole text
  _toc() {
    const list = $('tocList');
    this.tocItems = [];
    this.d.chapters.forEach((ch, i) => {
      if (!ch.orig) return; // (the closing card)
      const li = document.createElement('li');
      li.dataset.i = String(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="n">${cn(i + 1)}</span><span class="o"></span><span class="g"></span>`;
      b.querySelector('.o').textContent = ch.orig;
      b.querySelector('.g').textContent = ch.gloss;
      b.setAttribute('aria-label', `第${cn(i + 1)}幕 ${ch.name}：${ch.orig}`);
      b.addEventListener('click', () => { this.close(); this.d.go(i); });
      li.append(b);
      list.append(li);
      this.tocItems.push(li);
    });
  }
  // the strip of scenes: one of them lit while the viewer is there
  _scenes() {
    const S = this.el.scenes;
    this.sceneBtns = PLACES.map((pl, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="idx"></span><span class="label"></span>';
      b.querySelector('.idx').textContent = String(i + 1).padStart(2, '0');
      b.querySelector('.label').textContent = pl.name;
      b.title = `${pl.q}（${(i + 1) % 10}）`;
      b.setAttribute('aria-label', `${pl.name}：${pl.q}`);
      b.addEventListener('click', () => {
        if (this.d.active || this.d.dip) return;
        this.d.roam.goPlace(i); // (the one already lit: back to its view)
        this.moved();
      });
      S.append(b);
      return b;
    });
    // (a mouse wheel turns the strip along, when it is longer than its room)
    S.addEventListener('wheel', (e) => {
      if (S.scrollWidth <= S.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      S.scrollLeft += e.deltaY;
    }, { passive: false });
    const edges = () => {
      const over = S.scrollWidth - S.clientWidth;
      S.classList.toggle('more-l', over > 2 && S.scrollLeft > 2);
      S.classList.toggle('more-r', over > 2 && S.scrollLeft < over - 2);
    };
    S.addEventListener('scroll', edges, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(edges).observe(S);
    window.addEventListener('resize', edges);
    this._here = undefined;
  }
  _at(i) {
    this._here = i;
    const E = this.el;
    this.sceneBtns.forEach((b, j) => {
      b.classList.toggle('on', j === i);
      if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    E.note.classList.toggle('off', i < 0);
    if (i < 0) return;
    const pl = PLACES[i];
    $('sceneNo').textContent = `${String(i + 1).padStart(2, '0')} / ${PLACES.length}`;
    $('sceneName').textContent = pl.name;
    $('sceneQuote').textContent = pl.q;
    // the lit one brought into the strip's view
    const S = E.scenes, b = this.sceneBtns[i];
    if (S.scrollWidth > S.clientWidth) {
      const left = clamp(b.offsetLeft - (S.clientWidth - b.offsetWidth) / 2, 0, S.scrollWidth - S.clientWidth);
      S.scrollTo({ left, behavior: this.d.reduce ? 'auto' : 'smooth' });
    }
  }
  // how tall the things at the bottom stand (what floats above them keeps clear of them)
  _dock() {
    const B = this.el.bottom, root = document.documentElement;
    const set = () => root.style.setProperty('--dock', `${Math.ceil(B.getBoundingClientRect().height)}px`);
    if (window.ResizeObserver) new ResizeObserver(set).observe(B);
    window.addEventListener('resize', set);
    set();
  }

  // ---------------------------------------------------------------- words and things
  word(k, el) {
    const W = this.el.word;
    W.querySelector('b').textContent = k.w;
    W.querySelector('p').textContent = k.note;
    W.classList.remove('hidden');
    // beside the caption's paper rather than over it (on a phone, narrower to fit the room to its right)
    const paper = el.closest('.paper')?.getBoundingClientRect();
    const room = paper ? innerWidth - paper.right - 22 : 0;
    W.style.maxWidth = room >= 180 && room < 300 ? `${room}px` : '';
    const r = el.getBoundingClientRect(), w = W.offsetWidth, h = W.offsetHeight;
    let x = (room >= 180 ? paper.right : r.right) + 10, y = r.top - 4;
    if (x + w > innerWidth - 12) x = r.left - w - 12;
    W.style.left = `${clamp(x, 12, innerWidth - w - 12)}px`;
    W.style.top = `${clamp(y, 12, innerHeight - h - 12)}px`;
  }
  // a tap on the view: what the text says of the thing there (or put the card away)
  pickThing(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.d.roam.pick(cx, cy);
    return landmarkAt(this.rc.ray, hit, this.d.story.boat);
  }
  tap(cx, cy) {
    if (this.bare) return;
    const lm = this.pickThing(cx, cy);
    if (lm && this.el.card.dataset.key === lm.key && !this.el.card.classList.contains('hidden')) { this.card(null); return; }
    this.card(lm);
  }
  card(lm) {
    const C = this.el.card;
    if (!lm) { C.classList.add('hidden'); C.dataset.key = ''; this.cardT = 0; return; }
    C.dataset.key = lm.key;
    C.querySelector('h3').textContent = lm.name;
    C.querySelector('.o').textContent = lm.orig;
    C.querySelector('.n').textContent = lm.note;
    C.classList.remove('hidden');
    this.cardT = 20;
  }

  // ---------------------------------------------------------------- the picture
  async shot() {
    this.close();
    const blob = await this.app.shot();
    if (!blob) { this.toast('保存失败：浏览器未能导出画面。'); return; }
    const ch = this.d.chapter, now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `桃源-${ch ? ch.name : '信步'}-${stamp}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.toast('已保存当前画面（PNG，不含界面文字）。');
  }

  // ---------------------------------------------------------------- keys
  _keys() {
    const d = this.d, roam = d.roam;
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target.closest?.('button, [role="slider"], a, input, select, textarea');
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.bare) this.setBare(false);
        else if (!this.el.word.classList.contains('hidden')) this.el.word.classList.add('hidden');
        else if (this.close()) { /* a panel put away */ }
        else if (!this.el.card.classList.contains('hidden')) this.card(null);
        else if (d.active) d.stop();
        else roam.home();
        return;
      }
      if (e.repeat && !e.code.startsWith('Arrow') && !/^Key[WASDEQC]$/.test(e.code) && e.code !== 'Space') return;
      if (e.code === 'KeyH') { this.setBare(!this.bare); return; }
      if (e.code === 'KeyT') { this.toggle('toc'); return; }
      if (e.code === 'KeyV') { this.set('voice', this.s.narrate ? 'off' : 'on', true); return; }
      if (onControl && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return; // (the focused control takes it)
      if (this.open === 'toc' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) return; // (scrolling the list)
      if (d.active) {
        if (e.code === 'Space') { e.preventDefault(); d.togglePause(); }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); d.prev(); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); d.next(); }
        else if (e.code === 'KeyR') d.recenter();
        else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && d.holding) d.resume();
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { d.start(0); return; }
      if (d.dip || roam.fade) return;
      if (e.code === 'KeyR') { roam.home(); return; }
      if (roam.keyDown(e.code)) { e.preventDefault(); this.moved(); return; }
      const m = /^Digit(\d)$/.exec(e.code);
      if (m) { e.preventDefault(); roam.goPlace((+m[1] + 9) % 10); this.moved(); }
    });
    window.addEventListener('keyup', (e) => roam.keyUp(e.code));
  }

  // ---------------------------------------------------------------- the view's gestures
  _gestures() {
    const d = this.d, roam = d.roam;
    gestures(this.canvas, {
      down: () => { if (d.active) d.touch(true); },
      up: () => { if (d.active) d.touch(false); },
      drag: (dx, dy) => {
        if (d.active) d.lookBy(dx, dy);
        else if (!d.dip) { roam.lookBy(dx, dy); this.moved(); }
      },
      pinch: (f) => { if (d.active) d.zoomBy(1 / f); else roam.zoomBy(1 / f); },
      wheel: (dy, pinch) => {
        if (d.active) d.zoomBy(Math.exp(dy * (pinch ? 0.006 : 0.0012)));
        else if (pinch) roam.zoomBy(Math.exp(dy * 0.006));
        else if (!d.dip) { roam.wheel(dy); this.moved(); }
      },
      doubleTap: (x, y) => { if (!d.active && !d.dip) { roam.goTo(x, y); this.moved(); } },
      tap: (x, y) => this.tap(x, y),
    });
  }
}
