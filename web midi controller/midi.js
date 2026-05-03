'use strict';

// --- State ---
let midiAccess      = null;
let selectedInput   = null;
let selectedOutput  = null;
let midiThru        = true;
let transposeAmount = 0;
let allKnobs        = [];

// --- DOM refs ---
const statusEl      = document.getElementById('midi-status');
const inSelect      = document.getElementById('midi-in-select');
const outSelect     = document.getElementById('midi-out-select');
const logEl         = document.getElementById('midi-log');
const thruToggle    = document.getElementById('thru-toggle');
const clearBtn      = document.getElementById('clear-btn');
const resetStateBtn = document.getElementById('reset-state-btn');
const sendBtn       = document.getElementById('send-btn');
const sendSysex     = document.getElementById('send-sysex');
const sendType      = document.getElementById('send-type');
const sendChannel   = document.getElementById('send-channel');
const sendByte1     = document.getElementById('send-byte1');
const sendByte2     = document.getElementById('send-byte2');
const fieldByte2    = document.getElementById('field-byte2');
const pcPrevBtn     = document.getElementById('pc-prev-btn');
const pcNextBtn     = document.getElementById('pc-next-btn');
const pcLabelEl     = document.getElementById('pc-label');
const pcNameEl      = document.getElementById('pc-name');
const octDownBtn    = document.getElementById('oct-down-btn');
const octUpBtn      = document.getElementById('oct-up-btn');
const pianoRangeLbl = document.getElementById('piano-range-label');

// ─── Knob ──────────────────────────────────────────────────────────────────
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

class Knob {
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

    // Drag on SVG (ignore center click zone)
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

    // Click center → value popover
    centerClick.addEventListener('click', e => {
      if (dragged) return;
      e.stopPropagation();
      valInput.value = this.value;
      togglePop(valPop);
    });

    // Gear → CC/channel popover
    editBtn.addEventListener('click', e => { e.stopPropagation(); togglePop(ccPop); });

    // Confirm value input
    const applyVal = () => {
      const v = parseInt(valInput.value);
      if (!isNaN(v)) this.setValue(v);
      valPop.classList.add('knob-popover--hidden');
    };
    valInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyVal(); if (e.key === 'Escape') valPop.classList.add('knob-popover--hidden'); });
    // Use mousedown on the arrows instead of blur to avoid closing on spinner clicks
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

// --- Knob definitions ---
const KNOB_GROUPS = [
  {
    container: 'ctrl-sound',
    knobs: [
      { id: 'harmonics',    label: 'Harmonics',    cc: 10, value: 0  },
      { id: 'timbre',       label: 'Timbre',       cc: 11, value: 64 },
      { id: 'morph',        label: 'Morph',        cc: 12, value: 0  },
      { id: 'lpg_colour',   label: 'LPG Colour',   cc: 13, value: 64 },
      { id: 'decay',        label: 'Decay',        cc: 14, value: 64 },
      { id: 'pitch_offset', label: 'Freq',          cc: 15, value: 64 },
    ],
  },
  {
    container: 'ctrl-rhythm-1',
    knobs: [
      { id: 'x1',     label: 'X',     cc: 32, value: 64 },
      { id: 'y1',     label: 'Y',     cc: 34, value: 64 },
      { id: 'chaos1', label: 'Chaos', cc: 36, value: 0  },
    ],
  },
  {
    container: 'ctrl-rhythm-2',
    knobs: [
      { id: 'x2',     label: 'X',     cc: 33, value: 64 },
      { id: 'y2',     label: 'Y',     cc: 35, value: 64 },
      { id: 'chaos2', label: 'Chaos', cc: 37, value: 0  },
    ],
  },
  {
    container: 'ctrl-global',
    knobs: [
      { id: 'bpm', label: 'BPM', cc: 70, value: 64 },
    ],
  },
  {
    container: 'ctrl-pitch',
    knobs: [
      { id: 'root',      label: 'Root',      cc: 86, value: 0,  },
      { id: 'range',     label: 'Range',     cc: 87, value: 64, },
      { id: 'scale',     label: 'Scale',     cc: 88, value: 0,  },
      { id: 'spread',    label: 'Spread',    cc: 89, value: 0,  },
      { id: 'bias',      label: 'Bias',      cc: 90, value: 64, },
      { id: 'dejavu',    label: 'Dejavu',    cc: 91, value: 0,  },
      { id: 'transpose', label: 'Transpose', cc: null, value: 0, min: -24, max: 24 },
    ],
  },
];

