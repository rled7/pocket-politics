// DEPRECATED — the old global "black & white toggle" was a misread of the feature. The real thing
// is the dedicated "Ideas" section (ideas.html), which spotlights only the idea (no person/party).
// This script now just MIGRATES anyone who got stuck in global grayscale: it clears the old flag
// and removes the class, so the app returns to normal color on the next page load.
(() => {
  try { localStorage.removeItem("pp_bw"); } catch (_) {}
  document.body && document.body.classList.remove("bw");
  // Remove any leftover toggle button from a cached older version.
  document.querySelectorAll(".bwtoggle, .bwtoggle-label").forEach(el => el.remove());
})();
