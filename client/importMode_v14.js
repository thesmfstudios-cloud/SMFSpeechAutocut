// SMF AutoCut v1.4 - cache-busted importer
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

    // Support both the original internal "final" format and Astra's
    // "recommended_highlight.sections" format.
    var finalItems = Array.isArray(data.final) ? data.final : [];
    if (!finalItems.length && data.recommended_highlight && Array.isArray(data.recommended_highlight.sections)) {
      finalItems = data.recommended_highlight.sections.map(function (item) {
        return {
          start: item.start,
          end: item.end,
          role: item.role || "Highlight"
        };
      });
    }

    var recommendationIds = [];
    var recommendationSegments = [];
    var nextSynthetic = 1;

    finalItems.forEach(function (item) {
      var start = num(item.start, NaN);
      var end = num(item.end, NaN);
      if (!isFinite(start) || !isFinite(end) || end <= start) return;

      var matched = findMatchingCandidate(candidates, { start: start, end: end });

      // Astra's final section can be a sub-range of a candidate (for example,
      // a hook/context slice inside a larger candidate). In that case create a
      // synthetic final segment so the exact recommended timestamps are preserved.
      if (!matched || Math.abs(matched.start - start) > 0.25 || Math.abs(matched.end - end) > 0.25) {
        matched = {
          id: "FINAL-" + (nextSynthetic++),
          start: start,
          end: end,
          score: 100,
          label: safeText(item.role || "AI Recommendation"),
          reason: "Exact segment imported from the AI final recommendation.",
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
    if (!rationale && data.recommended_highlight && Array.isArray(data.recommended_highlight.story_shape)) {
      rationale = data.recommended_highlight.story_shape.join(" → ");
    }
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
