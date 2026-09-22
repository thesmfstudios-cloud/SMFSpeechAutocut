require("dotenv").config();
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");
const { exec } = require("child_process");
const FormData = require("form-data");

let fetchPromise;
async function getFetch() {
  if (!fetchPromise) fetchPromise = import("node-fetch").then((m) => m.default);
  return fetchPromise;
}
const execAsync = util.promisify(exec);

const app = express();
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT || 8934);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || "whisper-1";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini";

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function assertOpenAI() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to server/.env and restart the server.");
  }
}

function parseJsonText(text) {
  const cleaned = String(text || "")
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function normalizeSegments(rawSegments) {
  return (Array.isArray(rawSegments) ? rawSegments : [])
    .map((s, i) => ({
      id: Number.isFinite(s.id) ? s.id : i,
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text || "").trim(),
      speaker: s.speaker || null,
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.text);
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "SMF Speech Highlight Engine",
    stt: OPENAI_API_KEY ? `OpenAI ${OPENAI_STT_MODEL}` : "not configured",
    llm: OPENAI_API_KEY ? `OpenAI ${OPENAI_TEXT_MODEL}` : "not configured",
  });
});

app.post("/transcribe", async (req, res) => {
  const mediaPath = req.body && req.body.path;
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    return fail(res, 400, "Media file not found at given path.");
  }

  try {
    assertOpenAI();

    const tmpAudioPath = path.join(os.tmpdir(), `smf-highlight-${Date.now()}.wav`);
    try {
      await execAsync(`ffmpeg -y -i "${mediaPath}" -vn -ac 1 -ar 16000 "${tmpAudioPath}"`);

      const fetch = await getFetch();
      const form = new FormData();
      form.append("file", fs.createReadStream(tmpAudioPath), {
        filename: path.basename(tmpAudioPath),
        contentType: "audio/wav",
      });
      form.append("model", OPENAI_STT_MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI transcription error: ${bodyText}`);
      }

      const data = JSON.parse(bodyText);
      const segments = normalizeSegments(data.segments);
      if (!segments.length) {
        throw new Error("Transcription returned no timestamped segments.");
      }

      return res.json({
        ok: true,
        language: data.language || null,
        duration: Number(data.duration || segments[segments.length - 1].end),
        text: data.text || segments.map((s) => s.text).join(" "),
        segments,
      });
    } finally {
      fs.unlink(tmpAudioPath, () => {});
    }
  } catch (err) {
    return fail(res, 500, err.message || String(err));
  }
});

app.post("/highlights", async (req, res) => {
  const segments = normalizeSegments(req.body && req.body.segments);
  const targetSeconds = Math.max(45, Math.min(150, Number(req.body && req.body.targetSeconds) || 90));
  if (!segments.length) {
    return fail(res, 400, "No timestamped transcript segments provided.");
  }

  try {
    assertOpenAI();
    const result = await pickHighlightsWithOpenAI(segments, targetSeconds);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return fail(res, 500, err.message || String(err));
  }
});

async function pickHighlightsWithOpenAI(segments, targetSeconds) {
  const transcript = segments
    .map((s, i) => `${i}|${s.start.toFixed(2)}|${s.end.toFixed(2)}|${s.text}`)
    .join("\n");

  const system = `You are an expert event-video editor working on a SINGLE SPEAKER speech. Analyze a timestamped speech transcript and identify candidate cuts for a high-impact 1–2 minute highlight reel.

Rules:
- Return JSON only.
- Candidate cuts must use exact transcript segment boundaries.
- Prefer complete thoughts, not isolated fragments.
- Preserve context: allow a setup sentence before the key point and a short conclusion when needed.
- Avoid greetings, housekeeping, repetition, filler, vague statements and incomplete sentences.
- Prefer concrete insights, strong statements, useful facts, emotional truth, memorable phrasing and conclusions.
- Do not invent words or timestamps.
- Give 6-12 candidates when enough strong material exists.
- Then recommend a coherent 45-150 second combination near the requested target. The recommendation may contain multiple non-adjacent candidate ranges.
- Prefer a natural single-speaker story: Hook -> Context -> Main Point -> Supporting Point -> Conclusion when the transcript supports it.
- Penalize abrupt topic jumps and segments that only make sense with missing context.
- Score candidates 0-100 for reel usefulness.
`;

  const user = `Target final duration: about ${targetSeconds} seconds. This is a single-speaker event speech.

Transcript rows (id|start|end|text):
${transcript}

Return exactly this JSON shape:
{
  "candidates": [
    {"id": 1, "start": 0, "end": 0, "score": 0, "label": "Hook|Context|Main Point|Support|Emotion|Conclusion|Quote", "reason": "short reason"}
  ],
  "recommendation": {
    "candidateIds": [1,2],
    "totalDuration": 0,
    "story": "one short description of the single-speaker narrative flow",
    "reason": "why these parts work together as one coherent 1–2 minute highlight"
  }
}`;

  const fetch = await getFetch();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI highlight error: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = parseJsonText(content);

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const recommendation = parsed.recommendation || { candidateIds: [], totalDuration: 0, story: "", reason: "" };

  const validCandidates = candidates
    .map((c, idx) => {
      const start = Number(c.start);
      const end = Number(c.end);
      return {
        id: Number.isFinite(c.id) ? Number(c.id) : idx + 1,
        start,
        end,
        score: Math.max(0, Math.min(100, Number(c.score) || 0)),
        label: String(c.label || "Highlight"),
        reason: String(c.reason || ""),
      };
    })
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);

  function nearestBoundary(value, pickEnd) {
    if (!segments.length) return value;
    let best = segments[0][pickEnd ? "end" : "start"];
    let bestDist = Math.abs(best - value);
    for (let i = 0; i < segments.length; i++) {
      const v = segments[i][pickEnd ? "end" : "start"];
      const d = Math.abs(v - value);
      if (d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
    return best;
  }

  const normalized = validCandidates.map((c) => ({
    ...c,
    start: nearestBoundary(c.start, false),
    end: nearestBoundary(c.end, true),
  })).filter((c) => c.end > c.start);

  const ids = Array.isArray(recommendation.candidateIds) ? recommendation.candidateIds.map(Number) : [];
  const recommended = ids
    .map((id) => normalized.find((c) => c.id === id))
    .filter(Boolean);

  if (!recommended.length && normalized.length) {
    let total = 0;
    const sorted = normalized.slice().sort((a, b) => b.score - a.score);
    for (const c of sorted) {
      if (total >= targetSeconds * 0.8) break;
      if (total + (c.end - c.start) <= targetSeconds * 1.25) {
        recommended.push(c);
        total += c.end - c.start;
      }
    }
  }

  const totalDuration = recommended.reduce((sum, c) => sum + (c.end - c.start), 0);
  return {
    candidates: normalized.sort((a, b) => b.score - a.score),
    recommendation: {
      candidateIds: recommended.map((c) => c.id),
      totalDuration: Number((totalDuration || Number(recommendation.totalDuration) || 0).toFixed(2)),
      story: String(recommendation.story || ""),
      reason: String(recommendation.reason || ""),
    },
  };
}

app.listen(PORT, () => {
  console.log(`SMF Speech Highlight Engine listening on http://localhost:${PORT}`);
  console.log(`STT: ${OPENAI_API_KEY ? OPENAI_STT_MODEL : "NOT CONFIGURED"}`);
  console.log(`LLM: ${OPENAI_API_KEY ? OPENAI_TEXT_MODEL : "NOT CONFIGURED"}`);
});
