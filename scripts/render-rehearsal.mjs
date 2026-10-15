// Renders public/demo/harbourside-call.m4a from src/lib/demo/call-rehearsal.ts with macOS `say` + `afconvert`.
// Placeholder until the team records the real rehearsal (save it as public/demo/harbourside-call.mp3 — preferred).
// Usage: node scripts/render-rehearsal.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REHEARSAL_TURNS } from "../src/lib/demo/call-rehearsal.ts";

const RATE = 22050;
const voices = { agent: "Daniel", customer: "Karen" };
const dir = mkdtempSync(path.join(tmpdir(), "kc-rehearsal-"));
const silence = Buffer.alloc(RATE * 2 * 0.6); // 0.6 s gap, 16-bit mono
const chunks = [];
REHEARSAL_TURNS.forEach((t, i) => {
  const file = path.join(dir, `${i}.wav`);
  execFileSync("say", ["-v", voices[t.speaker], "-r", "185", "--data-format=LEI16@22050", "-o", file, t.text]);
  const wav = readFileSync(file);
  const dataAt = wav.indexOf("data") + 8; // skip RIFF/fmt chunks
  chunks.push(wav.subarray(dataAt), silence);
});
const pcm = Buffer.concat(chunks);
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
const wavPath = path.join(dir, "call.wav");
writeFileSync(wavPath, Buffer.concat([header, pcm]));
const out = path.join("public", "demo", "harbourside-call.m4a");
execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, out]);
console.log(`wrote ${out} (${(pcm.length / RATE / 2).toFixed(1)} s)`);
