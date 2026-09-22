// main.js - SMF Speech Highlight Engine CEP panel.

const SERVER_URL = "http://localhost:8934";
const csInterface = new CSInterface();

const statusEl = document.getElementById("status");
const clipInfoEl = document.getElementById("clipInfo");
const analyzeBtn = document.getElementById("analyzeBtn");
const refreshBtn = document.getElementById("refreshBtn");
const importBtn = document.getElementById("importBtn");
const analysisFileEl = document.getElementById("analysisFile");
const packageSectionEl = document.getElementById("packageSection");
const packageNameEl = document.getElementById("packageName");
const packageNoteEl = document.getElementById("packageNote");
const recommendationRangesEl = document.getElementById("recommendationRanges");
const flagsSectionEl = document.getElementById("flagsSection");
const flagsListEl = document.getElementById("flagsList");
const targetDurationEl = document.getElementById("targetDuration");
const candidateListEl = document.getElementById("candidateList");
const candidateCountEl = document.getElementById("candidateCount");
const selectionActionsEl = document.getElementById("selectionActions");
const recommendationSectionEl = document.getElementById("recommendationSection");
const recommendationDurationEl = document.getElementById("recommendationDuration");
const recommendationStoryEl = document.getElementById("recommendationStory");
const recommendationReasonEl = document.getElementById("recommendationReason");
const useRecommendationBtn = document.getElementById("useRecommendationBtn");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const useSelectedBtn = document.getElementById("useSelectedBtn");
const finalSectionEl = document.getElementById("finalSection");
const finalDurationEl = document.getElementById("finalDuration");
const finalSummaryEl = document.getElementById("finalSummary");
const markersBtn = document.getElementById("markersBtn");
const assembleBtn = document.getElementById("assembleBtn");
const clearFinalBtn = document.getElementById("clearFinalBtn");

let currentClip = null;
let currentCandidates = [];
let currentRecommendation = { candidateIds: [], totalDuration: 0, story: "", reason: "" };
let finalHighlights = [];

function setStatus(msg) { statusEl.textContent = msg; }

function evalScript(fn, args) {
  return new Promise((resolve) => {
    const call = args !== undefined ? `${fn}(${args})` : `${fn}()`;
    csInterface.evalScript(call, (result) => resolve(result));
  });
}

async function refreshSelectedClip() {
  const raw = await evalScript("getSelectedClipPath");
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ok) {
      currentClip = { path: parsed.path, name: parsed.name };
      clipInfoEl.textContent = `Selected: ${parsed.name}`;
      analyzeBtn.disabled = false;
      setStatus("Ready to analyze.");
    } else {
      currentClip = null;
      clipInfoEl.textContent = parsed.error || "No clip found.";
      analyzeBtn.disabled = true;
    }
  } catch (e) {
    currentClip = null;
    clipInfoEl.textContent = "Could not read selection from Premiere.";
    analyzeBtn.disabled = true;
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str || "");
  return div.innerHTML;
}

function getSelectedCandidates() {
  return currentCandidates.filter((_, i) => {
    const el = document.getElementById(`candidate-${i}`);
    return el && el.checked;
  });
}

function renderFlags(flags) {
  if (!flags || !flags.length) {
    flagsSectionEl.style.display = "none";
    return;
  }
  flagsListEl.innerHTML = "";
  flags.forEach((flag) => {
    const row = document.createElement("div");
    row.className = "flag";
    row.textContent = flag;
    flagsListEl.appendChild(row);
  });
  flagsSectionEl.style.display = "block";
}

function importAnalysisData(data, filename) {
  const imported = SMFAnalysisImport.normalize(data, filename);
  currentCandidates = imported.candidates;
  currentRecommendation = imported.recommendation;
  currentRecommendation.segments = imported.recommendationSegments || [];

  packageSectionEl.style.display = "block";
  packageNameEl.textContent = imported.sourceFilename;
  packageNoteEl.textContent = imported.accuracyNote || "Imported AI analysis package.";

  renderCandidates();
  renderRecommendation();
  renderFlags(imported.reviewFlags);

  if (currentRecommendation.candidateIds.length) {
    setStatus("Imported " + currentCandidates.length + " candidate cuts. AI recommendation: " + formatTime(currentRecommendation.totalDuration) + ".");
  } else {
    setStatus("Imported " + currentCandidates.length + " candidate cuts. No final recommendation found.");
  }
}

