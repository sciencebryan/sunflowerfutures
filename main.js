import { $ } from "./dom.js";
import { catchUp, endDayNow } from "./day.js";
import { closeSheet, openSheet } from "./sheets.js";
import { store } from "./store.js";
import { S, migrate, setS } from "./state.js";
import { dismissOffline, openFounding } from "./founding.js";
import { DAY_MS } from "./data-economy.js";
import { renderAll } from "./render.js";
import { clamp } from "./helpers.js";
import { db } from "./db.js";
import { initDebugTab } from "./debug.js";









/* ================= tabs, timer, boot ================= */
/* the eight tabs. Built from JS at load so index.html needs no edit:
   the nav is rewritten in place, and any missing <section> (tab-food)
   is created next to its siblings. */
const TABS=[["village","Village"],["food","Food"],["power","Power"],["water","Water"],["works","Works"],["people","People"],["beyond","Beyond"],["journal","Journal"]];
(function buildNav(){
  const nav=document.querySelector("nav");
  nav.innerHTML = TABS.map(([id,label])=>
    `<button data-tab="${id}"${id==="village"?' class="on"':''}>${label}${id==="village"?'<span id="evdot" style="display:none" class="evdot"></span>':''}</button>`
  ).join("");
  const main=document.querySelector("main");
  for(const [id] of TABS){
    if(!document.getElementById("tab-"+id)){
      const sec=document.createElement("section");
      sec.id="tab-"+id; sec.style.display="none";
      main.appendChild(sec);
    }
  }
  document.querySelectorAll("nav button").forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll("nav button").forEach(x=>x.classList.remove("on"));
      b.classList.add("on");
      TABS.forEach(([t])=>{const el=$("tab-"+t); if(el) el.style.display = b.dataset.tab===t?"":"none";});
      const dbg=$("tab-debug"); if(dbg && b.dataset.tab!=="debug") dbg.style.display="none";
    };
  });
})();

$("endDayBtn").onclick=endDayNow;
$("resetBtn").onclick=()=>{
  openSheet(`<h3>Start the village over?</h3>
    <div class="sub">The journal and everything in it will be lost. There is no getting it back.</div>
    <button class="confirm" id="resetYes" style="background:var(--rust)">Yes — start over</button>
    <button class="opt" id="resetNo" style="justify-content:center;margin-top:7px"><span class="l1">Keep going</span></button>`);
  $("resetYes").onclick=async()=>{
    await store.clear(); setS(null);
    closeSheet(); openFounding();
  };
  $("resetNo").onclick=closeSheet;
};

// keep the sticky nav pinned directly under the header, whatever height it is
function syncNavTop(){
  const hdr=document.querySelector("header");
  if(hdr && document.documentElement) document.documentElement.style.setProperty("--navtop", hdr.offsetHeight+"px");
}
window.addEventListener("resize", syncNavTop);
window.addEventListener("orientationchange", syncNavTop);

// minimize the header once you've scrolled down; restore near the top.
// two thresholds so it doesn't flicker at the boundary.
(function(){
  const hdr=document.querySelector("header");
  let mini=false;
  function onScroll(){
    const y=window.scrollY||0;
    if(!mini && y>90){ mini=true; hdr.classList.add("mini"); syncNavTop(); }
    else if(mini && y<30){ mini=false; hdr.classList.remove("mini"); syncNavTop(); }
  }
  window.addEventListener("scroll", onScroll, {passive:true});
})();

setInterval(()=>{
  if(!S) return;
  syncNavTop();
  
  const frac = (Date.now() - S.lastTick) / DAY_MS;
  
  if(frac >= 1){ 
    const n = catchUp(); 
    if(n > 0){ store.save(S); renderAll(); } 
  }
  
  // 1. Calculate the percentage of the day passed
  const pct = clamp(frac * 100, 0, 100);
  
  // 2. Determine the solid sky color based on the current percentage
  let color = "#111625"; // Default Night
  if (pct < 8) {
    color = "#111625";       // Midnight Deep Blue
  } else if (pct < 12) {
    color = "#cc5a37";       // Quick Dawn Horizon Orange
  } else if (pct < 20) {
    color = "#e2b13c";       // Golden Sunrise Yellow
  } else if (pct < 80) {
    color = "#4c7286";       // Crisp Sky Blue (Midday)
  } else if (pct < 88) {
    color = "#d95d39";       // Quick Sunset Fire Crimson
  } else if (pct < 93) {
    color = "#2a1e35";       // Deep Twilight Purple
  } else {
    color = "#111625";       // Night Returns
  }

  // 3. Apply the width and the background color to the DOM element

  const dayFillEl = $("dayFill");
  if (dayFillEl) {
    dayFillEl.style.width = `${pct}%`;
    dayFillEl.style.backgroundColor = color;
  }

  // 4. Update the condensed separator line progress bar
  const miniDayFillEl = $("miniDayFill");
  if (miniDayFillEl) {
    miniDayFillEl.style.width = `${pct}%`;
    miniDayFillEl.style.backgroundColor = color;
  }
  
}, 1000);


// 2. Handle User Registration
async function handleSignUp() {
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const errDiv = document.getElementById("loginError");
  
  errDiv.style.display = "none";
  const { data, error } = await db.auth.signUp({ email, password });
  
  if (error) {
    errDiv.innerText = error.message;
    errDiv.style.display = "block";
  } else {
    alert("Account created! Please sign in.");
  }
}

// 3. Handle User Sign In
async function handleSignIn() {
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const errDiv = document.getElementById("loginError");
  
  errDiv.style.display = "none";
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  
  if (error) {
    errDiv.innerText = error.message;
    errDiv.style.display = "block";
  } else {
    // Hide the login screen and trigger the standard game boot!
    document.getElementById("loginScreen").style.display = "none";
    runGameBoot();
  }
}

// Bind the HTML buttons to these functions
document.getElementById("signInBtn").addEventListener("click", handleSignIn);
document.getElementById("signUpBtn").addEventListener("click", handleSignUp);

// This runs the actual game state loading once we are securely authenticated
async function runGameBoot() {
  initDebugTab();   // no-op unless the logged-in uid/email is allowlisted in debug.js
  setS(await store.load());
  if(!S){ openFounding(); return; }   // first-ever game: opens the founding options
  setS(migrate(S));
  const missed = catchUp();
  if(missed > 0){
    $("offlineBanner").innerHTML = `<div class="banner" id="offlineNote">${missed === 1 ? "A day passed" : missed + " days passed"} while away. <span class="bannerx" onclick="dismissOffline()">Dismiss</span></div>`;
  }
  renderAll();
}

// This runs immediately when the page finishes loading in the browser
(async function init() {
  const { data: { user } } = await db.auth.getUser();
  
  if (user) {
    // Already logged in! Hide login screen and run boot
    document.getElementById("loginScreen").style.display = "none";
    runGameBoot();
  } else {
    // Not logged in. Keep login screen up
    document.getElementById("loginScreen").style.display = "flex";
  }
})();









export { syncNavTop };

// the offline banner uses an inline onclick attribute, which resolves in the
// global scope — modules aren't global, so expose this one handler explicitly
window.dismissOffline = dismissOffline;