const SOUND_GROUP_CONTAINER  = 'ctrl-sound';
const RHYTHM_CONTAINERS      = ['ctrl-rhythm-1', 'ctrl-rhythm-2'];
let rhythmChannel = 1; // 1–6, raw MIDI nibble

function buildKnobs() {
  allKnobs = [];
  for (const group of KNOB_GROUPS) {
    const container = document.getElementById(group.container);
    if (!container) continue;
    const isSoundGroup  = group.container === SOUND_GROUP_CONTAINER;
    const isRhythmGroup = RHYTHM_CONTAINERS.includes(group.container);
    for (const def of group.knobs) {
      const knob = new Knob(def);
      knob.onChange = (value, cc, channel) => {
        if (cc === null) {
          transposeAmount = value;
          return;
        }
        if (!selectedOutput) return;
        const ch = isSoundGroup ? soundChannel : isRhythmGroup ? rhythmChannel : (channel - 1);
        selectedOutput.send([0xb0 | ch, cc, value]);
        addLogEntry('CC', 'cc', `ch${ch}  cc${cc}  val ${value}`);
      };
      container.appendChild(knob.el);
      allKnobs.push(knob);
    }
  }
}

// --- MIDI init ---
async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus('Web MIDI API not supported', false);
    return;
  }
  // Try with sysex first, fall back to without
  for (const sysex of [true, false]) {
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex });
      const count = midiAccess.inputs.size + midiAccess.outputs.size;
      setStatus(`MIDI connected${sysex ? ' + SysEx' : ''} (${count} devices)`, true);
      populateDevices();
      midiAccess.onstatechange = onStateChange;
      return;
    } catch (err) {
      console.warn(`MIDI request failed (sysex:${sysex}):`, err);
    }
  }
  setStatus('MIDI access denied', false);
}

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (ok ? 'connected' : 'disconnected');
}

// --- Device population ---
function populateDevices() {
  populateSelect(inSelect,  [...midiAccess.inputs.values()],  'in');
  populateSelect(outSelect, [...midiAccess.outputs.values()], 'out');
}

function populateSelect(selectEl, devices, dir) {
  const prevId = selectEl.value;
  selectEl.innerHTML = '';

  if (devices.length === 0) {
    selectEl.appendChild(new Option('-- No devices --', ''));
    selectEl.disabled = true;
    if (dir === 'in')  bindInput(null);
    if (dir === 'out') { selectedOutput = null; updateButtons(); }
    return;
  }

  selectEl.appendChild(new Option('-- Select device --', ''));
  for (const dev of devices) selectEl.appendChild(new Option(dev.name, dev.id));
  selectEl.disabled = false;

  const preferred = selectEl.dataset.preferred;
  if (preferred && [...selectEl.options].some(o => o.value === preferred)) {
    selectEl.value = preferred;
  } else if (prevId && [...selectEl.options].some(o => o.value === prevId)) {
    selectEl.value = prevId;
  }

  if (!selectEl.value) {
    const daisy = devices.find(d => d.name.toLowerCase().includes('daisy'));
    selectEl.value = (daisy ?? devices[0]).id;
  }

  if (dir === 'in')  bindInput(selectEl.value ? midiAccess.inputs.get(selectEl.value)  : null);
  if (dir === 'out') { selectedOutput = selectEl.value ? midiAccess.outputs.get(selectEl.value) : null; updateButtons(); }
}

function onStateChange(e) {
  const { port: { type, state, name } } = e;
  logSystem(`Device ${state}: ${name} (${type})`);
  populateDevices();
  const count = midiAccess.inputs.size + midiAccess.outputs.size;
  setStatus(`MIDI connected (${count} devices)`, true);
}