function renderCandidates() {
  candidateListEl.innerHTML = "";
  candidateCountEl.textContent = `${currentCandidates.length} found`;

  if (!currentCandidates.length) {
    candidateListEl.innerHTML = '<div class="empty">No strong candidate cuts were returned.</div>';
    selectionActionsEl.style.display = "none";
    return;
  }

  const recIds = new Set((currentRecommendation.candidateIds || []).map(String));

  currentCandidates.forEach((h, i) => {
    const div = document.createElement("div");
    div.className = `candidate${recIds.has(String(h.id)) ? " recommended" : ""}`;
    div.innerHTML = `
      <div class="candidate-head">
        <input type="checkbox" id="candidate-${i}" />
        <label for="candidate-${i}">
          <span class="time">#${escapeHtml(h.id)} · ${formatTime(h.start)} → ${formatTime(h.end)}</span>
          <span class="label"> ${escapeHtml(h.label || "Highlight")}</span>
        </label>
        <span class="score">${Math.round(h.score || 0)}/100</span>
        <button class="secondary preview-btn" data-index="${i}" style="padding:4px 7px;">Preview</button>
      </div>
      <div class="reason">${escapeHtml(h.reason || "")}</div>
    `;
    candidateListEl.appendChild(div);
    const previewBtn = div.querySelector('.preview-btn');
    previewBtn.addEventListener('click', async () => {
      setStatus(`Moving Premiere to ${formatTime(h.start)}…`);
      try {
        const result = await evalScript("previewHighlight", `${Number(h.start)}, ${Number(h.end)}`);
        const parsed = JSON.parse(result);
        setStatus(parsed.ok ? `Preview range set: ${formatTime(h.start)} → ${formatTime(h.end)}. Press Play in Premiere.` : `Preview issue: ${parsed.error}`);
      } catch (e) {
        setStatus(`Preview issue: ${e.message}`);
      }
    });
  });

  selectionActionsEl.style.display = "flex";
}

function renderRecommendation() {
  const rec = currentRecommendation || {};
  if (!rec.candidateIds || !rec.candidateIds.length) {
    recommendationSectionEl.style.display = "none";
    return;
  }
  recommendationSectionEl.style.display = "block";
  recommendationDurationEl.textContent = formatTime(rec.totalDuration);
  recommendationStoryEl.textContent = rec.story || "AI selected a coherent combination of strong moments.";
  if (recommendationRangesEl) {
    recommendationRangesEl.textContent = (rec.segments || [])
      .map((s) => formatTime(s.start) + " → " + formatTime(s.end) + (s.role ? " [" + s.role + "]" : ""))
      .join("  •  ");
  }
  recommendationReasonEl.textContent = rec.reason || "Chosen for context, impact and narrative flow.";
}

function setFinalHighlights(list, sourceLabel) {
  finalHighlights = (list || [])
    .filter((h) => Number.isFinite(Number(h.start)) && Number.isFinite(Number(h.end)) && Number(h.end) > Number(h.start))
    .map((h) => ({
      start: Number(h.start),
      end: Number(h.end),
      reason: h.reason || h.label || "Highlight",
      score: Number(h.score || 0),
      label: h.label || "Highlight",
    }));

  const total = finalHighlights.reduce((sum, h) => sum + h.end - h.start, 0);
  if (!finalHighlights.length) {
    finalSectionEl.style.display = "none";
    return;
  }
  finalSectionEl.style.display = "block";
  finalDurationEl.textContent = formatTime(total);
  finalSummaryEl.textContent = `${finalHighlights.length} cuts • ${sourceLabel || "selection"}`;
}

function findByIds(ids) {
  const byId = new Map(currentCandidates.map((c) => [String(c.id), c]));
  return (ids || []).map(String).map((id) => byId.get(id)).filter(Boolean);
}

importBtn.addEventListener("click", () => analysisFileEl.click());

analysisFileEl.addEventListener("change", () => {
  const file = analysisFileEl.files && analysisFileEl.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ""));
      importAnalysisData(data, file.name);
    } catch (err) {
      setStatus("Import error: " + escapeHtml(err.message));
    }
  };
  reader.onerror = () => setStatus("Could not read the analysis JSON file.");
  reader.readAsText(file, "utf-8");
});

