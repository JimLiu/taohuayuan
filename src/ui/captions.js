// 字幕: the line being read, small, at the edge of the frame — the original, a short plain gloss, or both —
// with the clause being read picked out (by the recitation's timings, whether or not it is heard). A few words
// in it can be tapped for what they mean. Also the paper cards between scenes and the paper dip over a jump.
import { KEYWORDS } from '../story/glossary.js';

const $ = (id) => document.getElementById(id);
const HAN = /[一-鿿]/;
const STOP = /[，。；：？！]/;   // a clause ends after these
const CLOSE = /[”’」』）]/;      // these ride with the clause before
export const CAP_MODES = { both: '原文＋白话', orig: '只看原文', gloss: '只看白话' };

export class Captions {
  constructor({ onWord } = {}) {
    this.el = { cap: $('caption'), orig: $('capOrig'), gloss: $('capGloss'), cut: $('cut'), cutText: $('cutText'), dip: $('dip') };
    this.onWord = onWord;
    this.ch = null;
    this.spelt = null;
    this.mode = 'both';
    // a tap on a word (the caption itself lets drags through to the view)
    const tap = (e) => {
      const b = e.target.closest('.kw');
      if (!b) return;
      e.stopPropagation();
      this.onWord?.(KEYWORDS[+b.dataset.k], b);
    };
    this.el.cap.addEventListener('click', tap);
    this.el.cutText.addEventListener('click', tap);
  }
  setMode(m) {
    if (!CAP_MODES[m]) return;
    this.mode = m;
    document.body.dataset.cap = m;
  }
  show(ch) {
    const E = this.el;
    if (this.ch !== ch) {
      this.ch = ch;
      this.spelt = this._spell(E.orig, ch);
      E.gloss.textContent = ch.brief ?? ch.gloss;
    }
    E.cap.classList.add('on');
  }
  hide() { this.el.cap.classList.remove('on'); }
  dark(on) { this.el.cap.classList.toggle('dark', !!on); }

  // the line as clauses, each a span; the chapter's words wrapped as buttons inside them
  _spell(el, ch) {
    el.innerHTML = '';
    const text = ch.orig;
    const kws = KEYWORDS.map((k, i) => ({ ...k, i })).filter((k) => k.in === ch.name);
    const kwAt = new Array(text.length).fill(-1);
    for (const k of kws) {
      const j = text.indexOf(k.w);
      if (j >= 0) for (let q = j; q < j + k.w.length; q++) kwAt[q] = k.i;
    }
    const clauses = [];   // { el, first: index of its first Han character }
    let cl = null, kwEl = null, kwCur = -1, han = 0, closed = true;
    [...text].forEach((c, q) => {
      if (CLOSE.test(c) && cl) { cl.el.append(c); return; }
      if (closed) {
        cl = { el: document.createElement('span'), first: han };
        cl.el.className = 'cl';
        clauses.push(cl);
        el.append(cl.el);
        closed = false;
        kwCur = -1;
      }
      if (kwAt[q] !== kwCur) {
        kwCur = kwAt[q];
        kwEl = null;
        if (kwCur >= 0) {
          kwEl = document.createElement('button');
          kwEl.className = 'kw';
          kwEl.type = 'button';
          kwEl.dataset.k = String(kwCur);
          kwEl.title = '释义';
          cl.el.append(kwEl);
        }
      }
      (kwEl ?? cl.el).append(c);
      if (HAN.test(c)) han++;
      if (STOP.test(c)) { closed = true; kwCur = -1; kwEl = null; }
    });
    return { clauses, now: -2 };
  }
  // pick out the clause being read at time `at`
  light(ch, at) {
    const S = ch === this.ch ? this.spelt : ch.cut ? this.cardSpelt : null;
    if (!S || !ch.chars) return;
    let n = 0;
    while (n < ch.chars.length && at >= ch.chars[n][0] - 0.05) n++;
    let now = -1;
    if (n > 0) for (let k = 0; k < S.clauses.length; k++) if (S.clauses[k].first <= n - 1) now = k;
    if (now === S.now) return;
    S.now = now;
    S.clauses.forEach((c, k) => c.el.classList.toggle('now', k === now));
  }

  // ---------------------------------------------------------------- cards and the dip
  card(ch) {
    const E = this.el;
    E.cutText.innerHTML = '';
    const o = document.createElement('div');
    o.className = 'co';
    this.cardSpelt = null;
    if (ch.cutText) o.textContent = ch.cutText;
    else this.cardSpelt = this._spell(o, ch);
    const g = document.createElement('div');
    g.className = 'cg';
    g.textContent = ch.cutText ? ch.gloss : ch.brief ?? ch.gloss;
    E.cutText.append(o, g);
    E.cut.classList.add('on');
  }
  uncard() { this.el.cut.classList.remove('on'); this.cardSpelt = null; }
  dip(o) { this.el.dip.style.opacity = String(o); }
  dipDark(on) { this.el.dip.classList.toggle('dark', !!on); }
}