// --- Input binding ---
function bindInput(port) {
  if (selectedInput) selectedInput.onmidimessage = null;
  selectedInput = port || null;
  if (selectedInput) selectedInput.onmidimessage = onMidiMessage;
}

// --- MIDI message handler ---
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function noteName(n) {
  return NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1);
}

function onMidiMessage(e) {
  const [status, byte1, byte2] = e.data;

  if (midiThru && selectedOutput) selectedOutput.send(e.data);

  if (status === 0xf0) {
    const text = [...e.data].filter(b => b >= 0x20 && b <= 0x7e).map(b => String.fromCharCode(b)).join('').replace(/^[^a-zA-Z0-9\[{(]+/, '');
    addLogEntry('SysEx', 'sysex', text);
    return;
  }

  const type    = status >> 4;
  const channel = (status & 0x0f) + 1;
  let typeName, dataStr, cssClass;

  switch (type) {
    case 0x9:
      if (byte2 > 0) {
        typeName = 'Note On';  cssClass = 'noteon';
        highlightKey(byte1, true);
      } else {
        typeName = 'Note Off'; cssClass = 'noteoff';
        highlightKey(byte1, false);
      }
      dataStr = `ch${channel}  ${noteName(byte1)} (${byte1})  vel ${byte2}`;
      break;
    case 0x8:
      typeName = 'Note Off'; cssClass = 'noteoff';
      dataStr  = `ch${channel}  ${noteName(byte1)} (${byte1})  vel ${byte2}`;
      highlightKey(byte1, false);
      break;
    case 0xb:
      typeName = 'CC';  cssClass = 'cc';
      dataStr  = `ch${channel}  cc${byte1}  val ${byte2}`;
      break;
    case 0xc:
      typeName = 'Prog Chg'; cssClass = 'pc';
      dataStr  = `ch${channel}  prog ${byte1}`;
      currentProgram = byte1;
      updatePcLabel();
      break;
    case 0xe:
      typeName = 'Pitch Bend'; cssClass = 'other';
      dataStr  = `ch${channel}  val ${((byte2 << 7) | byte1) - 8192}`;
      break;
    case 0xa:
      typeName = 'Aftertouch'; cssClass = 'other';
      dataStr  = `ch${channel}  note ${byte1}  val ${byte2}`;
      break;
    case 0xd:
      typeName = 'Chan Press'; cssClass = 'other';
      dataStr  = `ch${channel}  val ${byte1}`;
      break;
    default:
      typeName = `0x${type.toString(16).toUpperCase()}`; cssClass = 'other';
      dataStr  = [...e.data].map(b => b.toString(16).padStart(2,'0')).join(' ');
  }

  addLogEntry(typeName, cssClass, dataStr);
}

// --- Log ---
function addLogEntry(typeName, cssClass, dataStr) {
  const placeholder = logEl.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  const now  = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false }) +
               '.' + String(now.getMilliseconds()).padStart(3,'0');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-time">${time}</span>` +
    `<span class="log-type ${cssClass}">${typeName}</span>` +
    `<span class="log-data">${dataStr}</span>`;

  logEl.prepend(entry);
  while (logEl.children.length > 200) logEl.removeChild(logEl.lastChild);
}

function logSystem(msg) { addLogEntry('System', 'other', msg); }

// --- Send MIDI ---
function getChannel() {
  return Math.max(1, Math.min(16, parseInt(sendChannel.value, 10) || 1)) - 1;
}

function buildMessage() {
  const ch = getChannel();
  const b1 = Math.max(0, Math.min(127, parseInt(sendByte1.value, 10) || 0));
  const b2 = Math.max(0, Math.min(127, parseInt(sendByte2.value, 10) || 0));
  switch (sendType.value) {
    case 'noteon':  return [0x90 | ch, b1, b2];
    case 'noteoff': return [0x80 | ch, b1, b2];
    case 'cc':      return [0xb0 | ch, b1, b2];
    case 'pc':      return [0xc0 | ch, b1];
    case 'sysex': {
      const bytes = sendSysex.value.trim().split(/\s+/).map(s => parseInt(s, 16)).filter(n => !isNaN(n));
      if (bytes.length < 2 || bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7) return null;
      return bytes;
    }
    default: return null;
  }
}

function sendMessage() {
  if (!selectedOutput) return;
  const msg = buildMessage();
  if (!msg) return;
  selectedOutput.send(msg);
  if (sendType.value === 'sysex') {
    const hex = msg.map(b => b.toString(16).padStart(2, '0')).join(' ');
    addLogEntry('SysEx', 'sysex', hex);
  } else {
    onMidiMessage({ data: msg });
  }
}

function updateButtons() {
  const has = !!selectedOutput;
  sendBtn.disabled   = !has;
  pcPrevBtn.disabled = !has;
  pcNextBtn.disabled = !has;
}

// --- Send type UI ---
sendType.addEventListener('change', () => {
  const isPc    = sendType.value === 'pc';
  const isCC    = sendType.value === 'cc';
  const isSysex = sendType.value === 'sysex';
  fieldByte2.style.display = (isPc || isSysex) ? 'none' : '';
  document.getElementById('field-byte1').style.display = isSysex ? 'none' : '';
  document.getElementById('field-sysex').style.display = isSysex ? '' : 'none';
  document.querySelector('label[for="send-byte1"]').textContent =
    isCC ? 'CC Number' : isPc ? 'Program' : 'Note';
  document.querySelector('label[for="send-byte2"]').textContent =
    isCC ? 'Value' : 'Velocity';
});

// --- Piano keyboard ---
const PIANO_OCTAVES = 5;
const BLACK_NOTES   = new Set([1, 3, 6, 8, 10]);
const WHITE_KEY_W   = 32;
const BLACK_KEY_W   = 20;
const OCT_MIN       = 12;
const OCT_MAX       = 84;

const KEY_MAP = new Map([
  ['KeyA', 0],  ['KeyW', 1],  ['KeyS', 2],  ['KeyE', 3],
  ['KeyD', 4],  ['KeyF', 5],  ['KeyT', 6],  ['KeyG', 7],
  ['KeyY', 8],  ['KeyH', 9],  ['KeyU', 10], ['KeyJ', 11],
  ['KeyK', 12], ['KeyO', 13], ['KeyL', 14], ['KeyP', 15],
  ['Semicolon', 16], ['Quote', 17],
]);

const KEY_HINTS = new Map([
  [0,'A'], [2,'S'], [4,'D'], [5,'F'], [7,'G'], [9,'H'], [11,'J'],
  [12,'K'], [14,'L'], [16,';'],
]);

let pianoStartNote = 48;
const activeNotes  = new Map();
let mouseHeldNote  = null;

function buildPiano() {
  const piano = document.getElementById('piano');
  piano.innerHTML = '';

  const start = pianoStartNote;
  const end   = start + PIANO_OCTAVES * 12;

  const whiteNotes = [];
  for (let n = start; n < end; n++) {
    if (!BLACK_NOTES.has(n % 12)) whiteNotes.push(n);
  }

  for (const note of whiteNotes) {
    const key = document.createElement('div');
    key.className = 'key white';
    key.dataset.note = note;

    if (note % 12 === 0) {
      const lbl = document.createElement('span');
      lbl.className = 'key-label';
      lbl.textContent = noteName(note);
      key.appendChild(lbl);
    }

    const offset = note - start;
    if (KEY_HINTS.has(offset)) {
      const hint = document.createElement('span');
      hint.className = 'key-kbd';
      hint.textContent = KEY_HINTS.get(offset);
      key.appendChild(hint);
    }

    addKeyListeners(key);
    piano.appendChild(key);
  }

  for (let n = start; n < end; n++) {
    if (!BLACK_NOTES.has(n % 12)) continue;
    const leftWhiteIdx = whiteNotes.indexOf(n - 1);
    if (leftWhiteIdx === -1) continue;

    const key = document.createElement('div');
    key.className = 'key black';
    key.dataset.note = n;
    key.style.left = `${(leftWhiteIdx + 1) * WHITE_KEY_W - BLACK_KEY_W / 2}px`;
    addKeyListeners(key);
    piano.appendChild(key);
  }

  pianoRangeLbl.textContent = `${noteName(start)} – ${noteName(end - 1)}`;
  octDownBtn.disabled = start <= OCT_MIN;
  octUpBtn.disabled   = start >= OCT_MAX;
}

function addKeyListeners(key) {
  key.addEventListener('mousedown', e => {
    e.preventDefault();
    const note = parseInt(key.dataset.note);
    if (mouseHeldNote !== null && mouseHeldNote !== note) noteOff(mouseHeldNote, 'mouse');
    mouseHeldNote = note;
    noteOn(note, 'mouse');
  });
  key.addEventListener('touchstart',  e => { e.preventDefault(); noteOn(parseInt(key.dataset.note),  'touch'); }, { passive: false });
  key.addEventListener('touchend',    e => { e.preventDefault(); noteOff(parseInt(key.dataset.note), 'touch'); }, { passive: false });
  key.addEventListener('touchcancel', e => { e.preventDefault(); noteOff(parseInt(key.dataset.note), 'touch'); }, { passive: false });
}

document.addEventListener('mouseup', () => {
  if (mouseHeldNote !== null) { noteOff(mouseHeldNote, 'mouse'); mouseHeldNote = null; }
});

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const offset = KEY_MAP.get(e.code);
  if (offset === undefined) return;
  e.preventDefault();
  const note = pianoStartNote + offset;
  if (note < 0 || note > 127) return;
  noteOn(note, e.code);
});

