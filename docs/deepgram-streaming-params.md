# Deepgram Live Streaming - Tunable Parameters

Reference for tuning transcription behavior on the live streaming endpoint used
in `index.js`. These are query-string params appended to the WebSocket URL:

```js
const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2';
```

To add/change a param, extend the query string, e.g.:

```js
const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3';
```

`encoding`, `sample_rate`, and `channels` must stay matched to what the audio
pipeline actually produces (48kHz stereo linear16, from the `prism.opus.Decoder`
config) - don't change these independently of the decoder settings.

## Accuracy-related parameters

| Param | What it does | Default | Notes |
|---|---|---|---|
| `endpointing` | Milliseconds of silence before Deepgram finalizes the current phrase and starts fresh on the next one | `10` | Very aggressive at default - fast/mumbled speech can have brief amplitude dips (plosives, quick breaths) that trip this, prematurely finalizing mid-sentence and losing context. Try `300`–`500` if fast speech is transcribed poorly. |
| `model` | Which Deepgram model to use (`nova-3`, `nova-2`, etc.) | unspecified/implicit | Worth pinning explicitly so you know exactly what you're testing rather than relying on whatever Deepgram defaults to. |
| `language` | Language/locale hint (e.g. `en-US`) | `en` | Only matters if you have a strong regional accent not well covered by generic `en`. |
| `utterance_end_ms` | Separate "utterance ended" signal based on word timing gaps | unset | Alternative/complement to `endpointing` for detecting sentence boundaries. |

## Readability parameters (not accuracy)

| Param | What it does | Default |
|---|---|---|
| `smart_format` | Formats numbers, dates, etc. as spoken (e.g. "five dollars" → "$5") | `false` |
| `punctuate` | Adds punctuation to the transcript | `false` |
| `numerals` | Converts spoken numbers to digits | `false` |

## UX / latency parameters (Part 7 territory, not accuracy)

| Param | What it does | Default |
|---|---|---|
| `interim_results` | Sends provisional (non-final) transcript updates as audio arrives, before the phrase is finalized | `false` |
| `vad_events` | Sends explicit speech-start/speech-end events over the socket | `false` |

## Not currently relevant to this project

| Param | What it does | Why not relevant |
|---|---|---|
| `multichannel` | Transcribes each audio channel separately | Our 2 channels are just stereo copies from Discord's decoded PCM, not separate speakers - per-speaker separation already happens via one Deepgram connection per Discord user (per-SSRC subscription), not via this flag. |
| `diarize` / `diarize_model` | Deepgram's own speaker-diarization on a single mixed stream | Not needed - attribution comes from Discord's per-user audio streams instead (see system design §4, "Multi-speaker attribution"). |

## Sources

- https://developers.deepgram.com/docs/endpointing
- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
