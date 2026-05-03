'use strict';

import { Knob } from './knob.js';
import { refs, STORAGE_KEY } from './state.js';
import {
  inSelect, outSelect, thruToggle, sendChannel,
  initMidi, setOnProgramChange, setOnHighlightKey, setOnPerformanceDump, setOnOutputChange,
  selectedOutput, addLogEntry, setMidiThru,
} from './devices.js';
import {
  soundChannel, sendTgCC, loadSoundState, onProgramChange,
  getCurrentProgram, getSelectedTg, getPcChannel,
  setOnTgChange, updateTgState, applyPerformanceDump, setPerfDumpBtnEnabled, changeTgMidiCh,
  loadVoiceForTg,
} from './sound.js';
import { loadVoices, populateVoiceSelect, matchVoiceByName, voices } from './voices.js';
import {
  buildPiano, highlightKey,
  getPianoStartNote, setPianoStartNote, setTransposeAmount,
} from './piano.js';

const KNOB_GROUPS = [
  {
    container: 'ctrl-tg',
    isTg: true,
    knobs: [
      { id: 'volume',    label: 'Volume',    cc: 7,  value: 100 },
      { id: 'pan',       label: 'Pan',       cc: 10, value: 64  },
      { id: 'detune',    label: 'Detune',    cc: 94, value: 64  },
      { id: 'reverb',    label: 'Reverb',    cc: 91, value: 64  },
      { id: 'cutoff',    label: 'Cutoff',    cc: 74, value: 127 },
      { id: 'resonance', label: 'Resonance', cc: 71, value: 0   },
      { id: 'midiCh',    label: 'MIDI Ch',   cc: null, value: 1, min: 1, max: 16 },
    ],
  },
  {
    container: 'ctrl-keyboard',
    knobs: [
      { id: 'mod',        label: 'Mod',        cc: 1,    value: 0              },
      { id: 'expression', label: 'Expression', cc: 11,   value: 127            },
      { id: 'porta-time', label: 'Porta Time', cc: 5,    value: 0              },
      { id: 'transpose',  label: 'Transpose',  cc: null, value: 0, min: -24, max: 24 },
    ],
  },
  {
    container: 'ctrl-reverb',
    knobs: [
      { id: 'reverb-size',    label: 'Size',     cc: 80, value: 70 },
      { id: 'reverb-hidamp',  label: 'Hi Damp',  cc: 81, value: 50 },
      { id: 'reverb-lodamp',  label: 'Lo Damp',  cc: 82, value: 50 },
      { id: 'reverb-lowpass', label: 'Low Pass', cc: 83, value: 30 },
      { id: 'reverb-diff',    label: 'Diffusion',cc: 84, value: 65 },
      { id: 'reverb-level',   label: 'Level',    cc: 85, value: 99 },
    ],
  },
];

let allKnobs = [];

function buildKnobs() {
  allKnobs = [];
  for (const group of KNOB_GROUPS) {
    const container = document.getElementById(group.container);
    if (!container) continue;
    for (const def of group.knobs) {
      const knob = new Knob(def);
      knob.onChange = (value, cc, channel) => {
        if (cc === null) {
          if (def.id === 'transpose') setTransposeAmount(value);
          else if (def.id === 'midiCh') changeTgMidiCh(value);
          return;
        }
        if (!selectedOutput) return;
        if (group.isTg) {
          updateTgState(def.id, value);
          sendTgCC(cc, value);
        } else {
          const ch = channel - 1;
          selectedOutput.send([0xb0 | ch, cc, value]);
          addLogEntry('CC', 'cc', `ch${ch + 1}  cc${cc}  val ${value}`);
        }
      };
      container.appendChild(knob.el);
      allKnobs.push(knob);
    }
  }
}

function loadState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
  if (!state) return;
  try {
    if (state.thru !== undefined) { thruToggle.checked = state.thru; setMidiThru(state.thru); }
    if (state.octave   !== undefined) setPianoStartNote(state.octave);
    if (state.channel  !== undefined) sendChannel.value = state.channel;
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
          if (k.id === 'transpose') setTransposeAmount(k.value);
        }
      }
    }
    loadSoundState(state);
  } catch (err) {
    console.warn('loadState failed, clearing saved state:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}

refs.thruToggle        = thruToggle;
refs.sendChannel       = sendChannel;
refs.inSelect          = inSelect;
refs.outSelect         = outSelect;
refs.getCurrentProgram = getCurrentProgram;
refs.getPianoStartNote = getPianoStartNote;
refs.getSelectedTg     = getSelectedTg;
refs.getPcChannel      = getPcChannel;

setOnProgramChange(onProgramChange);
setOnHighlightKey(highlightKey);
setOnOutputChange(has => setPerfDumpBtnEnabled(has));
setOnPerformanceDump(applyPerformanceDump);
const voiceSel = document.getElementById('voice-select');
voiceSel.addEventListener('change', () => {
  const idx = parseInt(voiceSel.value);
  if (!isNaN(idx) && idx >= 0) loadVoiceForTg(idx);
});

setOnTgChange((tg, state) => {
  const knobMap = { volume: 'volume', pan: 'pan', detune: 'detune', reverb: 'reverb', cutoff: 'cutoff', resonance: 'resonance', midiCh: 'midiCh' };
  for (const [id, knobId] of Object.entries(knobMap)) {
    const knob = allKnobs.find(k => k.id === knobId);
    if (knob && state[id] !== undefined) knob.setValue(state[id], true);
  }
  if (voices.length > 0) {
    const allMode = getSelectedTg() === null;
    voiceSel.disabled = allMode;
    if (!allMode) {
      const idx = matchVoiceByName(state.name);
      voiceSel.value = idx >= 0 ? String(idx) : '';
    }
  }
});

const statusEl = document.getElementById('midi-status');
try {
  buildKnobs();
  refs.allKnobs = allKnobs;
  loadState();
  buildPiano();
  initMidi();
} catch (err) {
  console.error('Boot failed:', err);
  statusEl.textContent = 'Boot error: ' + err.message;
  statusEl.className = 'status disconnected';
}

loadVoices().then(() => populateVoiceSelect(voiceSel)).catch(console.warn);