document.addEventListener('keyup', e => {
  const offset = KEY_MAP.get(e.code);
  if (offset === undefined) return;
  e.preventDefault();
  noteOff(pianoStartNote + offset, e.code);
});

// --- Note on/off ---
function noteOn(note, _source) {
  if (activeNotes.has(note)) return;
  activeNotes.set(note, _source);
  highlightKey(note, true);
  if (!selectedOutput) return;
  const ch = soundChannel;
  const midiNote = Math.max(0, Math.min(127, note + transposeAmount));
  selectedOutput.send([0x90 | ch, midiNote, 100]);
  addLogEntry('Note On', 'noteon', `ch${ch + 1}  ${noteName(midiNote)} (${midiNote})  vel 100`);
}

function noteOff(note, _source) {
  if (!activeNotes.has(note)) return;
  activeNotes.delete(note);
  highlightKey(note, false);
  if (!selectedOutput) return;
  const ch = soundChannel;
  const midiNote = Math.max(0, Math.min(127, note + transposeAmount));
  selectedOutput.send([0x80 | ch, midiNote, 0]);
  addLogEntry('Note Off', 'noteoff', `ch${ch + 1}  ${noteName(midiNote)} (${midiNote})  vel 0`);
}

function releaseAllNotes() {
  for (const note of [...activeNotes.keys()]) noteOff(note, activeNotes.get(note));
  mouseHeldNote = null;
}

