# SMF Speech Highlight Engine v1.3

Single-speaker AI highlight assistant for Premiere Pro 23.x.

## Current V1.3 workflow

This version supports an **offline import workflow** so the first real test does not need an API key or a local GPU model.

```
20–30 min speech
    ↓
Astra / external AI analysis
    ↓
edit_decisions.json + SRT
    ↓
SMF AutoCut: Import Analysis JSON
    ↓
Show all candidate cuts
    ↓
Preview candidates
    ↓
Show AI recommended 60–120 sec combination
    ↓
Use Recommendation / manual selection
    ↓
Premiere markers
    ↓
Build Premiere highlight sequence
```

The importer understands the Astra-generated `edit_decisions.json` format used by the current speech-analysis package, including:
- candidate IDs such as H01, H02...
- scores expressed either out of 10 or out of 100
- candidate start/end times in seconds
- the `final` array containing the AI-recommended ranges
- `accuracy_note` and `review_flags`

## API mode

The optional local server is still present for future cloud analysis. It is not required for the offline import test.

## Premiere test assumptions

The selected Premiere source clip must correspond to the beginning of the analyzed recording. The imported timestamps are source-media timestamps, not timeline timestamps.

See `QUICK_START.txt` for the test procedure.
