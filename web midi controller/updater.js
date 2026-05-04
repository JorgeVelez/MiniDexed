import { addLogEntry } from './devices.js';

const CHUNK_RAW = 448; // 7 * 64 → encodes to 512 bytes per SysEx chunk

function encode7bit(raw) {
  const groups  = Math.ceil(raw.length / 7);
  const padded  = new Uint8Array(groups * 7);
  padded.set(raw);
  const encoded = new Uint8Array(groups * 8);
  for (let g = 0; g < groups; g++) {
    let hdr = 0;
    for (let i = 0; i < 7; i++) {
      if (padded[g*7+i] & 0x80) hdr |= (1 << i);
      encoded[g*8+1+i] = padded[g*7+i] & 0x7F;
    }
    encoded[g*8] = hdr;
  }
  return encoded;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function sendKernelUpdate(file, output, onProgress, onStatus) {
  const raw         = new Uint8Array(await file.arrayBuffer());
  const totalChunks = Math.ceil(raw.length / CHUNK_RAW);

  // 28-bit XOR checksum
  let checksum = 0;
  for (const b of raw) checksum = (checksum ^ b) & 0x0FFFFFFF;

  onStatus('Sending start…');
  addLogEntry('OTA', 'sysex',
    `Start → ${totalChunks} chunks, ${raw.length} bytes`, 'out');

  // Start: F0 7D 4D 58 10 [ch_hi ch_lo] [sz0 sz1 sz2 sz3] F7
  output.send([
    0xF0, 0x7D, 0x4D, 0x58, 0x10,
    (totalChunks >> 7) & 0x7F, totalChunks & 0x7F,
     raw.length        & 0x7F, (raw.length >>  7) & 0x7F,
    (raw.length >> 14) & 0x7F, (raw.length >> 21) & 0x7F,
    0xF7,
  ]);

  await delay(300); // give firmware time to allocate buffer

  // Chunks: F0 7D 4D 58 11 [idx_hi idx_lo] [7-bit encoded] F7
  for (let i = 0; i < totalChunks; i++) {
    const slice   = raw.slice(i * CHUNK_RAW, (i + 1) * CHUNK_RAW);
    const encoded = encode7bit(slice);
    output.send([
      0xF0, 0x7D, 0x4D, 0x58, 0x11,
      (i >> 7) & 0x7F, i & 0x7F,
      ...encoded,
      0xF7,
    ]);
    onProgress(i + 1, totalChunks);
    if (i % 64 === 63) await delay(4); // periodic yield
  }

  onStatus('Committing…');
  // Commit: F0 7D 4D 58 12 [cs0 cs1 cs2 cs3] F7
  output.send([
    0xF0, 0x7D, 0x4D, 0x58, 0x12,
     checksum        & 0x7F, (checksum >>  7) & 0x7F,
    (checksum >> 14) & 0x7F, (checksum >> 21) & 0x7F,
    0xF7,
  ]);
  addLogEntry('OTA', 'sysex',
    `Commit → cs=${checksum.toString(16).padStart(7,'0')}`, 'out');
}

export function sendOtaAbort(output) {
  output.send([0xF0, 0x7D, 0x4D, 0x58, 0x13, 0xF7]);
  addLogEntry('OTA', 'sysex', 'Abort →', 'out');
}
