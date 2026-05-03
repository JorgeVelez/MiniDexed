import { addLogEntry } from './devices.js';

export let voices = [];

export async function loadVoices() {
  try {
    voices = await (await fetch('./voices.json')).json();
  } catch {
    console.warn('voices.json not found — no voice library');
  }
}

export function populateVoiceSelect(sel) {
  sel.innerHTML = '';
  if (!voices.length) {
    sel.appendChild(new Option('-- no library --', ''));
    sel.disabled = true;
    return;
  }
  sel.appendChild(new Option('-- voice --', ''));
  for (let i = 0; i < voices.length; i++) {
    sel.appendChild(new Option(voices[i].name, i));
  }
  sel.disabled = false;
}

export function matchVoiceByName(name) {
  const n = (name || '').trim().toLowerCase();
  return voices.findIndex(v => v.name.trim().toLowerCase() === n);
}

export function sendVoiceSysEx(voiceIdx, midiCh1, output) {
  if (!output || voiceIdx < 0 || voiceIdx >= voices.length) return;
  const data = voices[voiceIdx].data.slice(0, 155);
  let cs = 0;
  for (const b of data) cs = (cs + b) & 0x7F;
  cs = (0x80 - cs) & 0x7F;
  const ch = (midiCh1 - 1) & 0x0F;
  output.send([0xF0, 0x43, ch, 0x00, 0x01, 0x1B, ...data, cs, 0xF7]);
  addLogEntry('SysEx', 'sysex', `Voice "${voices[voiceIdx].name}" → ch${midiCh1}`);
}