function highlightKey(note, on) {
  const key = document.querySelector(`.key[data-note="${note}"]`);
  if (key) key.classList.toggle('active', on);
}

octDownBtn.addEventListener('click', () => { releaseAllNotes(); pianoStartNote = Math.max(OCT_MIN, pianoStartNote - 12); buildPiano(); });
octUpBtn.addEventListener('click',   () => { releaseAllNotes(); pianoStartNote = Math.min(OCT_MAX, pianoStartNote + 12); buildPiano(); });

// --- Program Change ---
const PROGRAM_NAMES = [
  'Virtual Analog VCF', 'Phase Distortion', '6-Op FM I', '6-Op FM II',
  '6-Op FM III', 'Wave Terrain', 'String Machine', 'Chiptune',
  'Virtual Analog', 'Waveshaping', 'FM', 'Grain', 'Additive', 'Wavetable',
  'Chord', 'Speech', 'Swarm', 'Noise', 'Particle', 'String',
  'Modal', 'Bass Drum', 'Snare Drum', 'Hi-Hat',
];

let currentProgram = 0;

function updatePcLabel() {
  pcLabelEl.textContent = currentProgram + 1;
  pcNameEl.textContent  = PROGRAM_NAMES[currentProgram] ?? '';
}

function sendProgramChange(prog) {
  currentProgram = Math.max(0, Math.min(127, prog));
  updatePcLabel();
  if (!selectedOutput) return;
  selectedOutput.send([0xc0 | soundChannel, currentProgram]);
  addLogEntry('Prog Chg', 'pc', `ch${soundChannel + 1}  prog ${currentProgram}`);
}

