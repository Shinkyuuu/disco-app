import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const { DEEPGRAM_API_KEY } = process.env;

function mostRecentRecording() {
  const dir = 'recordings';
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => path.join(dir, f));
  if (files.length === 0) {
    throw new Error('No .wav files found in recordings/. Pass a file path as an argument.');
  }
  return files
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
}

const filePath = process.argv[2] ?? mostRecentRecording();
console.log(`Transcribing ${filePath}...`);

const audio = fs.readFileSync(filePath);

const response = await fetch('https://api.deepgram.com/v1/listen', {
  method: 'POST',
  headers: {
    Authorization: `Token ${DEEPGRAM_API_KEY}`,
    'Content-Type': 'audio/wav',
  },
  body: audio,
});

if (!response.ok) {
  throw new Error(`Deepgram request failed: ${response.status} ${await response.text()}`);
}

const result = await response.json();
const transcript = result.results.channels[0].alternatives[0].transcript;
console.log('Transcript:', transcript);
