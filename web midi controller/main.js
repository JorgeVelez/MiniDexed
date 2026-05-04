'use strict';

import { Knob } from './knob.js';
import { refs, STORAGE_KEY } from './state.js';
import {
  inSelect, outSelect, thruToggle, sendChannel,
  initMidi, setOnProgramChange, setOnHighlightKey, setOnPerformanceDump, setOnOutputChange,
  selectedOutput, addLogEntry, setMidiThru, setOnOtaAck,
} from './devices.js';
import { sendKernelUpdate, sendOtaAbort } from './updater.js';
import { checkAndDownloadKernel, getStoredRepo, saveRepo } from './github_updater.js';
import {
  soundChannel, sendTgCC, loadSoundState, onProgramChange,
  getCurrentProgram, getSelectedTg, getPcChannel,
  setOnTgChange, updateTgState, applyPerformanceDump, setPerfDumpBtnEnabled, changeTgMidiCh,
  loadVoiceForTg, requestVersion,
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
setOnOutputChange(has => {
  setPerfDumpBtnEnabled(has);
  if (has) setTimeout(() => requestVersion(), 500);
  otaFlashBtn.disabled = !has || !otaFileInput.files.length;
  otaCheckBtn.disabled = !has;
});

// ── OTA ──────────────────────────────────────────────────────────────────────
const otaFileInput  = document.getElementById('ota-file');
const otaFlashBtn   = document.getElementById('ota-flash-btn');
const otaAbortBtn   = document.getElementById('ota-abort-btn');
const otaCheckBtn   = document.getElementById('ota-check-btn');
const otaProgress   = document.getElementById('ota-progress');
const otaBar        = document.getElementById('ota-bar');
const otaStatusEl   = document.getElementById('ota-status');
const ghRepoInput   = document.getElementById('gh-repo');

// Restore saved repo
ghRepoInput.value = getStoredRepo();
ghRepoInput.addEventListener('change', () => saveRepo(ghRepoInput.value));

otaFileInput.addEventListener('change', () => {
  otaFlashBtn.disabled = !selectedOutput || !otaFileInput.files.length;
});

setOnOtaAck(status => {
  if (status === 0x02) {
    otaStatusEl.textContent = 'Done — rebooting…';
    otaBar.style.width = '100%';
  } else if (status === 0x7F) {
    otaStatusEl.textContent = 'Error from firmware';
  } else if (status === 0x00) {
    otaStatusEl.textContent = 'Transfer started…';
  }
});

otaFlashBtn.addEventListener('click', async () => {
  const file = otaFileInput.files[0];
  if (!file || !selectedOutput) return;
  otaStatusEl.textContent = '';
  await flashBlob(file);
  otaFlashBtn.disabled = !selectedOutput || !otaFileInput.files.length;
});
async function flashBlob(blob) {
  const hadThru = thruToggle.checked;
  if (hadThru) { thruToggle.checked = false; setMidiThru(false); }

  otaFlashBtn.disabled = true;
  otaCheckBtn.disabled = true;
  otaAbortBtn.style.display = '';
  otaProgress.style.display = 'flex';
  otaBar.style.width = '0%';

  let aborted = false;
  otaAbortBtn.onclick = () => {
    aborted = true;
    sendOtaAbort(selectedOutput);
    otaStatusEl.textContent = 'Aborted';
    otaAbortBtn.style.display = 'none';
    otaCheckBtn.disabled = false;
  };

  try {
    await sendKernelUpdate(
      blob,
      selectedOutput,
      (sent, total) => {
        if (aborted) throw new Error('aborted');
        const pct = Math.round(sent / total * 100);
        otaBar.style.width = pct + '%';
        otaStatusEl.textContent = `${pct}%  (${sent}/${total} chunks)`;
      },
      msg => { otaStatusEl.textContent = msg; }
    );
  } catch (err) {
    if (!aborted) otaStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    if (!aborted) otaAbortBtn.style.display = 'none';
    otaCheckBtn.disabled = !selectedOutput;
    if (hadThru) { thruToggle.checked = true; setMidiThru(true); }
  }
}

otaCheckBtn.addEventListener('click', async () => {
  if (!selectedOutput) return;
  otaCheckBtn.disabled = true;
  otaProgress.style.display = 'flex';
  otaBar.style.width = '0%';
  otaStatusEl.textContent = '';

  const piHash = (() => {
    const fw = document.getElementById('fw-version')?.textContent?.trim();
    if (!fw) return null;
    const parts = fw.split('-');
    return parts[parts.length - 1].toLowerCase() || null;
  })();

  try {
    const result = await checkAndDownloadKernel(
      ghRepoInput.value.trim(),
      piHash,
      msg => { otaStatusEl.textContent = msg; }
    );
    if (result.upToDate) {
      otaStatusEl.textContent = `Up to date (${result.version})`;
      otaCheckBtn.disabled = false;
      return;
    }
    otaStatusEl.textContent = `${result.version} — starting flash…`;
    await flashBlob(result.blob);
  } catch (err) {
    otaStatusEl.textContent = `Error: ${err.message}`;
    otaCheckBtn.disabled = false;
  }
});
// ─────────────────────────────────────────────────────────────────────────────
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
