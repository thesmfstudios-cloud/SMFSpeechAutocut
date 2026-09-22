# SMF Speech Highlight Engine v1.2 — Single Speaker Test

A practical AI editor assistant for long event speeches.

## What this version does

This build is intentionally scoped to **one speaker speech at a time**. Start with one 20–30 minute speech and generate a 1–2 minute highlight before adding multi-speaker event logic.

1. Select a source video clip in Premiere Pro.
2. The extension uses local FFmpeg only to extract audio.
3. Cloud speech-to-text creates timestamped transcript segments.
4. Cloud AI finds all strong candidate moments.
5. The panel shows every candidate cut with score, label, reason and exact time.
6. AI recommends a coherent 45–150 second combination for the target duration.
7. You can accept the AI recommendation or manually choose the cuts.
8. The extension can add markers and attempt to build a new highlight sequence.

## Key design choice

No local Whisper or Ollama model is required. This avoids heavy CPU/GPU usage on the editing PC. Premiere, CEP, FFmpeg and the small Node server remain local; transcription and editorial reasoning happen through the configured cloud API.

## Run

See `QUICK_START.txt` for setup and Premiere Pro 23.1 test steps.
