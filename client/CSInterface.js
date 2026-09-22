/* Minimal CEP CSInterface wrapper used by SMF Speech Highlight Engine.
 * The extension only requires evalScript(), so we keep this dependency intentionally small.
 * Adobe's full CSInterface.js is available from the official CEP-Resources repository.
 */
var EvalScript_ErrMessage = "EvalScript error.";

function CSInterface() {}

CSInterface.prototype.evalScript = function(script, callback) {
  if (typeof callback !== "function") callback = function() {};
  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
    callback(EvalScript_ErrMessage);
    return;
  }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getHostEnvironment = function() {
  if (!window.__adobe_cep__) return null;
  return JSON.parse(window.__adobe_cep__.getHostEnvironment());
};
