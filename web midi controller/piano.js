import { selectedOutput, addLogEntry, noteName } from './devices.js';
import { soundChannel } from './sound.js';

const octDownBtn    = document.getElementById('oct-down-btn');
const octUpBtn      = document.getElementById('oct-up-btn');
const pianoRangeLbl = document.getElementById('piano-range-label');

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

export let pianoStartNote = 48;
export function setPianoStartNote(v) { pianoStartNote = v; }
const activeNotes = new Map();
let mouseHeldNote = null;
let transposeAmount = 0;
export function setTransposeAmount(v) { transposeAmount = v; }
export function getPianoStartNote() { return pianoStartNote; }

export function buildPiano() {
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

export function noteOn(note, _source) {
  if (activeNotes.has(note)) return;
  activeNotes.set(note, _source);
  highlightKey(note, true);
  if (!selectedOutput) return;
  const ch = soundChannel;
  const midiNote = Math.max(0, Math.min(127, note + transposeAmount));
  selectedOutput.send([0x90 | ch, midiNote, 100]);
  addLogEntry('Note On', 'noteon', `ch${ch + 1}  ${noteName(midiNote)} (${midiNote})  vel 100`);
}

export function noteOff(note, _source) {
  if (!activeNotes.has(note)) return;
  activeNotes.delete(note);
  highlightKey(note, false);
  if (!selectedOutput) return;
  const ch = soundChannel;
  const midiNote = Math.max(0, Math.min(127, note + transposeAmount));
  selectedOutput.send([0x80 | ch, midiNote, 0]);
  addLogEntry('Note Off', 'noteoff', `ch${ch + 1}  ${noteName(midiNote)} (${midiNote})  vel 0`);
}

export function releaseAllNotes() {
  for (const note of [...activeNotes.keys()]) noteOff(note, activeNotes.get(note));
  mouseHeldNote = null;
}

export function highlightKey(note, on) {
  const key = document.querySelector(`.key[data-note="${note}"]`);
  if (key) key.classList.toggle('active', on);
}

octDownBtn.addEventListener('click', () => { releaseAllNotes(); pianoStartNote = Math.max(OCT_MIN, pianoStartNote - 12); buildPiano(); });
octUpBtn.addEventListener('click',   () => { releaseAllNotes(); pianoStartNote = Math.min(OCT_MAX, pianoStartNote + 12); buildPiano(); });
