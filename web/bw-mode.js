// "Converge on ideas" mode — turn the whole app black & white so people weigh the idea, not the
// party/side. Prototype: a persistent user toggle (bottom-right). Later this can auto-engage when a
// proposal/idea is the focus of the screen. Include with: <script src="./bw-mode.js" defer></script>
(() => {
  const KEY = "pp_bw";
  const apply = on => document.body.classList.toggle("bw", on);
  let on = localStorage.getItem(KEY) === "1";
  function init() {
    apply(on);
    const btn = document.createElement("button");
    btn.className = "bwtoggle"; btn.type = "button"; btn.textContent = "◑";
    btn.setAttribute("aria-label", "Toggle black & white (converge on ideas) mode");
    const tip = document.createElement("div");
    tip.className = "bwtoggle-label";
    tip.textContent = "Black & white — focus on the idea, not the side";
    btn.addEventListener("click", () => { on = !on; apply(on); localStorage.setItem(KEY, on ? "1" : "0"); });
    document.body.appendChild(btn);
    document.body.appendChild(tip);
  }
  if (document.body) init(); else addEventListener("DOMContentLoaded", init);
})();
