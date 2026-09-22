// hostscript.jsx
// Premiere Pro 23.x ExtendScript host functions for the SMF Speech Highlight Engine.
// Keep this file ES3-compatible.

function getMediaPathFromProjectItem(item) {
    try {
        if (item && typeof item.getMediaPath === "function") {
            var p = item.getMediaPath();
            if (p) return p;
        }
    } catch (e) {}
    return null;
}

function findProjectItemByPath(parent, targetPath) {
    if (!parent || !parent.children) return null;
    for (var i = 0; i < parent.children.numItems; i++) {
        var item = parent.children[i];
        var p = getMediaPathFromProjectItem(item);
        if (p && p === targetPath) return item;
        try {
            if (item.children && item.children.numItems > 0) {
                var nested = findProjectItemByPath(item, targetPath);
                if (nested) return nested;
            }
        } catch (e) {}
    }
    return null;
}

function getSelectedClipPath() {
    try {
        var activeSeq = app.project.activeSequence;
        var clipItem = null;

        if (activeSeq && typeof activeSeq.getSelection === "function") {
            try {
                var selected = activeSeq.getSelection();
                if (selected && selected.length > 0) {
                    for (var s = 0; s < selected.length; s++) {
                        if (selected[s] && selected[s].projectItem) {
                            clipItem = selected[s].projectItem;
                            break;
                        }
                    }
                }
            } catch (e1) {}
        }

        if (!clipItem) {
            try {
                if (typeof app.getCurrentProjectViewSelection === "function") {
                    var projectSel = app.getCurrentProjectViewSelection();
                    if (projectSel && projectSel.length > 0) {
                        for (var p = 0; p < projectSel.length; p++) {
                            var pp = getMediaPathFromProjectItem(projectSel[p]);
                            if (pp) {
                                return JSON.stringify({ ok: true, path: pp, name: projectSel[p].name });
                            }
                        }
                    }
                }
            } catch (e2) {}
        }

        if (!clipItem) {
            return JSON.stringify({ ok: false, error: "Select a video clip in the timeline or Project panel." });
        }

        var mediaPath = getMediaPathFromProjectItem(clipItem);
        if (!mediaPath) {
            return JSON.stringify({ ok: false, error: "Could not read the selected clip's media path." });
        }

        return JSON.stringify({ ok: true, path: mediaPath, name: clipItem.name || "Selected Clip" });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function secondsToTicks(seconds) {
    var time = new Time();
    time.seconds = Number(seconds) || 0;
    return String(time.ticks);
}

function addHighlightMarkers(highlightsJson) {
    try {
        var highlights = JSON.parse(highlightsJson);
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ ok: false, error: "No active sequence." });

        var count = 0;
        for (var i = 0; i < highlights.length; i++) {
            var h = highlights[i];
            var marker = seq.markers.createMarker(Number(h.start) || 0);
            marker.name = "AI Highlight " + (i + 1);
            marker.comments = (h.label ? h.label + ": " : "") + (h.reason || "");
            count++;
        }
        return JSON.stringify({ ok: true, count: count });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function previewHighlight(startSeconds, endSeconds) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ ok: false, error: "No active sequence." });

        var start = Number(startSeconds) || 0;
        var end = Number(endSeconds) || start;
        seq.setInPoint(start);
        seq.setOutPoint(end);
        seq.setPlayerPosition(secondsToTicks(start));
        return JSON.stringify({ ok: true, start: start, end: end });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function removeAllTrackItems(seq) {
    var i;
    if (seq.videoTracks) {
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var vc = seq.videoTracks[v].clips;
            for (i = vc.numItems - 1; i >= 0; i--) {
                try { vc[i].remove(false, false); } catch (e1) {}
            }
        }
    }
    if (seq.audioTracks) {
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var ac = seq.audioTracks[a].clips;
            for (i = ac.numItems - 1; i >= 0; i--) {
                try { ac[i].remove(false, false); } catch (e2) {}
            }
        }
    }
}

function buildHighlightSequence(sourceMediaPath, highlightsJson, newSequenceName) {
    try {
        var highlights = JSON.parse(highlightsJson);
        if (!highlights || !highlights.length) {
            return JSON.stringify({ ok: false, error: "No highlight cuts supplied." });
        }

        var proj = app.project;
        var sourceItem = findProjectItemByPath(proj.rootItem, sourceMediaPath);
        if (!sourceItem) {
            return JSON.stringify({ ok: false, error: "Source project item not found in the Premiere project. Make sure the analyzed media is imported." });
        }

        var seqName = newSequenceName || "AI Highlight Reel";
        proj.createNewSequenceFromClips(seqName, [sourceItem]);
        var newSeq = proj.activeSequence;
        if (!newSeq) return JSON.stringify({ ok: false, error: "Premiere did not create the new sequence." });

        removeAllTrackItems(newSeq);

        var insertSeconds = 0;
        var inserted = 0;
        for (var j = 0; j < highlights.length; j++) {
            var h = highlights[j];
            var start = Number(h.start);
            var end = Number(h.end);
            if (!isFinite(start) || !isFinite(end) || end <= start) continue;

            sourceItem.setInPoint(start, 4);
            sourceItem.setOutPoint(end, 4);

            var ok = newSeq.insertClip(sourceItem, secondsToTicks(insertSeconds), 0, 0);
            if (ok !== false) {
                insertSeconds += (end - start);
                inserted++;
            }
        }

        sourceItem.clearInPoint();
        sourceItem.clearOutPoint();

        if (!inserted) {
            return JSON.stringify({ ok: false, error: "Premiere did not insert any highlight clips." });
        }

        return JSON.stringify({ ok: true, sequenceName: newSeq.name, clipCount: inserted, duration: insertSeconds });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}
