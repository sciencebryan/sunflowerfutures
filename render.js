import { ADULT, CROPS, ELDER, FABS, FAB_RATE, FORAGE_FLAVOR, PRESERVE, SEASON_LEN, canWork, dayOfSeason, season, seasonNote } from "./seasons.js";
import { S } from "./state.js";
import { $ } from "./dom.js";
import { FOREST_PLOT_COST, MAX_FOREST_PLOTS, PROJECTS, RESTORE_GATE, RESTORE_HIGH, RESTORE_LOW, SITE_DEF, SKILL_INFO, STACKABLE, SYS, TRAITS, built, decayOf, isVisible, waterCapEff } from "./defs.js";
import { eventDef, eventView, exWhere } from "./events.js";
import { Cap, PRACTICE_SPECIFIC_CAP, byId, clamp, eff, effStat, isAre, pick, poss, practiceOf, siteName, siteRemainFrac, subj, wbFloor } from "./helpers.js";
import { SOIL_WORD, openPartySheet, openPersonSheet, openSowSheet, openSystemSheet } from "./sheets.js";
import { assignPhrase, workDef } from "./day.js";
import { store } from "./store.js";
import { renderWorks } from "./puzzle-ui.js";
import { syncNavTop } from "./main.js";

/* ================= rendering ================= */

function renderHeader() {
  const sn = season();
  const r = S.report;
  
  // 1. Weather and Date
  $("daywx").textContent = `${sn.name}, day ${dayOfSeason(S.day)} — ${S.weather}`;


  // Vitals: Food / Water / Power — value line, then a small colored delta line
  const foodChange = (r.foodIn - r.foodOut);
  const waterNet = (r.waterIn - r.waterOut);
  const powerNet = (r.gen - r.draw);
  const cap = r.cap || 0;

  const delta = v => `<span class="delta"><span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}</span></span>`;
  const foodBreakdown = S.preserved > 0
    ? ` · ${S.res.food.toFixed(0)}f ${S.preserved.toFixed(0)}r` : '';

  $("hudVitals").innerHTML = `
    <div class="stat">
      <span class="lbl">Food</span>
      <span class="val">${(S.res.food + S.preserved).toFixed(0)}</span>
      <span class="delta"><span class="${foodChange >= 0 ? 'pos' : 'neg'}">${foodChange >= 0 ? '+' : ''}${foodChange.toFixed(1)}</span>${foodBreakdown}</span>
    </div>
    <div class="stat">
      <span class="lbl">Water</span>
      <span class="val">${S.res.water.toFixed(0)}<small> / ${waterCapEff()}</small></span>
      ${delta(waterNet)}
    </div>
    <div class="stat">
      <span class="lbl">Power</span>
      <span class="val">${S.res.charge.toFixed(1)}${cap > 0 ? `<small> / ${cap.toFixed(0)}</small>` : ''}</span>
      ${r.brownout ? `<span class="delta"><span class="neg">brownout</span></span>` : delta(powerNet)}
    </div>
  `;

  // People and materials: compact ledger lines; zeros render dimmed
  const resting = S.people.filter(p => p.job === null && p.status === "ok").length;
  const laidup = S.people.filter(p => p.status === "down" || p.status === "spent").length;
  const away = S.people.filter(p => p.status === "away").length;

  const ledgerItem = (l, v) =>
    `<span class="item"><span class="lbl">${l}</span><span class="val${v === 0 ? ' dim' : ''}">${v}</span></span>`;

  $("hudPeople").innerHTML = [
    ["Villagers", S.people.length], ["Resting", resting], ["Laid up", laidup], ["Away", away]
  ].map(x => ledgerItem(x[0], x[1])).join("");

  $("hudMaterials").innerHTML = [
    ["Scrap", Math.round(S.res.scrap)], ["Parts", Math.round(S.res.parts)],
    ["Wood", Math.round(S.res.wood || 0)], ["Seeds", Math.round(S.res.seeds || 0)],
    ["Meds", Math.round(S.res.meds || 0)]
  ].map(x => ledgerItem(x[0], x[1])).join("");

  $("evdot").style.display = S.event ? "" : "none";
}

function condClass(c){return c>=60?"c-good":c>=35?"c-mid":"c-bad";}
function wbColor(w){return w>=60?"#58793F":w>=30?"#C8963B":"#A85B38";}

function salvageChips(){
  const items = [
    {n: "Scrap", v: S.res.scrap},
    {n: "Parts", v: S.res.parts},
    {n: "Wood", v: S.res.wood},    
    {n: "Seeds", v: S.res.seeds},
    {n: "Meds", v: S.res.meds}
  ];
  return `
    <div class="ledger">
      ${items.map(i => `
        <div class="ledger-item">
          <b>${i.v.toFixed(0)}</b> <span>${i.n}</span>
        </div>
      `).join('')}
    </div>`;
}
function roleChip(jobId, roleLabel, empty){
  const list=S.people.filter(p=>p.job===jobId);
  const inner = list.length
    ? `<span class="dot"></span><span class="role">${roleLabel}</span>${list.map(p=>p.name).join(", ")}`
    : `<span class="dot"></span><span class="role">${roleLabel}</span>${empty}`;
  return `<button class="keeper ${list.length?'filled':'empty'}" data-open="${jobId}">${inner}</button>`;
}

function renderEvent(){
  if(!S.event) return "";
  const ev=eventView();
  if(!ev){ S.event=null; return ""; }   // an event type that no longer exists; let it go
  let h=`<div class="card evcard">
    <div class="evtitle">${ev.title}</div>
    <div class="evtext">${ev.text}</div>`;
  ev.opts.forEach((o,i)=>{
    const ok = o.can ? o.can() : true;
    h+=`<button class="evopt" data-evopt="${i}" ${ok?"":"disabled"}>
      <div class="l1">${o.label}</div><div class="l2">${o.sub}${ok?"":" · can't afford it"}</div></button>`;
  });
  h+=`<div class="blurb" style="margin-top:2px">The village will wait on this. The days won't.</div></div>`;
  return h;
}