pcPrevBtn.addEventListener('click', () => sendProgramChange(currentProgram - 1));
pcNextBtn.addEventListener('click', () => sendProgramChange(currentProgram + 1));

// --- Event listeners ---
inSelect.addEventListener('change', () => { bindInput(inSelect.value ? midiAccess.inputs.get(inSelect.value) : null); inSelect.blur(); saveState(); });
outSelect.addEventListener('change', () => { selectedOutput = outSelect.value ? midiAccess.outputs.get(outSelect.value) : null; updateButtons(); outSelect.blur(); saveState(); });
thruToggle.addEventListener('change', () => { midiThru = thruToggle.checked; saveState(); });
clearBtn.addEventListener('click', () => { logEl.innerHTML = '<p class="placeholder">Waiting for MIDI messages...</p>'; });
resetStateBtn.addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); location.reload(); });
sendBtn.addEventListener('click', sendMessage);
[sendChannel, sendByte1, sendByte2].forEach(el => { el.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); }); });
pcPrevBtn.addEventListener('click', saveState);
pcNextBtn.addEventListener('click', saveState);
octDownBtn.addEventListener('click', saveState);
octUpBtn.addEventListener('click', saveState);
sendChannel.addEventListener('change', saveState);

// --- Persistence ---
const STORAGE_KEY = 'wmidi_state';

function saveState() {
  const knobState = {};
  for (const k of allKnobs) {
    knobState[k.id] = { value: k.value, cc: k.cc, channel: k.channel };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    thru:         thruToggle.checked,
    program:      currentProgram,
    octave:       pianoStartNote,
    channel:      sendChannel.value,
    knobs:        knobState,
    preferredIn:  inSelect.value,
    preferredOut: outSelect.value,
    soundPresets:  soundPresets,
    rhythmPresets: rhythmPresets,
  }));
}

function loadState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
  if (!state) return;

  try {
    if (state.thru    !== undefined) { thruToggle.checked = state.thru; midiThru = state.thru; }
    if (state.program !== undefined) { currentProgram = state.program; updatePcLabel(); }
    if (state.octave  !== undefined) pianoStartNote = state.octave;
    if (state.channel !== undefined) sendChannel.value = state.channel;
    if (state.preferredIn)  inSelect.dataset.preferred  = state.preferredIn;
    if (state.preferredOut) outSelect.dataset.preferred = state.preferredOut;

    if (state.knobs) {
      for (const k of allKnobs) {
        const s = state.knobs[k.id];
        if (!s) continue;
        if (s.cc !== undefined && k.cc !== null) {
          k.cc = s.cc;
          const ccIn = k.el.querySelector('.knob-cc-input');
          if (ccIn) ccIn.value = k.cc;
        }
        if (s.channel !== undefined) {
          k.channel = s.channel;
          const chIn = k.el.querySelector('.knob-ch-input');
          if (chIn) chIn.value = k.channel;
        }
        if (s.value !== undefined) {
          k.setValue(s.value, true);
          if (k.id === 'transpose') transposeAmount = k.value;
        }
      }
    }
    if (state.rhythmPresets) {
      state.rhythmPresets.forEach((p, i) => {
        if (rhythmPresets[i]) Object.assign(rhythmPresets[i], p);
      });
      loadRhythmPreset(currentRhythmEngine - 1);
    }

    if (state.soundPresets) {
      state.soundPresets.forEach((p, i) => {
        if (soundPresets[i] && p.rhythmEngine !== undefined) {
          soundPresets[i].rhythmEngine = p.rhythmEngine;
        }
      });
      const engine = soundPresets[currentPreset].rhythmEngine ?? 0;
      document.querySelectorAll('.rhythm-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.rhythm) === engine));
    }
  } catch (err) {
    console.warn('loadState failed, clearing saved state:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}

// --- Sound presets ---
const SOUND_KNOB_IDS = ['harmonics','timbre','morph','lpg_colour','decay','pitch_offset'];
let currentPreset = 0;
let soundChannel  = 1; // 1–6 for buttons, 0 for All (raw MIDI nibble)
// presets[slot][knobId] = value, plus rhythmEngine
const soundPresets = Array.from({ length: 6 }, () => ({ rhythmEngine: 0 }));

function savePreset(slot) {
  for (const id of SOUND_KNOB_IDS) {
    const k = allKnobs.find(k => k.id === id);
    if (k) soundPresets[slot][id] = k.value;
  }
  const active = document.querySelector('.rhythm-btn.active');
  if (active) soundPresets[slot].rhythmEngine = parseInt(active.dataset.rhythm);
}

function loadPreset(slot) {
  for (const id of SOUND_KNOB_IDS) {
    const k = allKnobs.find(k => k.id === id);
    if (k && soundPresets[slot][id] !== undefined) k.setValue(soundPresets[slot][id]);
  }
  const engine = soundPresets[slot].rhythmEngine ?? 0;
  document.querySelectorAll('.rhythm-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.rhythm) === engine));
  if (selectedOutput) {
    selectedOutput.send([0xb0 | soundChannel, 31, engine]);
    addLogEntry('CC', 'cc', `ch${soundChannel}  cc31  val ${engine} (rhythm assign)`);
  }
}

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.preset === 'all') {
      soundChannel = 0;
      for (let i = 0; i < 6; i++) savePreset(i);
      document.querySelectorAll('.preset-btn:not(.preset-btn--all)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveState();
      return;
    }
    const slot = parseInt(btn.dataset.preset);
    savePreset(currentPreset);
    currentPreset = slot;
    soundChannel  = slot + 1; // button 0→ch1, button 1→ch2, etc.
    loadPreset(slot);
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
    saveState();
  });
});

