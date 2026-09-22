// importMode.js - Offline analysis-package importer.
// Supports the Astra-generated edit_decisions.json format used by SMF Speech Highlight Engine v1.2.

(function (global) {
  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function safeText(value) {
    return value == null ? "" : String(value);
  }

  function findMatchingCandidate(candidates, item) {
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var distance = Math.abs(num(c.start, 0) - num(item.start, 0)) +
                     Math.abs(num(c.end, 0) - num(item.end, 0));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = c;
      }
    }
    return bestDistance <= 0.25 ? best : null;
  }

  function normalizeAnalysisPackage(data, filename) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid analysis JSON.");
    }

    if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
      throw new Error("This JSON does not contain a candidates array.");
    }

    var candidates = data.candidates.map(function (c, index) {
      var start = num(c.start, NaN);
      var end = num(c.end, NaN);
      if (!isFinite(start) || !isFinite(end) || end <= start) return null;

      return {
        id: c.id != null ? String(c.id) : String(index + 1),
        start: start,
        end: end,
        score: Math.max(0, Math.min(100, (function (raw) { return raw <= 10 ? raw * 10 : raw; })(num(c.score, 0)))),
        label: safeText(c.title || c.label || c.type || "Highlight"),
        reason: safeText(c.reason || ""),
        text: safeText(c.text || ""),
        type: safeText(c.type || "")
      };
    }).filter(Boolean);

    var finalItems = Array.isArray(data.final) ? data.final : [];
    var recommendationIds = [];
    var recommendationSegments = [];
    var nextSynthetic = 1;

    finalItems.forEach(function (item) {
      var start = num(item.start, NaN);
      var end = num(item.end, NaN);
      if (!isFinite(start) || !isFinite(end) || end <= start) return;

      var matched = findMatchingCandidate(candidates, { start: start, end: end });
      if (!matched) {
        matched = {
          id: "FINAL-" + (nextSynthetic++),
          start: start,
          end: end,
          score: 100,
          label: safeText(item.role || "AI Recommendation"),
          reason: "Imported from the AI final recommendation.",
          text: safeText(item.text || ""),
          type: "Final recommendation"
        };
        candidates.push(matched);
      }

      recommendationIds.push(String(matched.id));
      recommendationSegments.push({
        id: String(matched.id),
        start: start,
        end: end,
        role: safeText(item.role || "Highlight"),
        text: safeText(item.text || "")
      });
    });

    var totalDuration = recommendationSegments.reduce(function (sum, item) {
      return sum + (item.end - item.start);
    }, 0);

    var rationale = safeText(data.rationale || "");
    var flags = Array.isArray(data.review_flags) ? data.review_flags.map(safeText) : [];

    return {
      sourceFilename: safeText(filename || "edit_decisions.json"),
      candidates: candidates,
      recommendation: {
        candidateIds: recommendationIds,
        totalDuration: Number(totalDuration.toFixed(2)),
        story: rationale || "AI-selected single-speaker narrative.",
        reason: flags.length
          ? "Review flags exist in the analysis package. Verify candidates before publishing."
          : "Imported from the AI analysis package."
      },
      recommendationSegments: recommendationSegments,
      reviewFlags: flags,
      accuracyNote: safeText(data.accuracy_note || "")
    };
  }

  global.SMFAnalysisImport = {
    normalize: normalizeAnalysisPackage
  };
})(window);