function powerCard(){
  const r=S.report;
  const bal=r.gen-r.draw;
  const parts=SYS.filter(d=>built(d.id)&&d.draw>0).map(d=>`${d.name.toLowerCase()} ${d.draw}`).join(" · ")||"nothing yet";
  const madeWhy=r.genWhy||"";
  const red=(S.f||{}).drawReduce?` · gravity feed saves ${(S.f||{}).drawReduce}`:"";
  return `<div class="card" style="border-color:${r.brownout?'var(--rust)':'var(--line)'}">
    <div class="card-top"><div class="sysname">Power</div>
      <div class="condpct">${r.gen.toFixed(1)} made · ${r.draw.toFixed(1)} used</div></div>
    <div class="blurb">
      Generation is a <i>flow</i>, not a store: what the sun and wind give today, the village spends today.
      Surplus charges the battery; the battery covers the days they don't give enough.
    </div>
    <div class="sysmeta" style="margin-top:7px">
      <span class="outline-note">made: ${madeWhy}</span>
    </div>
    <div class="sysmeta" style="margin-top:3px">
      <span class="outline-note">draw: ${parts}${red}</span>
      <span class="outline-note">${bal>=0?`+${bal.toFixed(1)} to the cell`:`${bal.toFixed(1)} from the cell`}</span>
    </div>
    ${r.brownout?`<div class="warnline">Brownout. Nothing left in the cell — ${built("aquaponics")?"the fish tanks and the water pump run":"the water pump runs"} at half, and it wears on everyone.</div>`
      :`<div class="outline-note" style="margin-top:6px">Cell ${S.res.charge.toFixed(1)} / ${(r.cap||0).toFixed(0)}${(r.cap||0)<9?" — the bank is small. It could be reconditioned.":""}</div>`}
  </div>`;
}

