// Tiny, dependency-free build badge. Include on any page with
//   <script src="./build-tag.js" defer></script>
// It reads the build/version from /api/version and stamps a small footer line, so every
// screen says which build it is. Fails silent on the static (no-backend) flow.
(async () => {
  let tag = "";
  try { const v = await (await fetch("/api/version")).json(); tag = v && v.tag; } catch (_) { /* static serve */ }
  if (!tag) return;
  const el = document.createElement("div");
  el.className = "buildtag";
  el.textContent = "Pocket Politics · " + tag;
  (document.querySelector(".wrap") || document.body).appendChild(el);
})();
