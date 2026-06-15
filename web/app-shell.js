// App shell — wraps the page in a 3-column "HUD" layout on wide screens: a left nav rail (so you
// never page-hop blindly) and a right rail that keeps relevant info ON the page (next in Congress,
// quick actions). The center column is the existing content, untouched. CSS hides the rails below
// 1120px, so mobile stays the simple single column. Include with:
//   <script src="./app-shell.js" defer></script>
(async () => {
  const wrap = document.querySelector(".wrap");
  if (!wrap || document.querySelector(".appshell")) return;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const shell = document.createElement("div");
  shell.className = "appshell";
  const left = document.createElement("aside"); left.className = "rail rail-l";
  const right = document.createElement("aside"); right.className = "rail rail-r";
  wrap.parentNode.insertBefore(shell, wrap);
  shell.append(left, wrap, right);

  const NAV = [
    ["🏛️ My government", "home.html"], ["👥 Browse Congress", "explore.html"], ["📜 Bills", "bills.html"],
    ["💡 Ideas", "ideas.html"], ["📅 Congressional calendar", "calendar.html"], ["💵 Budget & shutdown", "budget.html"],
    ["🛑 Filibuster", "filibuster.html"], ["📣 Events", "events.html"], ["🗺️ Your state", "states.html"], ["🔎 Find officials", "local.html"], ["🗽 New York", "ny.html"],
    ["🇺🇸 Presidents", "presidents.html"], ["⚖️ Justices", "scotus.html"], ["📖 Glossary", "glossary.html"], ["📑 Laws & rules", "regulations.html"],
    ["✊ Take action", "howto.html"], ["🤝 Get help", "assistance.html"], ["🛡️ Defend yourself", "defend.html"],
    ["💳 Pricing", "pricing.html"], ["🧭 Site map", "sitemap.html"],
  ];
  const here = (location.pathname.split("/").pop() || "home.html");
  left.innerHTML = `<div class="rail-sec"><h4>Explore</h4>${NAV.map(([n, h]) =>
    `<a href="./${h}"${h === here ? ' class="on"' : ""}>${n}</a>`).join("")}</div>`;

  right.innerHTML =
    `<div class="rail-sec"><h4>Next in Congress</h4><div id="hud-cal" class="hud meta" style="margin:0">Loading…</div></div>
     <div class="rail-sec"><h4>Quick actions</h4>
       <a href="./home.html">📍 Find my reps</a><a href="./bills.html">📜 Latest bills</a>
       <a href="./states.html">🏛️ My state</a><a href="./filibuster.html">🛑 What got filibustered</a></div>`;

  try {
    const d = await (await fetch("/api/calendar")).json();
    const m = (d.meetings || [])[0];
    const when = m && m.date ? new Date(m.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
    const el = document.getElementById("hud-cal");
    if (el) el.innerHTML = m ? `<b>${esc(m.committee || m.title || "Committee meeting")}</b><br>${esc(when)}` : "No upcoming meetings.";
  } catch (_) { const el = document.getElementById("hud-cal"); if (el) el.textContent = "—"; }
})();