function seasonBanner(){
  const s=season();
  const left=SEASON_LEN-dayOfSeason(S.day)+1;
  const winterSoon = s.id==="autumn" && left<=12;
  return `<div class="banner" style="${winterSoon?'border-color:var(--rust)':''}">
    <b>${s.name}, day ${dayOfSeason(S.day)} of ${SEASON_LEN}</b> — ${seasonNote(s)}
    ${s.id==="winter"?` Stores would feed the village ${(S.winterDays||0).toFixed(0)} more days.`:""}
    ${winterSoon?` <span style="color:var(--rust)">Frost in ${left} day${left===1?"":"s"}. Anything tender in open ground will be lost${S.flags.coldFrames?", though the cold frames will keep going":""}, and the open beds won't grow again until the thaw.</span>`:""}
  </div>`;
}

// Spends banked surplus on purpose: an immediate spirits bump for everyone
// present, plus a few days of afterglow (folded into the daily aura calc —
// see S.festivalBoostDays in simulateDay). The only deliberate sink for a
// good year's food; without one, surplus just sits until it spoils.
function holdFestival(){
  const FEST_COST=30, FEST_COOLDOWN=40, FEST_MARGIN=20;
  const stores=S.res.food+S.preserved;
  if((S.festivalCooldown||0)>0) return;
  if(stores < FEST_COST+FEST_MARGIN) return;
  // spend fresh first, then preserved, same order the famine logic already uses
  let need=FEST_COST;
  const fromFresh=Math.min(S.res.food, need); S.res.food-=fromFresh; need-=fromFresh;
  const fromPreserved=Math.min(S.preserved, need); S.preserved-=fromPreserved;
  const usedOil = (S.oil||0)>=3;
  if(usedOil) S.oil -= 3;

  S.festivalBoostDays = 3;
  S.festivalCooldown = FEST_COOLDOWN;
  for(const p of S.people){ if(p.status!=="away") p.wb=clamp(p.wb+10, wbFloor(p), 100); }

  // flavor draws on the real diet log, so a festival after a varied harvest
  // reads differently than one thrown from the last of the jars
  const recentKinds = new Set(S.dietLog.filter(e=>S.day-e.day<=21).map(e=>e.crop));
  const richTable = recentKinds.size>=3;
  const lines = usedOil
    ? [`A festival, and everything on the table fried bright in oil for once — ${richTable?"half of it grown this year":"whatever the stores could spare"}. Nobody kept count of the servings.`,
       "Someone got the whole commons singing before the plates were even cleared."]
    : [`A festival on nothing but what was banked, and it was enough. ${richTable?"A season's worth of different things, all out at once.":"Plain food, plenty of it, and no one rationing tonight."}`,
       "Whatever the day's work was, it waited."];
  S.pending.push(pick(lines));
  S.journal.unshift({day:S.day, weather:S.weather, event:true,
    lines:[`A festival was held.${usedOil?" Oil, spent on purpose, not saved.":""} ${FEST_COST} food given over, on purpose, to a night nobody worked.`,
           "It will happen again, someday, when there's enough to spare again."]});
}

function renderVillage(){
  const resting = S.people.filter(p=>p.job===null&&p.status==="ok").length;
  const away = S.people.filter(p=>p.status==="away").length;
  const laidup = S.people.filter(p=>p.status==="down"||p.status==="spent").length;

  // Build the top dashboard
  let h = seasonBanner();
//  h += `<div class="sectionlbl">${S.people.length} villagers · ${resting} resting · ${laidup} laid up · ${away} away</div>`;
//  h += salvageChips();
  h += renderEvent();
  h += powerCard();

  for(const def of SYS){
    const st=S.sys[def.id];
    if(!st.built && !isVisible(def)) continue;
    if(!st.built){
      const afford=Object.entries(def.cost).every(([k,v])=>S.res[k]>=v);
      const canStart = afford && !S.project;
      const costHtml=Object.entries(def.cost).map(([k,v])=>`<span class="cost ${S.res[k]>=v?'':'short'}">${v} ${k}</span>`).join("");
      const missing=Object.entries(def.cost).filter(([k,v])=>S.res[k]<v).map(([k,v])=>`${(v-S.res[k]).toFixed(0)} more ${k}`);
      h+=`<div class="card ${canStart?'buildable':''}">
        <div class="card-top"><div class="sysname">${def.name}</div>
          <button class="go ${canStart?'ready':''}" data-build="${def.id}" ${canStart?"":"disabled"}>Build it</button></div>
        <div class="blurb">Not yet built. ${def.blurb}</div>
        <div class="costchips">${costHtml}<span class="cost">~${Math.ceil(def.work/5)} days of work</span>${def.draw>0?`<span class="cost">draws ${def.draw} power</span>`:""}</div>
        ${!afford?`<div class="sysmeta"><span class="outline-note">Need ${missing.join(", ")}.</span></div>`:S.project?`<div class="sysmeta"><span class="outline-note">Finish the current project first.</span></div>`:""}
      </div>`;
      continue;
    }
    const c=st.cond;
    const crew=S.people.filter(p=>p.job===def.id);
    const F=S.flags;
    const dec = decayOf(def);
    const netDay = crew.filter(p=>p.status==="ok").reduce((a,p)=>{
      let hd=effStat(p,"hands",def.id)+(p.trait==="Tinkerer"?1.5:0)+(p.trait==="Cautious"?-0.5:0);
      return a+hd*1.6*eff(p)*(F.toolLibrary?1.2:1)*(S.sys[def.id].cond>=85?0.45:1);},0) - dec;
    let roles=`<div class="rolerow">${roleChip(def.id,"keeper","no one")}`;
    if(def.id==="aquaponics") roles+=roleChip("aquatend","tender","no one");
    if(def.id==="commons") roles+=roleChip("cook","cook","no one");
    roles+=`</div>`;
    let stackExtra="";
    if(STACKABLE[def.id]){
      const meta=STACKABLE[def.id];
      const n=S[meta.stateKey]||1;
      const canRaise = n<meta.max && Object.entries(meta.cost).every(([k,v])=>S.res[k]>=v);
      const costStr = Object.entries(meta.cost).map(([k,v])=>`${v} ${k}`).join(", ");
      stackExtra = `<div class="sysmeta"><span class="outline-note">${n} of ${meta.max} ${meta.noun} ${meta.verb} · one keeper minds them all</span>
        ${n<meta.max?`<button class="go ${canRaise?'ready':''}" data-raise="${def.id}" ${canRaise?"":"disabled"}>Raise another (${costStr})</button>`:`<span class="outline-note">${meta.place} is full</span>`}</div>`;
    }
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">${def.name}${STACKABLE[def.id]&&(S[STACKABLE[def.id].stateKey]||1)>1?` ×${S[STACKABLE[def.id].stateKey]}`:""}</div><div class="condpct">${c.toFixed(0)}%</div></div>
      <div class="blurb">${def.blurb}</div>
      <div class="cbar"><div class="fill ${condClass(c)}" style="width:${c}%"></div></div>
      ${roles}
      ${stackExtra}
      <div class="sysmeta"><span class="outline-note">${netDay>=0?"+":""}${netDay.toFixed(1)}%/day · wears −${dec.toFixed(1)}${def.id==="commons"?" · cook lifts everyone":""}</span></div>
      ${def.id==="aquaponics"&&built("aquaponics")?`<div class="sysmeta"><span class="outline-note">${(S.report.aquaFood||0).toFixed(1)} food/day = ${S.report.aquaWhy||"unattended base"}</span></div>`:""}
      ${c<35?`<div class="warnline">Failing. Output is badly reduced.</div>`:""}
    </div>`;
  }
  {
    const sn=season();
    const tenders=S.people.filter(p=>p.job==="garden");
    const frozen = sn.grow===0 && !S.flags.coldFrames;
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">The gardens</div><div class="condpct">${tenders.length} tending · ${S.beds.length} bed${S.beds.length>1?"s":""}</div></div>
      <div class="blurb">${frozen
        ? "Frozen ground. Nothing sown now would live to see the thaw."
        : "Sow a bed, tend it, wait. A radish is a week; grain is most of a season."}</div>
      <div class="rolerow">${roleChip("garden","tenders","untended")}</div>
      <div class="sysmeta"><span class="outline-note">${(S.report.gardenFood||0)>0?`brought in ${(S.report.gardenFood).toFixed(0)} today · `:""}${S.report.gardenWhy||"nothing planted"}</span></div>
      ${S.flags.compost?`<div class="sysmeta"><span class="outline-note">${(S.compost||0).toFixed(0)} compost turning, spread onto whatever's most worn</span></div>`:""}`;
    S.beds.forEach((bed,i)=>{
      const soilTag = ` <span class="outline-note" style="opacity:.65">· ${SOIL_WORD(bed.fertility??75)}</span>`;
      if(!bed.crop){
        h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Bed ${i+1} — bare${soilTag}</span>
          <button class="go" data-sow="${i}" ${frozen?"disabled":""}>Sow</button></div>`;
        return;
      }
      const crop=CROPS[bed.crop];
      // every planted bed gets a way in -- this used to only exist for bare beds,
      // which meant "turn it under" was never actually reachable. Now it is.
      if(crop.perennial){
        const ageYears=(S.day-bed.plantedDay)/(SEASON_LEN*4);
        const estFrac=clamp(ageYears/crop.matureYears,0.15,1);
        const status = bed.ready ? "ready to bring in"
                      : estFrac>=1 ? `established · bears in ${crop.harvestSeason}`
                      : `year ${Math.max(1,Math.ceil(ageYears))}/${crop.matureYears} toward bearing`;
        h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Bed ${i+1} — ${crop.name.toLowerCase()} · ${status}${soilTag}</span>
            <span class="outline-note">${bed.ready?`${bed.stored.toFixed(0)} waiting`:`${(estFrac*100).toFixed(0)}%`}</span>
            <button class="go" data-sow="${i}" style="margin-left:6px">Manage</button></div>
          <div class="cbar" style="margin:3px 0 2px"><div class="fill ${bed.ready?'c-good':'c-sun'}" style="width:${(bed.ready?100:estFrac*100)}%"></div></div>`;
      } else {
        const pc=clamp(bed.growth/crop.work*100,0,100);
        h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Bed ${i+1} — ${crop.name.toLowerCase()}${bed.ready?" · ready to bring in":""}${soilTag}</span>
            <span class="outline-note">${bed.ready?`${bed.stored.toFixed(0)} waiting`:`${pc.toFixed(0)}%`}</span>
            <button class="go" data-sow="${i}" style="margin-left:6px">Manage</button></div>
          <div class="cbar" style="margin:3px 0 2px"><div class="fill ${bed.ready?'c-good':'c-sun'}" style="width:${pc}%"></div></div>`;
      }
    });
    h+=`</div>`;
  }

  // --- restoration: three ecological metrics, shown once the village begins healing land ---
  if(S.restore && S.restore.seen){
    const r=S.restore;
    const rows=[
      {k:"mycosphere", name:"Soil mycosphere", val:r.mycosphere, note:"the living soil web — fed by native plantings and compost"},
      {k:"aquifer",    name:"Aquifer",         val:r.aquifer,    note:"the water table — fed by watershed work"},
      {k:"pollinator", name:"Pollinator density", val:r.pollinator, note:"the wild bloom — fed by wildflower meadows"}
    ];
    const band = v => v>=RESTORE_HIGH ? "c-good" : v<=RESTORE_LOW ? "c-rust" : "c-sun";
    const state = v => v>=RESTORE_GATE ? "restored" : v>=RESTORE_HIGH ? "holding on its own" : v<=RESTORE_LOW ? "still fragile" : "taking hold";
    let rh=`<div class="card">
      <div class="card-top"><div class="sysname">The valley</div><div class="condpct">${r.restored?"restored":"healing"}</div></div>
      <div class="blurb">The work has turned outward — from keeping the village alive to giving the land back its own health. These hold themselves up once they catch, and slide back if the ground beneath them fails.</div>`;
    for(const row of rows){
      rh+=`<div class="sysmeta" style="margin-top:8px"><span class="outline-note">${row.name} — ${state(row.val)}</span>
        <span class="outline-note">${row.val.toFixed(0)}%</span></div>
        <div class="cbar" style="margin:3px 0 2px"><div class="fill ${band(row.val)}" style="width:${row.val}%"></div></div>
        <div class="sysmeta"><span class="outline-note" style="opacity:.6">${row.note}</span></div>`;
    }
    if(r.restored) rh+=`<div class="sysmeta" style="margin-top:8px"><span class="outline-note" style="color:var(--leaf)">The valley is whole. Human ground and wild ground have stopped being different things.</span></div>`;
    rh+=`</div>`;
    h+=rh;
  }

  // --- Chopping Wood ---
  h+=`<div class="card">
    <div class="card-top"><div class="sysname">The tree line</div><div class="condpct">${S.res.wood.toFixed(0)} wood</div></div>
    <div class="blurb">Felling deadwood and hauling it back. You will need it when the deep freeze comes.</div>
    <div class="rolerow">${roleChip("woodcut","hauler","no one")}</div>
    <div class="sysmeta"><span class="outline-note">${S.report.woodWhy||"nobody chopping today"}</span></div>
  </div>`;

  // --- the food forest: perennial ground, separate from the kitchen beds ---
  {
    const forest = S.forest||[];
    const knowsPerennial = Object.keys(CROPS).some(id=>CROPS[id].perennial && (!CROPS[id].locked || (S.crops&&S.crops[id])));
    if(forest.length>0 || knowsPerennial){
      const canClear = forest.length<MAX_FOREST_PLOTS && Object.entries(FOREST_PLOT_COST).every(([k,v])=>S.res[k]>=v);
      const clearCost = Object.entries(FOREST_PLOT_COST).map(([k,v])=>`${v} ${k}`).join(", ");
      h+=`<div class="card">
        <div class="card-top"><div class="sysname">The food forest</div><div class="condpct">${forest.length} plot${forest.length!==1?"s":""}</div></div>
        <div class="blurb">The edge ground — old orchard rows, the parking-lot trees. Perennials go here: years to bear, then food for almost nothing.</div>`;
      if(forest.length===0){
        h+=`<div class="sysmeta"><span class="outline-note">No plots cleared yet.</span></div>`;
      }
      forest.forEach((plot,i)=>{
        const soilTag=` <span class="outline-note" style="opacity:.65">· ${SOIL_WORD(plot.fertility??75)}</span>`;
        if(!plot.crop){
          h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Plot ${i+1} — cleared, empty${soilTag}</span>
            <button class="go" data-forest="${i}">Plant</button></div>`;
        } else if(plot.meadow){
          h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Plot ${i+1} — wildflower meadow · in bloom for the bees${soilTag}</span>
            <button class="go" data-forest="${i}" style="margin-left:6px">Manage</button></div>`;
        } else {
          const crop=CROPS[plot.crop];
          const ageYears=(S.day-plot.plantedDay)/(SEASON_LEN*4);
          const estFrac=clamp(ageYears/crop.matureYears,0.15,1);
          const status = plot.ready ? "ready to bring in"
                        : estFrac>=1 ? `established · bears in ${crop.harvestSeason}`
                        : `year ${Math.max(1,Math.ceil(ageYears))}/${crop.matureYears} toward bearing`;
          h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">Plot ${i+1} — ${crop.name.toLowerCase()} · ${status}${soilTag}</span>
              <span class="outline-note">${plot.ready?`${plot.stored.toFixed(0)} waiting`:`${(estFrac*100).toFixed(0)}%`}</span>
              <button class="go" data-forest="${i}" style="margin-left:6px">Manage</button></div>
            <div class="cbar" style="margin:3px 0 2px"><div class="fill ${plot.ready?'c-good':'c-sun'}" style="width:${(plot.ready?100:estFrac*100)}%"></div></div>`;
        }
      });
      if(forest.length<MAX_FOREST_PLOTS){
        h+=`<div class="sysmeta" style="margin-top:7px"><span class="outline-note">clearing ground is slow work, but it's done once</span>
          <button class="go ${canClear?'ready':''}" data-clearplot="1" ${canClear?"":"disabled"}>Clear a plot (${clearCost})</button></div>`;
      } else {
        h+=`<div class="sysmeta"><span class="outline-note">the forest is as wide as the edge ground allows</span></div>`;
      }
      h+=`</div>`;
    }
  }

  const down=S.people.filter(p=>p.status==="down"||p.status==="spent");
  h+=`<div class="card">
    <div class="card-top"><div class="sysname">The sickbed</div><div class="condpct">${down.length} laid up</div></div>
    <div class="blurb">Broth, splints, and someone to sit with. The hurt and the spent mend faster with care.</div>
    <div class="rolerow">${roleChip("care","caretaker","no one")}</div>
    <div class="sysmeta"><span class="outline-note">${down.length?down.map(p=>p.name).join(", "):"everyone is on their feet"} · uses care</span></div>
  </div>`;

  // putting food by
  {
    const methods=Object.values(PRESERVE).filter(m=>S.flags[m.flag]);
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Putting food by</div><div class="condpct">${S.preserved.toFixed(0)} kept</div></div>
      <div class="sysmeta" style="margin-bottom:5px"><span class="outline-note ${(S.winterDays||0)<30?'':''}" style="color:${(S.winterDays||0)<30?'var(--rust)':'var(--leaf)'}">stores would feed the village ${(S.winterDays||0).toFixed(0)} days · winter is 30</span></div>
      <div class="blurb">${methods.length
        ? "Fresh food spoils, and faster in summer. What's dried, fermented or canned keeps until you need it. In winter you will."
        : "Fresh food spoils. Nothing keeps yet — build drying racks, crocks, or canning to get through a winter."}</div>
      ${methods.length?`<div class="rolerow">${roleChip("preserve","hands","nobody putting food by")}</div>
        <div class="sysmeta"><span class="outline-note">${S.report.preserveWhy||methods.map(m=>m.name.toLowerCase()).join(" · ")}</span></div>`:""}
    </div>`;
  }

  // --- pressing oil, once the press is built ---
  if(S.flags.oilPress){
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">Pressing oil</div><div class="condpct">${(S.oil||0).toFixed(1)} oil</div></div>
      <div class="blurb">Sunflower seed set aside from the harvest, turned by hand into something worth cooking with. Slow, and most of the seed doesn't become oil.</div>
      <div class="rolerow">${roleChip("press","hands","nobody at the press")}</div>
      <div class="sysmeta"><span class="outline-note">${(S.res.rawSeed||0).toFixed(1)} seed waiting · ${S.report.pressWhy||"nothing pressed today"}</span></div>
    </div>`;
  }

  // --- a festival: the one deliberate sink for a good year's surplus ---
  {
    const FEST_COST=30, FEST_COOLDOWN=40;
    const stores=S.res.food+S.preserved;
    const canAfford = stores >= FEST_COST + 20;   // never lets a festival eat into winter margin
    const onCooldown = (S.festivalCooldown||0)>0;
    const hasOil = (S.oil||0)>=3;
    const canHold = canAfford && !onCooldown;
    h+=`<div class="card ${canHold?'buildable':''}">
      <div class="card-top"><div class="sysname">Hold a festival</div>
        <button class="go ${canHold?'ready':''}" data-festival="1" ${canHold?"":"disabled"}>Hold it</button></div>
      <div class="blurb">A night the stores can afford, given over on purpose. Everyone eats well, nobody works, and it's the only good reason to spend a surplus instead of banking it against a worse winter.</div>
      <div class="costchips"><span class="cost ${stores>=FEST_COST?'':'short'}">${FEST_COST} food</span>${hasOil?`<span class="cost">3 oil, if you have it — a richer table</span>`:""}<span class="cost">lifts spirits for 3 days</span></div>
      ${onCooldown?`<div class="sysmeta"><span class="outline-note">Too soon again — give it ${S.festivalCooldown} more day${S.festivalCooldown===1?"":"s"}.</span></div>`
        :!canAfford?`<div class="sysmeta"><span class="outline-note">Needs a real surplus — ${FEST_COST} food to spend, and ${20} left over after.</span></div>`:""}
    </div>`;
  }

  h+=`<div class="sectionlbl">Work &amp; projects</div>`;
  h+=salvageChips();
  if(S.project){
    const isBuild=S.project.kind==="build";
    const def=workDef();
    const pc=clamp(S.project.progress/def.work*100,0,100);
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">${isBuild?`Raising the ${def.name.toLowerCase()}`:def.name}</div><div class="condpct">${pc.toFixed(0)}%</div></div>
      <div class="blurb">${def.blurb}</div>
      <div class="cbar"><div class="fill c-sun" style="width:${pc}%"></div></div>
      <div class="rolerow">${roleChip("project","hands","no hands on it")}</div>
    </div>`;
  }
  for(const proj of PROJECTS){
    if(S.flags[proj.id]) continue;
    if(S.project && S.project.id===proj.id) continue;
    if(!isVisible(proj)) continue;
    const afford=Object.entries(proj.cost).every(([k,v])=>S.res[k]>=v);
    const canStart=afford && !S.project;
    const costHtml=Object.entries(proj.cost).map(([k,v])=>`<span class="cost ${S.res[k]>=v?'':'short'}">${v} ${k}</span>`).join("");
    const missing=Object.entries(proj.cost).filter(([k,v])=>S.res[k]<v).map(([k,v])=>`${(v-S.res[k]).toFixed(0)} more ${k}`);
    h+=`<div class="card ${canStart?'buildable':''}">
      <div class="card-top"><div class="sysname">${proj.name}</div>
        <button class="go ${canStart?'ready':''}" data-proj="${proj.id}" ${canStart?"":"disabled"}>Begin</button></div>
      <div class="blurb">${proj.blurb}</div>
      <div class="costchips">${costHtml}<span class="cost">~${Math.ceil(proj.work/5)} days of work</span></div>
      ${!afford?`<div class="sysmeta"><span class="outline-note">Need ${missing.join(", ")}.</span></div>`:S.project?`<div class="sysmeta"><span class="outline-note">Finish the current project first.</span></div>`:""}
    </div>`;
  }
  const doneProj=PROJECTS.filter(p=>S.flags[p.id]);
  if(doneProj.length) h+=`<div class="sectionlbl">Finished: ${doneProj.map(p=>p.name).join(" · ")}</div>`;

  // fabrication
  h+=`<div class="sectionlbl">Fabrication — making what you used to find</div>`;
  if(S.fabProject){
    const def=FABS.find(x=>x.id===S.fabProject.id);
    const pc=clamp(S.fabProject.progress/def.work*100,0,100);
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">${def.name}</div><div class="condpct">${pc.toFixed(0)}%</div></div>
      <div class="blurb">${def.blurb}</div>
      <div class="cbar"><div class="fill c-sun" style="width:${pc}%"></div></div>
      <div class="rolerow">${roleChip("fab","hands","no hands on it")}</div>
    </div>`;
  }
  for(const def of FABS){
    if(S.fabs[def.id]){
      h+=`<div class="card grey"><div class="card-top"><div class="sysname">${def.name}</div>
        <div class="condpct">+${FAB_RATE[def.gives].toFixed(2)} ${def.gives}/day</div></div>
        <div class="blurb">${def.blurb}</div></div>`;
      continue;
    }
    if(S.fabProject && S.fabProject.id===def.id) continue;
    const afford=Object.entries(def.cost).every(([k,v])=>S.res[k]>=v);
    const canStart=afford && !S.fabProject;
    const costHtml=Object.entries(def.cost).map(([k,v])=>`<span class="cost ${S.res[k]>=v?'':'short'}">${v} ${k}</span>`).join("");
    const missing=Object.entries(def.cost).filter(([k,v])=>S.res[k]<v).map(([k,v])=>`${(v-S.res[k]).toFixed(0)} more ${k}`);
    h+=`<div class="card ${canStart?'buildable':''}">
      <div class="card-top"><div class="sysname">${def.name}</div>
        <button class="go ${canStart?'ready':''}" data-fab="${def.id}" ${canStart?"":"disabled"}>Begin</button></div>
      <div class="blurb">${def.blurb}</div>
      <div class="costchips">${costHtml}<span class="cost">then +${FAB_RATE[def.gives].toFixed(2)} ${def.gives}/day, forever</span></div>
      ${!afford?`<div class="sysmeta"><span class="outline-note">Need ${missing.join(", ")}.</span></div>`:S.fabProject?`<div class="sysmeta"><span class="outline-note">Finish the current fabrication first.</span></div>`:""}
    </div>`;
  }

//  const resting=S.people.filter(p=>p.job===null&&p.status==="ok").length;
//  const away=S.people.filter(p=>p.status==="away").length;
//  const laidup=S.people.filter(p=>p.status==="down"||p.status==="spent").length;
//  h+=`<div class="sectionlbl">${S.people.length} villagers · ${resting} resting · ${laidup} laid up · ${away} away</div>`;

  $("tab-village").innerHTML=h;
  $("tab-village").querySelectorAll("[data-open]").forEach(el=>{
    el.onclick=()=>openSystemSheet(el.dataset.open);
  });
  $("tab-village").querySelectorAll("[data-sow]").forEach(b=>{
    b.onclick=()=>openSowSheet(+b.dataset.sow);
  });
  $("tab-village").querySelectorAll("[data-fab]").forEach(b=>{
    b.onclick=()=>{
      const def=FABS.find(x=>x.id===b.dataset.fab);
      if(S.fabProject) return;
      if(!Object.entries(def.cost).every(([k,v])=>S.res[k]>=v)) return;
      for(const [k,v] of Object.entries(def.cost)) S.res[k]-=v;
      S.fabProject={id:def.id, progress:0};
      S.pending.push(`Work began on ${def.name.toLowerCase()}.`);
      store.save(S); renderAll();
    };
  });
  $("tab-village").querySelectorAll("[data-proj]").forEach(b=>{
    b.onclick=()=>{
      const proj=PROJECTS.find(p=>p.id===b.dataset.proj);
      for(const [k,v] of Object.entries(proj.cost)) S.res[k]-=v;
      S.project={kind:"project", id:proj.id, progress:0};
      S.pending.push(`Work began on the ${proj.name.toLowerCase()}.`);
      store.save(S); renderAll();
    };
  });
  $("tab-village").querySelectorAll("[data-build]").forEach(b=>{
    b.onclick=()=>{
      const def=SYS.find(s=>s.id===b.dataset.build);
      for(const [k,v] of Object.entries(def.cost)) S.res[k]-=v;
      S.project={kind:"build", id:def.id, progress:0};
      S.pending.push(`They began raising the ${def.name.toLowerCase()}. Someone needs to be on it.`);
      store.save(S); renderAll();
    };
  });
  $("tab-village").querySelectorAll("[data-raise]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.raise;
      const meta=STACKABLE[id];
      if(!meta) return;
      const n=S[meta.stateKey]||1;
      if(n>=meta.max) return;
      if(!Object.entries(meta.cost).every(([k,v])=>S.res[k]>=v)) return;
      for(const [k,v] of Object.entries(meta.cost)) S.res[k]-=v;
      S[meta.stateKey] = n+1;
      // a new unit pulls the array's average condition down a little until it's tuned in
      S.sys[id].cond = clamp(S.sys[id].cond*0.9, 0, 100);
      const msg = id==="turbine" ? `Another turbine went up on the ridge. ${S[meta.stateKey]} of them turning now.`
                : id==="solar"   ? `Another panel went up on the roof. ${S[meta.stateKey]} of them catching light now.`
                : `Another bank got wired in. ${S[meta.stateKey]} of them holding charge now.`;
      S.pending.push(msg);
      store.save(S); renderAll();
    };
  });
  $("tab-village").querySelectorAll("[data-forest]").forEach(b=>{
    b.onclick=()=>openSowSheet(+b.dataset.forest, true);
  });
  $("tab-village").querySelectorAll("[data-clearplot]").forEach(b=>{
    b.onclick=()=>{
      S.forest = S.forest || [];
      if(S.forest.length>=MAX_FOREST_PLOTS) return;
      if(!Object.entries(FOREST_PLOT_COST).every(([k,v])=>S.res[k]>=v)) return;
      for(const [k,v] of Object.entries(FOREST_PLOT_COST)) S.res[k]-=v;
      S.forest.push({crop:null, growth:0, days:0, ready:false, stored:0, fertility:75, plantedDay:0});
      S.pending.push("A new plot cleared at the edge, ready for something that will outlast the season.");
      store.save(S); renderAll();
    };
  });
  $("tab-village").querySelectorAll("[data-festival]").forEach(b=>{
    b.onclick=()=>{ holdFestival(); store.save(S); renderAll(); };
  });
  $("tab-village").querySelectorAll("[data-evopt]").forEach(b=>{
    b.onclick=()=>{
      const def=eventDef(S.event.defId);
      const ev=eventView();
      if(!def||!ev){ S.event=null; renderAll(); return; }
      const i=+b.dataset.evopt, opt=ev.opts[i];
      if(opt.can && !opt.can()) return;
      def.resolve(S.event.ctx, i);
      S.journal.unshift({day:S.day, weather:S.weather, event:true,
        lines:[`${ev.title}. ${ev.text}`, `— The village chose: ${opt.label.toLowerCase()}.`]});
      S.event=null; S.eventCd=6+Math.floor(Math.random()*5);
      store.save(S); renderAll();
    };
  });
}

function renderBeyond(){
  let h=salvageChips();

  if(S.expeditions.length){
    h+=`<div class="sectionlbl">Out there now</div>`;
    for(const ex of S.expeditions){
      const title=ex.type==="explore"?"Ranging out":ex.type==="forage"?"Foraging the near country":siteName(ex.siteId);
      const pc=clamp((ex.total-ex.daysLeft)/ex.total*100,0,100);
      const names=ex.party.map(pid=>byId(pid).name).join(", ");
      h+=`<div class="card">
        <div class="card-top"><div class="sysname">${title}</div><div class="condpct">${ex.daysLeft}d left</div></div>
        <div class="blurb">${names}${ex.riskMult>1?" · alone and fast":""}</div>
        <div class="cbar"><div class="fill c-sun" style="width:${pc}%"></div></div>
      </div>`;
    }
  }

  // --- foraging: the near country ---
  const lard=S.larder??1;
  const lardWord = lard>0.85?"generous" : lard>0.6?"picked at" : lard>0.35?"thin" : "nearly bare";
  const foraging=S.expeditions.some(e=>e.type==="forage");
  h+=`<div class="sectionlbl">The near country</div>
  <div class="card">
    <div class="card-top"><div class="sysname">Forage</div><div class="condpct">2d round trip</div></div>
    <div class="blurb">${FORAGE_FLAVOR[season().id]} It feeds you now, not later, and it does not come back if you take it all.</div>
    <div class="cbar"><div class="fill ${lard>0.6?"c-good":lard>0.35?"c-mid":"c-bad"}" style="width:${lard*100}%"></div></div>
    <div class="sysmeta">
      <span class="outline-note">the patches are ${lardWord} · recovers slowly</span>
      <button class="go" data-send="__forage" ${foraging?"disabled":""}>Send foragers</button>
    </div>
  </div>`;

  h+=`<div class="sectionlbl">Known places</div>`;
  for(const def of SITE_DEF){
    const st=S.sites[def.id];
    if(!st.discovered) continue;
    if(st.depleted){
      h+=`<div class="card grey">
        <div class="card-top"><div class="sysname">${siteName(def.id)}</div><div class="condpct">stripped</div></div>
        <div class="blurb">There is nothing left here but the walk.</div>
      </div>`;
      continue;
    }
    const frac=siteRemainFrac(def.id);
    const word=frac>0.8?"untouched":frac>0.5?"picked at":frac>0.2?"picked over":"nearly stripped";
    const kinds=Object.entries(st.stock).filter(([,v])=>v>0.5).map(([k])=>k).join(", ");
    h+=`<div class="card">
      <div class="card-top"><div class="sysname">${siteName(def.id)}</div><div class="condpct">${def.days}d round trip</div></div>
      <div class="blurb">${def.blurb}</div>
      <div class="sysmeta" style="margin-top:8px">
        <span class="outline-note">${word} · ${kinds||"scraps"}</span>
        <button class="go" data-send="${def.id}">Send a party</button>
      </div>
    </div>`;
  }

  const next=SITE_DEF.find(s=>!S.sites[s.id].discovered);
  const exploring=S.expeditions.some(e=>e.type==="explore");
  if(next){
    h+=`<div class="sectionlbl">Farther out</div>
    <div class="card">
      <div class="card-top"><div class="sysname">Range farther</div><div class="condpct">${next.days}d out and back</div></div>
      <div class="blurb">Everything near has been walked. Whatever is next is farther than the last, and no promises what it is.</div>
      <div class="sysmeta" style="margin-top:8px">
        <span class="outline-note">${exploring?"a party is already ranging":"finds one new place"}</span>
        <button class="go" data-send="__explore" ${exploring?"disabled":""}>Send rangers</button>
      </div>
    </div>`;
  } else {
    h+=`<div class="sectionlbl">Farther out</div>
    <div class="card grey"><div class="sysname">The maps are full</div>
    <div class="blurb">There is nowhere left you haven't walked. What the village needs now, it will have to grow or make.</div></div>`;
  }

  $("tab-beyond").innerHTML=h;
  $("tab-beyond").querySelectorAll("[data-send]").forEach(b=>{
    b.onclick=()=>openPartySheet(b.dataset.send);
  });
}

function skillDots(p){
  const dot=(n)=> "●".repeat(n)+"○".repeat(5-n);
  return `hands ${dot(p.hands)} &nbsp; green ${dot(p.green)}<br>care&nbsp; ${dot(p.care)} &nbsp; wild&nbsp; ${dot(p.wild)}`;
}
// "the wind turbine" / "the forge" / "the gardens" — a readable name for a practice key,
// normalized so a SYS/FABS name that already starts with "The" doesn't double up.
function practiceLabel(key){
  const withThe = name => { let n=name.toLowerCase(); if(n.startsWith("the ")) n=n.slice(4); return "the "+n; };
  const sys=SYS.find(x=>x.id===key); if(sys) return withThe(sys.name);
  const fab=FABS.find(x=>x.id===key); if(fab) return withThe(fab.name);
  const manual={garden:"the gardens", aquatend:"the tanks", cook:"the hearth", care:"the sickbed",
                preserve:"putting food by", forage:"foraging the near country",
                explore:"ranging the far country", salvage:"salvage runs"};
  return manual[key] || key;
}
// A person's strongest earned specific skill, as {key, val} or null if they
// haven't practiced anything enough to notice yet. Shared by practiceLine()
// and the apprenticeship handoff at death, so both agree on what someone
// was "known for."
function bestSpecific(p){
  const pr=practiceOf(p);
  let bestKey=null, bestVal=0;
  for(const [k,v] of Object.entries(pr.specific)){ if(v>bestVal){ bestVal=v; bestKey=k; } }
  return bestKey ? {key:bestKey, val:bestVal} : null;
}
// One quiet line of earned-skill flavour, shown only once it's actually noticeable.
// Reads the practice data but never shows a number — same rule as everywhere else.
function practiceLine(p){
  const best=bestSpecific(p);
  if(!best || best.val < 0.18) return "";
  const label=practiceLabel(best.key);
  const frac=best.val/PRACTICE_SPECIFIC_CAP;
  const knows = subj(p)==="they" ? "know" : "knows";
  if(frac>=0.85) return `${Cap(subj(p))} could tend ${label} in ${poss(p)} sleep.`;
  if(frac>=0.55) return `${Cap(subj(p))} ${knows} ${label} well now.`;
  return `${Cap(subj(p))} ${isAre(p)} getting the feel of ${label}.`;
}

function renderPeople(){
  let h=`<div class="legend"><b>hands</b> — ${SKILL_INFO.hands} · <b>green</b> — ${SKILL_INFO.green}<br><b>care</b> — ${SKILL_INFO.care} · <b>wild</b> — ${SKILL_INFO.wild}</div>`;
  for(const p of S.people){
    let badge="";
    if(!canWork(p)) badge+=`<span class="status-badge" style="color:var(--water);border-color:var(--water)">child, ${p.age}</span>`;
    else if(p.age>=ELDER) badge+=`<span class="status-badge" style="color:var(--sun);border-color:var(--sun)">elder, ${p.age}</span>`;
    if(p.perm==="leg") badge+=`<span class="status-badge" style="color:var(--ink-soft);border-color:var(--ink-soft)">stays home</span>`;
    if(p.status==="down") badge+=`<span class="status-badge">laid up</span>`;
    else if(p.status==="spent") badge+=`<span class="status-badge">spent</span>`;
    else if(p.status==="away") badge+=`<span class="status-badge away">away</span>`;
    let assign;
    if(p.status==="away"){
      const ex=S.expeditions.find(e=>e.party.includes(p.id));
      assign=ex?`Out at <b>${exWhere(ex)}</b> — back in ${ex.daysLeft}d`:"Away";
    } else if(!canWork(p)){ assign=`Underfoot, and learning. ${Cap(subj(p))} will be ${ADULT} soon enough.`; }
    else if(p.status==="down"){ assign="Laid up — not available"; }
    else if(p.status==="spent" && p.job){ assign=`Spent, and still at it — ${assignPhrase(p).replace(/^./,c=>c.toLowerCase())}. Half the work of a rested person.`; }
    else if(p.status==="spent"){ assign="Spent. Resting until spirits return."; }
    else if(p.job){ assign=`${assignPhrase(p)}${p.streak>=3?` · ${p.streak} days straight`:""}`; }
    else assign="Resting";
    h+=`<button class="card pcard" data-p="${p.id}">
      <div><span class="pname">${p.name}<span class="pn">${p.pn}</span></span> <span class="trait">${p.trait}</span>${badge}</div>
      <div class="skills">${skillDots(p)}<br><span style="opacity:.75">${p.age} years old${p.years>0?` · ${p.years} winter${p.years>1?"s":""} here`:""}</span>
      ${practiceLine(p)?`<div style="margin-top:3px;font-style:italic;opacity:.8">${practiceLine(p)}</div>`:""}</div>
      <div class="wbwrap"><div class="wbtrack"><div class="wbfill" style="width:${p.wb}%;background:${wbColor(p.wb)}"></div></div><div class="wbnum">${p.wb.toFixed(0)}</div></div>
      <div class="passign">${assign}</div>
      <div class="flavor">${p.note} <span style="font-style:normal;color:var(--moss)">· ${TRAITS[p.trait]}.</span></div>
      ${p.mem?`<div class="mem">${p.mem}</div>`:""}
    </button>`;
  }
  $("tab-people").innerHTML=h;
  $("tab-people").querySelectorAll("[data-p]").forEach(el=>{
    el.onclick=()=>openPersonSheet(el.dataset.p);
  });
}

function renderJournal(){
  if(!S.journal.length){
    $("tab-journal").innerHTML=`<div class="banner">The journal is blank. The first entry writes itself at the end of the first day.</div>`;
    return;
  }
  let h="";
  for(const e of S.journal){
    h+=`<div class="jentry"${e.event?' style="border-left:2px solid var(--sun);padding-left:10px"':''}><div class="jday">Day ${e.day} — ${e.weather}${e.event?" · a decision":""}</div><div class="jlines">${e.lines.map(l=>`<p>${l}</p>`).join("")}</div></div>`;
  }
  $("tab-journal").innerHTML=h;
}

function renderAll(){ renderHeader(); renderVillage(); renderBeyond(); renderWorks(); renderPeople(); renderJournal(); if(typeof syncNavTop==="function") syncNavTop(); }



export { bestSpecific, practiceLabel, renderAll, skillDots };
