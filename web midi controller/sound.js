import { saveState } from './state.js';
import { selectedOutput, addLogEntry } from './devices.js';
import { sendVoiceSysEx, voices } from './voices.js';

const pcPrevBtn   = document.getElementById('pc-prev-btn');
const pcNextBtn   = document.getElementById('pc-next-btn');
const pcLabelEl   = document.getElementById('pc-label');
const pcNameEl    = document.getElementById('pc-name');
const pcChannelEl = document.getElementById('pc-channel');

let currentProgram = 0;
let selectedTg     = 0;      // 0-7 or null (all)
export let soundChannel = 0; // piano.js uses this for note on/off

export function getCurrentProgram() { return currentProgram; }
export function getSelectedTg()     { return selectedTg; }
export function getPcChannel()      { return parseInt(pcChannelEl?.value || 1); }

// Per-TG parameter cache (populated by performance dump)
const tgState = Array.from({ length: 8 }, (_, i) => ({
  volume: 100, pan: 64, detune: 64, cutoff: 127, resonance: 0, reverb: 64, name: '',
  midiCh: i + 1,  // default: TG1→ch1 … TG8→ch8, overwritten by dump
}));

let _onTgChange = null;
export function setOnTgChange(fn) { _onTgChange = fn; }

export function loadVoiceForTg(voiceIdx) {
  if (selectedTg === null || !selectedOutput) return;
  const midiCh1 = tgState[selectedTg].midiCh;
  if (midiCh1 === 0) return;
  sendVoiceSysEx(voiceIdx, midiCh1, selectedOutput);
  if (voices[voiceIdx]) tgState[selectedTg].name = voices[voiceIdx].name;
}

export function changeTgMidiCh(value) {
  if (selectedTg === null || !selectedOutput) return;
  const ch1 = Math.max(1, Math.min(16, Math.round(value)));
  tgState[selectedTg].midiCh = ch1;
  soundChannel = Math.max(0, ch1 - 1);
  selectedOutput.send([0xF0, 0x43, selectedTg & 0x0F, 0x04, 0x01, (ch1 - 1) & 0x0F, 0xF7]);
  addLogEntry('SysEx', 'sysex', `TG${selectedTg + 1} MIDI ch → ${ch1}`);
}

export function updateTgState(id, value) {
  const tg = selectedTg ?? 0;
  if (selectedTg === null) {
    for (let i = 0; i < 8; i++) tgState[i][id] = value;
  } else {
    tgState[tg][id] = value;
  }
}

export function requestPerformanceDump() {
  if (!selectedOutput) return;
  selectedOutput.send([0xF0, 0x7D, 0x4D, 0x58, 0x00, 0xF7]);
  addLogEntry('SysEx', 'sysex', 'Performance dump request →');
}

export function applyPerformanceDump(data) {
  const BYTES_PER_TG = 24;
  for (let tg = 0; tg < 8; tg++) {
    const b = 5 + tg * BYTES_PER_TG;
    if (b + BYTES_PER_TG > data.length - 2) break;
    // dump stores channel 0-indexed (0=ch1…15=ch16); 16=OmniMode, 17=Disabled → map to 1-indexed (0=disabled)
    const rawCh = data[b + 0];
    tgState[tg].midiCh    = rawCh < 16 ? rawCh + 1 : 0;
    tgState[tg].volume    = data[b + 1];
    tgState[tg].pan       = data[b + 2];
    tgState[tg].detune    = data[b + 3];
    tgState[tg].cutoff    = data[b + 4];
    tgState[tg].resonance = data[b + 5];
    tgState[tg].reverb    = data[b + 6];
    let name = '';
    for (let k = 0; k < 10; k++) {
      const c = data[b + 14 + k];
      if (c >= 32 && c < 127) name += String.fromCharCode(c);
    }
    tgState[tg].name = name.trimEnd();
  }
  // update soundChannel for the current TG selection
  if (selectedTg !== null) soundChannel = Math.max(0, tgState[selectedTg].midiCh - 1);
  const tg = selectedTg ?? 0;
  if (_onTgChange) _onTgChange(tg, tgState[tg]);
}

export function updatePcLabel() {
  pcLabelEl.textContent = currentProgram + 1;
  if (pcNameEl) pcNameEl.textContent = '';
}

