export const STORAGE_KEY = 'wmidi_state';

// Refs set by main.js after construction, so modules don't create circular deps
export const refs = {
  allKnobs:          null,
  thruToggle:        null,
  sendChannel:       null,
  inSelect:          null,
  outSelect:         null,
  getCurrentProgram: () => 0,
  getPianoStartNote: () => 48,
  getSelectedTg:     () => 0,
  getPcChannel:      () => 1,
};

export function saveState() {
  const knobState = {};
  for (const k of refs.allKnobs) {
    knobState[k.id] = { value: k.value, cc: k.cc, channel: k.channel };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    thru:           refs.thruToggle.checked,
    octave:         refs.getPianoStartNote(),
    channel:        refs.sendChannel.value,
    knobs:          knobState,
    preferredIn:    refs.inSelect.value,
    preferredOut:   refs.outSelect.value,
    currentProgram: refs.getCurrentProgram(),
    selectedTg:     refs.getSelectedTg(),
    pcChannel:      refs.getPcChannel(),
  }));
}