// --- Rhythm presets ---
const RHYTHM_KNOB_IDS = ['x1','y1','chaos1','x2','y2','chaos2'];
let currentRhythmEngine = 1; // 1–6
const rhythmPresets = Array.from({ length: 6 }, () => ({}));

function saveRhythmPreset(slot) {
  for (const id of RHYTHM_KNOB_IDS) {
    const k = allKnobs.find(k => k.id === id);
    if (k) rhythmPresets[slot][id] = k.value;
  }
}

function loadRhythmPreset(slot) {
  for (const id of RHYTHM_KNOB_IDS) {
    const k = allKnobs.find(k => k.id === id);
    if (k && rhythmPresets[slot][id] !== undefined) k.setValue(rhythmPresets[slot][id]);
  }
}

// --- Rhythm engine selector ---
document.querySelectorAll('.rhythm-sel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    saveRhythmPreset(currentRhythmEngine - 1);
    currentRhythmEngine = parseInt(btn.dataset.engine);
    rhythmChannel = currentRhythmEngine;
    loadRhythmPreset(currentRhythmEngine - 1);
    document.querySelectorAll('.rhythm-sel-btn').forEach(b => b.classList.toggle('active', b === btn));
    saveState();
  });
});

// --- Rhythm assign buttons ---
document.querySelectorAll('.rhythm-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const value = parseInt(btn.dataset.rhythm);
    document.querySelectorAll('.rhythm-btn').forEach(b => b.classList.toggle('active', b === btn));
    soundPresets[currentPreset].rhythmEngine = value;
    if (!selectedOutput) return;
    selectedOutput.send([0xb0 | soundChannel, 31, value]);
    addLogEntry('CC', 'cc', `ch${soundChannel}  cc31  val ${value} (rhythm assign)`);
    saveState();
  });
});

// --- Play button ---
document.getElementById('rhythm-play-btn').addEventListener('click', () => {
  if (!selectedOutput) return;
  selectedOutput.send([0xb0 | rhythmChannel, 30, 127]);
  addLogEntry('CC', 'cc', `ch${rhythmChannel}  cc30  val 127 (play)`);
});

// --- Boot ---
try {
  buildKnobs();
  loadState();
  buildPiano();
  initMidi();
} catch (err) {
  console.error('Boot failed:', err);
  statusEl.textContent = 'Boot error: ' + err.message;
  statusEl.className = 'status disconnected';
}