export function onProgramChange(prog) {
  currentProgram = prog;
  updatePcLabel();
}

function sendProgramChange(prog) {
  currentProgram = Math.max(0, Math.min(127, prog));
  updatePcLabel();
  if (!selectedOutput) return;
  const pcCh = Math.max(0, Math.min(15, (parseInt(pcChannelEl.value) || 1) - 1));
  selectedOutput.send([0xc0 | pcCh, currentProgram]);
  addLogEntry('Prog Chg', 'pc', `ch${pcCh + 1}  perf ${currentProgram + 1}`);
}

pcPrevBtn.addEventListener('click', () => { sendProgramChange(currentProgram - 1); saveState(); });
pcNextBtn.addEventListener('click', () => { sendProgramChange(currentProgram + 1); saveState(); });
if (pcChannelEl) pcChannelEl.addEventListener('change', saveState);

const perfDumpBtn = document.getElementById('perf-dump-btn');
if (perfDumpBtn) perfDumpBtn.addEventListener('click', requestPerformanceDump);

export function setPerfDumpBtnEnabled(enabled) {
  if (perfDumpBtn) perfDumpBtn.disabled = !enabled;
}

// Maps CC numbers to SysEx param IDs for per-TG addressing (bypasses channel routing)
const CC_TO_PARAM = { 7: 0x00, 10: 0x01, 94: 0x02, 74: 0x03, 71: 0x04, 91: 0x05 };

export function sendTgCC(cc, value) {
  if (!selectedOutput) return;
  const param = CC_TO_PARAM[cc];

  if (param !== undefined) {
    // Use SysEx with explicit TG index — works regardless of shared MIDI channels (unison)
    if (selectedTg === null) {
      for (let tg = 0; tg < 8; tg++) {
        selectedOutput.send([0xF0, 0x7D, 0x4D, 0x58, 0x02, tg, param, value, 0xF7]);
      }
      addLogEntry('SysEx', 'sysex', `all TGs  param 0x0${param}  val ${value}`);
    } else {
      selectedOutput.send([0xF0, 0x7D, 0x4D, 0x58, 0x02, selectedTg, param, value, 0xF7]);
      addLogEntry('SysEx', 'sysex', `TG${selectedTg + 1}  param 0x0${param}  val ${value}`);
    }
  } else {
    // Fallback to channel-based CC for any unmapped controls
    if (selectedTg === null) {
      const sent = new Set();
      for (let tg = 0; tg < 8; tg++) {
        const midiCh = tgState[tg].midiCh;
        if (midiCh === 0 || sent.has(midiCh)) continue;
        selectedOutput.send([0xb0 | (midiCh - 1), cc, value]);
        sent.add(midiCh);
      }
    } else {
      const midiCh = tgState[selectedTg].midiCh;
      if (midiCh === 0) return;
      selectedOutput.send([0xb0 | (midiCh - 1), cc, value]);
    }
    addLogEntry('CC', 'cc', `cc${cc}  val ${value}`);
  }
}

document.querySelectorAll('[data-tg]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedTg = btn.dataset.tg === 'all' ? null : parseInt(btn.dataset.tg);
    if (selectedTg === null) {
      soundChannel = Math.max(0, tgState[0].midiCh - 1);
    } else {
      soundChannel = Math.max(0, tgState[selectedTg].midiCh - 1);
    }
    document.querySelectorAll('[data-tg]').forEach(b => b.classList.toggle('active', b === btn));
    const tg = selectedTg ?? 0;
    if (_onTgChange) _onTgChange(tg, tgState[tg]);
    saveState();
  });
});

export function loadSoundState(state) {
  if (state.currentProgram !== undefined) {
    currentProgram = state.currentProgram;
    updatePcLabel();
  }
  if (state.pcChannel !== undefined && pcChannelEl) {
    pcChannelEl.value = state.pcChannel;
  }
  if (state.selectedTg !== undefined) {
    selectedTg   = state.selectedTg;
    soundChannel = selectedTg ?? 0;
    const key = selectedTg === null ? 'all' : String(selectedTg);
    const active = document.querySelector(`[data-tg="${key}"]`);
    document.querySelectorAll('[data-tg]').forEach(b => b.classList.toggle('active', b === active));
  }
}
