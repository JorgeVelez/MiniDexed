import { saveState, STORAGE_KEY } from './state.js';

// --- DOM refs ---
const statusEl      = document.getElementById('midi-status');
export const inSelect    = document.getElementById('midi-in-select');
export const outSelect   = document.getElementById('midi-out-select');
export const thruToggle  = document.getElementById('thru-toggle');
export const sendChannel = document.getElementById('send-channel');
const logEl         = document.getElementById('midi-log');
const clearBtn      = document.getElementById('clear-btn');
const resetStateBtn = document.getElementById('reset-state-btn');
const sendBtn       = document.getElementById('send-btn');
const sendSysex     = document.getElementById('send-sysex');
const sendType      = document.getElementById('send-type');
const sendByte1     = document.getElementById('send-byte1');
const sendByte2     = document.getElementById('send-byte2');
const fieldByte2    = document.getElementById('field-byte2');

export let midiAccess     = null;
export let selectedInput  = null;
export let selectedOutput = null;
export let midiThru       = true;
export function setMidiThru(v) { midiThru = v; }

// Callbacks wired by other modules
let _onProgramChange    = null;
let _onHighlightKey     = null;
let _onPerformanceDump  = null;
export function setOnProgramChange(fn)   { _onProgramChange   = fn; }
export function setOnHighlightKey(fn)    { _onHighlightKey    = fn; }
export function setOnPerformanceDump(fn) { _onPerformanceDump = fn; }

// --- MIDI init ---
export async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus('Web MIDI API not supported', false);
    return;
  }
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
export function populateDevices() {
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
export function bindInput(port) {
  if (selectedInput) selectedInput.onmidimessage = null;
  selectedInput = port || null;
  if (selectedInput) selectedInput.onmidimessage = onMidiMessage;
}

// --- MIDI message handler ---
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function noteName(n) {
  return NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1);
}

