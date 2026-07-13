/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
