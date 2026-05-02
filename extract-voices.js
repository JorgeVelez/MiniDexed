#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const PERF_DIR = path.resolve(__dirname, 'piImage/performance');
const OUT_FILE = path.resolve(__dirname, 'web midi controller/voices.json');

const voices = new Map(); // key = first 155 bytes joined → {name, data}
let perfCount = 0;

for (const file of fs.readdirSync(PERF_DIR).sort()) {
  if (!file.toLowerCase().endsWith('.ini')) continue;
  perfCount++;
  const text = fs.readFileSync(path.join(PERF_DIR, file), 'utf8');

  for (let slot = 1; slot <= 8; slot++) {
    const m = text.match(new RegExp(`^VoiceData${slot}=(.+)$`, 'm'));
    if (!m) continue;

    const bytes = m[1].trim().split(/\s+/).map(s => parseInt(s, 16));
    if (bytes.length < 155) {
      console.warn(`${file} VoiceData${slot}: only ${bytes.length} bytes, skipping`);
      continue;
    }

    // Deduplicate on VCED bytes 0-154 (ignore op_enable at 155)
    const key = bytes.slice(0, 155).join(',');
    if (voices.has(key)) continue;

    // Name at VCED bytes 145-154 (10 ASCII chars)
    let name = '';
    for (let i = 145; i < 155; i++) {
      const c = bytes[i];
      if (c >= 32 && c < 127) name += String.fromCharCode(c);
    }
    name = name.trimEnd() || '(unnamed)';

    voices.set(key, { name, data: bytes.slice(0, 156) });
  }
}

const list = [...voices.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(OUT_FILE, JSON.stringify(list));
console.log(`${perfCount} performances → ${list.length} unique voices → ${OUT_FILE}`);