function onMidiMessage(e) {
  const [status, byte1, byte2] = e.data;

  if (midiThru && selectedOutput) selectedOutput.send(e.data);

  if (status === 0xf0) {
    // MiniDexed performance dump response: F0 7D 4D 58 01 [...] cs F7
    if (e.data.length >= 7 && e.data[1] === 0x7D && e.data[2] === 0x4D && e.data[3] === 0x58 && e.data[4] === 0x01) {
      if (_onPerformanceDump) _onPerformanceDump(e.data);
      addLogEntry('SysEx', 'sysex', `Performance dump (${e.data.length} bytes)`, 'in');
      return;
    }
    const text = [...e.data].filter(b => b >= 0x20 && b <= 0x7e).map(b => String.fromCharCode(b)).join('').replace(/^[^a-zA-Z0-9\[{(]+/, '');
    addLogEntry('SysEx', 'sysex', text, 'in');
    return;
  }

  const type    = status >> 4;
  const channel = (status & 0x0f) + 1;
  let typeName, dataStr, cssClass;

  switch (type) {
    case 0x9:
      if (byte2 > 0) {
        typeName = 'Note On';  cssClass = 'noteon';
        if (_onHighlightKey) _onHighlightKey(byte1, true);
      } else {
        typeName = 'Note Off'; cssClass = 'noteoff';
        if (_onHighlightKey) _onHighlightKey(byte1, false);
      }
      dataStr = `ch${channel}  ${noteName(byte1)} (${byte1})  vel ${byte2}`;
      break;
    case 0x8:
      typeName = 'Note Off'; cssClass = 'noteoff';
      dataStr  = `ch${channel}  ${noteName(byte1)} (${byte1})  vel ${byte2}`;
      if (_onHighlightKey) _onHighlightKey(byte1, false);
      break;
    case 0xb:
      typeName = 'CC';  cssClass = 'cc';
      dataStr  = `ch${channel}  cc${byte1}  val ${byte2}`;
      break;
    case 0xc:
      typeName = 'Prog Chg'; cssClass = 'pc';
      dataStr  = `ch${channel}  prog ${byte1}`;
      if (_onProgramChange) _onProgramChange(byte1);
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

  addLogEntry(typeName, cssClass, dataStr, 'in');
}

// --- Log filters ---
const logFilters = new Set(['noteon','noteoff','cc','pc','sysex','other','in','out']);

document.querySelectorAll('.log-filter input').forEach(cb => {
  cb.addEventListener('change', () => {
    const filter = cb.dataset.filter;
    if (cb.checked) {
      logFilters.add(filter);
      if (filter === 'noteon') logFilters.add('noteoff');
    } else {
      logFilters.delete(filter);
      if (filter === 'noteon') logFilters.delete('noteoff');
    }
    document.querySelectorAll('.log-entry').forEach(entry => {
      const type = entry.dataset.type;
      const dir  = entry.dataset.dir;
      entry.style.display = (logFilters.has(type) && logFilters.has(dir)) ? '' : 'none';
    });
  });
});

// --- Log ---
export function addLogEntry(typeName, cssClass, dataStr, dir = 'out') {
  const placeholder = logEl.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  const now  = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false }) +
               '.' + String(now.getMilliseconds()).padStart(3,'0');

  const entry = document.createElement('div');
  entry.className = `log-entry ${cssClass}`;
  entry.dataset.type = cssClass;
  entry.dataset.dir  = dir;
  if (!logFilters.has(cssClass) || !logFilters.has(dir)) entry.style.display = 'none';
  const dirMark = dir === 'in' ? '▼' : '▲';
  entry.innerHTML =
    `<span class="log-dir ${dir}">${dirMark}</span>` +
    `<span class="log-time">${time}</span>` +
    `<span class="log-type ${cssClass}">${typeName}</span>` +
    `<span class="log-data">${dataStr}</span>`;

  logEl.prepend(entry);
  while (logEl.children.length > 200) logEl.removeChild(logEl.lastChild);
}

export function logSystem(msg) { addLogEntry('System', 'other', msg); }

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
  const type  = msg[0] >> 4;
  const ch    = (msg[0] & 0x0f) + 1;
  const typeMap = { 0x9: ['Note On','noteon'], 0x8: ['Note Off','noteoff'], 0xb: ['CC','cc'], 0xc: ['Prog Chg','pc'], 0xe: ['Pitch Bend','other'] };
  if (sendType.value === 'sysex') {
    const hex = msg.map(b => b.toString(16).padStart(2, '0')).join(' ');
    addLogEntry('SysEx', 'sysex', hex, 'out');
  } else {
    const [typeName, cssClass] = typeMap[type] ?? ['MSG', 'other'];
    const dataStr = type === 0xb ? `ch${ch}  cc${msg[1]}  val ${msg[2]}`
                  : type === 0xc ? `ch${ch}  prog ${msg[1]}`
                  : type === 0x9 || type === 0x8 ? `ch${ch}  ${noteName(msg[1])} (${msg[1]})  vel ${msg[2] ?? 0}`
                  : msg.map(b => b.toString(16).padStart(2,'0')).join(' ');
    addLogEntry(typeName, cssClass, dataStr, 'out');
  }
}

let _onOutputChange = null;
export function setOnOutputChange(fn) { _onOutputChange = fn; }

export function updateButtons() {
  const has = !!selectedOutput;
  sendBtn.disabled = !has;
  document.getElementById('pc-prev-btn').disabled = !has;
  document.getElementById('pc-next-btn').disabled = !has;
  if (_onOutputChange) _onOutputChange(has);
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

// --- Event listeners ---
inSelect.addEventListener('change', () => { bindInput(inSelect.value ? midiAccess.inputs.get(inSelect.value) : null); inSelect.blur(); saveState(); });
outSelect.addEventListener('change', () => { selectedOutput = outSelect.value ? midiAccess.outputs.get(outSelect.value) : null; updateButtons(); outSelect.blur(); saveState(); });
thruToggle.addEventListener('change', () => { midiThru = thruToggle.checked; saveState(); });
clearBtn.addEventListener('click', () => { logEl.innerHTML = '<p class="placeholder">Waiting for MIDI messages...</p>'; });
resetStateBtn.addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); location.reload(); });
sendBtn.addEventListener('click', sendMessage);
[sendChannel, sendByte1, sendByte2].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); }));
sendChannel.addEventListener('change', saveState);
