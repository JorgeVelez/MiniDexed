// --- Knob ──────────────────────────────────────────────────────────────────
import { saveState } from './state.js';

const DEG_START = 135;
const DEG_SWEEP = 270;

function degToXY(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, spanDeg) {
  if (spanDeg < 0.5) return '';
  const s = degToXY(cx, cy, r, startDeg);
  const e = degToXY(cx, cy, r, startDeg + spanDeg);
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const TRACK_ARC = arcPath(20, 20, 15, DEG_START, DEG_SWEEP);

export class Knob {
  constructor({ id, label, cc = null, channel = 1, value = 64, min = 0, max = 127 }) {
    this.id       = id;
    this.label    = label;
    this.cc       = cc;
    this.channel  = channel;
    this.value    = value;
    this.min      = min;
    this.max      = max;
    this.onChange = null;
    this.el = this._build();
    this._bindEvents();
    this._render();
  }

  _build() {
    const hasCc = this.cc !== null;
    const wrap  = document.createElement('div');
    wrap.className  = 'knob-wrap';
    wrap.dataset.id = this.id;
    wrap.innerHTML  = `
      <div class="knob-body">
        <svg class="knob-svg" viewBox="0 0 40 40" title="Drag ↕ to change">
          <path class="knob-track" d="${TRACK_ARC}" fill="none" stroke-width="3.5" stroke-linecap="round"/>
          <path class="knob-fill"  d=""              fill="none" stroke-width="3.5" stroke-linecap="round"/>
          <circle class="knob-dot" r="2.5"/>
          <text class="knob-center-val" x="20" y="20" text-anchor="middle" dominant-baseline="middle">${this.value}</text>
          <circle class="knob-center-click" cx="20" cy="20" r="9" fill="transparent" style="cursor:pointer"/>
        </svg>
        <button class="knob-edit-btn" tabindex="-1" title="Edit CC / Channel">⚙</button>
      </div>
      <div class="knob-label">${this.label}</div>
      <div class="knob-popover knob-val-pop knob-popover--hidden">
        <div class="knob-pop-row">
          <span>Val</span>
          <input class="knob-valinput" type="number" min="${this.min}" max="${this.max}" value="${this.value}">
        </div>
      </div>
      <div class="knob-popover knob-cc-pop knob-popover--hidden">
        ${hasCc
          ? `<div class="knob-pop-row"><span>CC</span><input class="knob-cc-input" type="number" min="0" max="127" value="${this.cc}"></div>
             <div class="knob-pop-row"><span>Ch</span><input class="knob-ch-input" type="number" min="1" max="16"  value="${this.channel}"></div>`
          : `<div class="knob-pop-note">No CC · offsets notes</div>`
        }
      </div>
    `;
    return wrap;
  }

  _render() {
    const norm  = (this.value - this.min) / (this.max - this.min);
    const span  = norm * DEG_SWEEP;
    const angle = DEG_START + span;

    this.el.querySelector('.knob-fill').setAttribute('d', arcPath(20, 20, 15, DEG_START, span));

    const dot = degToXY(20, 20, 12, angle);
    const dotEl = this.el.querySelector('.knob-dot');
    dotEl.setAttribute('cx', dot.x.toFixed(2));
    dotEl.setAttribute('cy', dot.y.toFixed(2));

    this.el.querySelector('.knob-center-val').textContent = this.value;
  }

  _bindEvents() {
    const svg         = this.el.querySelector('.knob-svg');
    const centerClick = this.el.querySelector('.knob-center-click');
    const editBtn     = this.el.querySelector('.knob-edit-btn');
    const valPop      = this.el.querySelector('.knob-val-pop');
    const ccPop       = this.el.querySelector('.knob-cc-pop');
    const valInput    = this.el.querySelector('.knob-valinput');
    const ccInput     = this.el.querySelector('.knob-cc-input');
    const chInput     = this.el.querySelector('.knob-ch-input');

    const closeAll = () => {
      document.querySelectorAll('.knob-popover:not(.knob-popover--hidden)')
        .forEach(p => p.classList.add('knob-popover--hidden'));
    };

    const togglePop = pop => {
      const wasHidden = pop.classList.contains('knob-popover--hidden');
      closeAll();
      pop.classList.toggle('knob-popover--hidden', !wasHidden);
      if (wasHidden) {
        const inp = pop.querySelector('input');
        if (inp) { inp.focus(); inp.select(); }
      }
    };

    let dragY0 = null, val0 = null, dragged = false;
    svg.addEventListener('mousedown', e => {
      e.preventDefault();
      dragY0 = e.clientY; val0 = this.value; dragged = false;
      const mm = e2 => {
        if (Math.abs(e2.clientY - dragY0) > 3) dragged = true;
        const delta = Math.round((dragY0 - e2.clientY) * (this.max - this.min) / 150);
        this.setValue(val0 + delta);
      };
      const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup',   mu);
    });

    svg.addEventListener('touchstart', e => { e.preventDefault(); dragY0 = e.touches[0].clientY; val0 = this.value; }, { passive: false });
    svg.addEventListener('touchmove',  e => {
      e.preventDefault();
      const delta = Math.round((dragY0 - e.touches[0].clientY) * (this.max - this.min) / 150);
      this.setValue(val0 + delta);
    }, { passive: false });

    centerClick.addEventListener('click', e => {
      if (dragged) return;
      e.stopPropagation();
      valInput.value = this.value;
      togglePop(valPop);
    });

    editBtn.addEventListener('click', e => { e.stopPropagation(); togglePop(ccPop); });

    const applyVal = () => {
      const v = parseInt(valInput.value);
      if (!isNaN(v)) this.setValue(v);
      valPop.classList.add('knob-popover--hidden');
    };
    valInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyVal(); if (e.key === 'Escape') valPop.classList.add('knob-popover--hidden'); });
    valInput.addEventListener('blur', () => {
      setTimeout(() => { if (!valPop.contains(document.activeElement)) applyVal(); }, 80);
    });

    if (ccInput) ccInput.addEventListener('change', () => {
      this.cc = Math.max(0, Math.min(127, parseInt(ccInput.value) || 0));
      ccInput.value = this.cc;
      saveState();
    });

    if (chInput) chInput.addEventListener('change', () => {
      this.channel = Math.max(1, Math.min(16, parseInt(chInput.value) || 1));
      chInput.value = this.channel;
      saveState();
    });

    document.addEventListener('click',   e => { if (!this.el.contains(e.target)) closeAll(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  }

  setValue(v, silent = false) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this._render();
    if (!silent && this.onChange) this.onChange(this.value, this.cc, this.channel);
    if (!silent) saveState();
  }
}