refreshBtn.addEventListener("click", refreshSelectedClip);

analyzeBtn.addEventListener("click", async () => {
  if (!currentClip) return;
  analyzeBtn.disabled = true;
  recommendationSectionEl.style.display = "none";
  finalSectionEl.style.display = "none";
  setStatus("Extracting audio and creating timestamped transcript...");

  try {
    const transcribeRes = await fetch(`${SERVER_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentClip.path }),
    });
    const transcribeData = await transcribeRes.json();
    if (!transcribeData.ok) throw new Error(transcribeData.error || "Transcription failed.");

    setStatus("AI is finding candidate highlights and building a recommendation...");
    const targetSeconds = Number(targetDurationEl.value);
    const highlightsRes = await fetch(`${SERVER_URL}/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: transcribeData.segments, targetSeconds }),
    });
    const highlightsData = await highlightsRes.json();
    if (!highlightsData.ok) throw new Error(highlightsData.error || "Highlight detection failed.");

    currentCandidates = highlightsData.candidates || [];
    currentRecommendation = highlightsData.recommendation || { candidateIds: [], totalDuration: 0, story: "", reason: "" };
    renderCandidates();
    renderRecommendation();

    setStatus(`Found ${currentCandidates.length} candidate cuts. Review the AI recommendation above or choose manually.`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    analyzeBtn.disabled = false;
  }
});

useRecommendationBtn.addEventListener("click", () => {
  const selected = findByIds(currentRecommendation.candidateIds);
  setFinalHighlights(selected, "AI recommendation");
  currentCandidates.forEach((_, i) => {
    const el = document.getElementById(`candidate-${i}`);
    if (el) el.checked = currentRecommendation.candidateIds.map(String).includes(String(currentCandidates[i].id));
  });
  setStatus(`AI recommendation loaded: ${formatTime(currentRecommendation.totalDuration)}.`);
});

selectAllBtn.addEventListener("click", () => {
  currentCandidates.forEach((_, i) => {
    const el = document.getElementById(`candidate-${i}`);
    if (el) el.checked = true;
  });
});

clearSelectionBtn.addEventListener("click", () => {
  currentCandidates.forEach((_, i) => {
    const el = document.getElementById(`candidate-${i}`);
    if (el) el.checked = false;
  });
});

useSelectedBtn.addEventListener("click", () => {
  const selected = getSelectedCandidates().sort((a, b) => a.start - b.start);
  if (!selected.length) {
    setStatus("Select at least one candidate cut first.");
    return;
  }
  setFinalHighlights(selected, "manual selection");
  const total = selected.reduce((sum, h) => sum + h.end - h.start, 0);
  setStatus(`Manual selection loaded: ${formatTime(total)}.`);
});

markersBtn.addEventListener("click", async () => {
  if (!finalHighlights.length) return;
  setStatus("Adding highlight markers to the active sequence...");
  try {
    const result = await evalScript("addHighlightMarkers", JSON.stringify(JSON.stringify(finalHighlights)));
    const parsed = JSON.parse(result);
    setStatus(parsed.ok ? `Added ${parsed.count} highlight markers.` : `Error: ${parsed.error}`);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

assembleBtn.addEventListener("click", async () => {
  if (!currentClip || !finalHighlights.length) return;
  setStatus("Building Premiere highlight sequence...");
  assembleBtn.disabled = true;
  try {
    const seqName = `${stripExtension(currentClip.name)}_AI_Highlight`;
    const args = `${JSON.stringify(currentClip.path)}, ${JSON.stringify(JSON.stringify(finalHighlights))}, ${JSON.stringify(seqName)}`;
    const result = await evalScript("buildHighlightSequence", args);
    const parsed = JSON.parse(result);
    setStatus(parsed.ok ? `Built ${parsed.sequenceName} with ${parsed.clipCount} cuts.` : `Sequence build issue: ${parsed.error}`);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  } finally {
    assembleBtn.disabled = false;
  }
});

clearFinalBtn.addEventListener("click", () => {
  finalHighlights = [];
  finalSectionEl.style.display = "none";
  setStatus("Final selection cleared.");
});

function stripExtension(name) {
  return String(name || "Highlight").replace(/.[^/.]+$/, "");
}

refreshSelectedClip();
