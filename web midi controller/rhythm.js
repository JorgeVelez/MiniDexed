import { saveState } from './state.js';
import { selectedOutput, addLogEntry } from './devices.js';
import { soundChannel } from './sound.js';

export let rhythmChannel = 1;

// --- Rhythm presets ---
const RHYTHM_KNOB_IDS = ['x1','y1','chaos1','density1','density2','density3'];
let currentRhythmEngine = 1;
export const rhythmPresets = Array.from({ length: 6 }, () => ({}));

let _allKnobs = null;
export function setAllKnobs(knobs) { _allKnobs = knobs; }

function saveRhythmPreset(slot) {
  for (const id of RHYTHM_KNOB_IDS) {
    const k = _allKnobs.find(k => k.id === id);
    if (k) rhythmPresets[slot][id] = k.value;
  }
}

function loadRhythmPreset(slot) {
  for (const id of RHYTHM_KNOB_IDS) {
    const k = _allKnobs.find(k => k.id === id);
    if (k && rhythmPresets[slot][id] !== undefined) k.setValue(rhythmPresets[slot][id]);
  }
}

// --- Bank selector ---
document.querySelectorAll('.rhythm-bank-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const value = parseInt(btn.dataset.bank);
    document.querySelectorAll('.rhythm-bank-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (!selectedOutput) return;
    selectedOutput.send([0xb0 | rhythmChannel, 71, value]);
    addLogEntry('CC', 'cc', `ch${rhythmChannel + 1}  cc71  val ${value} (bank)`);
  });
});

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

// --- Output selector ---
document.querySelectorAll('.output-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const output = parseInt(btn.dataset.output);
    const value  = (currentRhythmEngine - 1) * 4 + (output - 1);
    if (!selectedOutput) return;
    selectedOutput.send([0xb0 | soundChannel, 31, value]);
    addLogEntry('CC', 'cc', `ch${soundChannel}  cc31  val ${value} (engine ${currentRhythmEngine} out ${output})`);
  });
});

// --- Play button ---
document.getElementById('rhythm-play-btn').addEventListener('click', () => {
  if (!selectedOutput) return;
  selectedOutput.send([0xb0 | rhythmChannel, 30, 127]);
  addLogEntry('CC', 'cc', `ch${rhythmChannel}  cc30  val 127 (play)`);
});

// --- Load state ---
export function loadRhythmState(state) {
  if (!state.rhythmPresets) return;
  state.rhythmPresets.forEach((p, i) => {
    if (rhythmPresets[i]) Object.assign(rhythmPresets[i], p);
  });
  loadRhythmPreset(currentRhythmEngine - 1);
}
