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









/* ================= tabs, timer, boot ================= */
document.querySelectorAll("nav button").forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll("nav button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    ["village","beyond","works","power","water","people","journal"].forEach(t=>$("tab-"+t).style.display = b.dataset.tab===t?"":"none");
  };
});

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
  const frac=(Date.now()-S.lastTick)/DAY_MS;
  if(frac>=1){ const n=catchUp(); if(n>0){ store.save(S); renderAll(); } }
  $("dayFill").style.width = `${clamp(frac*100,0,100)}%`;
},1000);


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
