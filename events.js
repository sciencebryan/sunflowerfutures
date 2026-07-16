import { S, freshPerson } from "./state.js";
import { Cap, aliveName, byId, clamp, pick, poss, siteDef, siteName, subj, wbFloor } from "./helpers.js";
import { SITE_DEF, SITE_LOOT_TABLE, rollStranger } from "./defs.js";

/* ================= events ================= */
/* Events are stored in state as {defId, ctx} — PLAIN DATA ONLY.
   Functions do not survive the JSON round-trip through storage; an event
   that sits unanswered across a reload must still know how to resolve.
   roll() -> ctx at spawn time (any randomness happens once, here).
   view(ctx) -> {title,text,opts:[{label,sub,can?}]} for rendering.
   resolve(ctx,i) -> applies option i. */
const EVENTS = [
  {
    id:"stranger",
    when:()=> {
      const isHappyEnough = (S.lowSpiritsStreak || 0) < 5;
      return isHappyEnough && S.newcomerIdx < S.arrivalQueue.length && !S.people.some(p=>p.id===S.arrivalQueue[S.newcomerIdx].id);
    },    
//    when:()=>S.newcomerIdx<S.arrivalQueue.length && !S.people.some(p=>p.id===S.arrivalQueue[S.newcomerIdx].id),
    roll:()=>({}),
    view:()=>{
      const n=S.arrivalQueue[S.newcomerIdx];
      const text = n.founderEcho
        ? `${n.name} (${n.pn}) came up the road at dusk with a pack and a careful face — someone who could have been standing in this yard from the very first day, if things had gone a little differently. ${n.note} They ask for nothing outright. They wait.`
        : `${n.name} (${n.pn}) came up the road at dusk with a pack and a careful face. ${n.note} They ask for nothing outright. They wait.`;
      return {
        title: n.founderEcho ? "Someone who might have been here" : "Someone on the road",
        text,
        opts:[
          {label:"Take them in", sub:"another mouth from tonight; another pair of hands soon"},
          {label:"Turn them away", sub:"the stores are the stores"}
        ]
      };
    },
    resolve:(ctx,i)=>{
      const n=S.arrivalQueue[S.newcomerIdx];
      if(i===0){
        const p=freshPerson(n); p.wb=55; p.mem=n.founderEcho?`Arrived day ${S.day}. Could have been here from the first day.`:`Arrived day ${S.day}.`;
        S.people.push(p); S.newcomerIdx++;
        S.pending.push(`${n.name} stayed. A place was made at the long table, the way places are made — someone moved over.`);
      } else {
        S.newcomerIdx++;
        S.people.forEach(p=>{ if(p.status!=="away") p.wb=clamp(p.wb-1,wbFloor(p),100); });
        S.pending.push(`${n.name} walked on before full dark. No one met anyone's eyes at dinner.`);
      }
    }
  },
  {
    id:"strangerProc",
    when:()=> {
      const isHappyEnough = (S.lowSpiritsStreak || 0) < 5;
      return isHappyEnough && S.flags.radioContact && S.newcomerIdx>=S.arrivalQueue.length;
    },  
//  when:()=>S.flags.radioContact && S.newcomerIdx>=S.arrivalQueue.length,
    roll:()=>rollStranger(),
    view:ctx=>({
      title:"Someone on the road, again",
      text:`${ctx.name} (${ctx.pn}) came up the road with a pack and a careful face. ${ctx.note} They ask for nothing outright. They wait.`,
      opts:[
        {label:"Take them in", sub:"another mouth from tonight; another pair of hands soon"},
        {label:"Turn them away", sub:"the stores are the stores"}
      ]
    }),
    resolve:(ctx,i)=>{
      if(i===0){
        const id="wander_"+S.day+"_"+ctx.name.toLowerCase();
        const def={id, name:ctx.name, pn:ctx.pn, trait:ctx.trait, hands:ctx.hands, green:ctx.green, care:ctx.care, wild:ctx.wild, note:ctx.note};
        const p=freshPerson(def); p.wb=55; p.mem=`Arrived day ${S.day}, off the radio.`;
        S.people.push(p);
        S.pending.push(`${ctx.name} stayed. A place was made at the long table, the way places are made — someone moved over.`);
      } else {
        S.people.forEach(p=>{ if(p.status!=="away") p.wb=clamp(p.wb-1,wbFloor(p),100); });
        S.pending.push(`${ctx.name} walked on before full dark. No one met anyone's eyes at dinner.`);
      }
    }
  },
  {
    id:"traders",
    // A deliberate outlet for exactly the problem a long game runs into: once
    // the near country is mapped and the forge/machine shop are humming, scrap
    // and parts have nowhere to go but the depot cap. This trades some of that
    // surplus for what the village can't easily make for itself.
    when:()=>SITE_DEF.every(d=>S.sites[d.id].discovered) && (S.res.scrap>=25 || S.res.parts>=15),
    roll:()=>{
      const wantKind = S.res.parts>=15 && (S.res.scrap<25 || Math.random()<0.5) ? "parts" : "scrap";
      const wantAmt = wantKind==="parts" ? 12+Math.floor(Math.random()*6) : 18+Math.floor(Math.random()*10);
      const giveKind = Math.random()<0.65 ? "seeds" : "meds";
      const giveAmt = giveKind==="seeds" ? 6+Math.floor(Math.random()*4) : 3+Math.floor(Math.random()*3);
      return {wantKind, wantAmt, giveKind, giveAmt};
    },
    view:ctx=>({
      title:"Travelers from the ridge",
      text:`A handful of people from the next valley over came down the road with a cart. They're short on ${ctx.wantKind}, need it for their own repairs, and have ${ctx.giveKind} to spare in trade.`,
      opts:[
        {label:"Make the trade", sub:`−${ctx.wantAmt} ${ctx.wantKind} · +${ctx.giveAmt} ${ctx.giveKind}`, can:()=>S.res[ctx.wantKind]>=ctx.wantAmt},
        {label:"Keep the stores", sub:"might need it yet"}
      ]
    }),
    resolve:(ctx,i)=>{
      if(i===0 && S.res[ctx.wantKind]>=ctx.wantAmt){
        S.res[ctx.wantKind] -= ctx.wantAmt;
        S.res[ctx.giveKind] = (S.res[ctx.giveKind]||0) + ctx.giveAmt;
        S.neighborStanding = Math.min(5, (S.neighborStanding||0)+0.5);
        S.pending.push(`The ${ctx.wantKind} changed hands for ${ctx.giveKind}, fair and quick. They left word of the road, and a promise to come back before the snows.`);
      } else {
        S.pending.push("They nodded, understanding well enough, and turned the cart back up the ridge.");
      }
    }
  },
  {
    id:"lockedWing",
    when:() => SITE_DEF.some(d => {
      const site = S.sites[d.id];
      const isFreshlyVisited = (S.day - site.lastVisited) <= 2;
      const isActiveExpedition = S.expeditions.some(ex => ex.siteId === d.id);
      
      return site.visited && !site.depleted && (isFreshlyVisited || isActiveExpedition);
    }),
    roll:() => {
      const cands = SITE_DEF.filter(d => {
        const site = S.sites[d.id];
        return site.visited && !site.depleted && ((S.day - site.lastVisited) <= 2 || S.expeditions.some(ex => ex.siteId === d.id));
      });
  
      const site = pick(cands);
      const lootTable = SITE_LOOT_TABLE[site.id] || { scrap: 1.0 };
  
      // Pick a random key based on the weights in the loot table
      const roll = Math.random();
      let cumulative = 0;
      let kind = "scrap"; // Fallback
  
      for (const [res, weight] of Object.entries(lootTable)) {
         cumulative += weight;
         if (roll < cumulative) {
            kind = res;
            break;
         }
      }
      return { siteId: site.id, kind };
    },
    view:ctx=>({
      title:"A sealed room",
      text:`The last party to ${siteName(ctx.siteId)} found a wing nobody had forced — steel door, good lock, whatever that means it's guarding. Forcing it will eat crowbars and time.`,
      opts:[
        {label:"Force it", sub:"−3 scrap · the site will hold more", can:()=>S.res.scrap>=3},
        {label:"Leave it sealed", sub:"some doors keep"}
      ]
    }),
    resolve:(ctx,i)=>{
      if(i===0){
        S.res.scrap-=3;
        const st=S.sites[ctx.siteId];
        st.stock[ctx.kind]=(st.stock[ctx.kind]||0)+8; st.total0+=8;
        S.pending.push(`The sealed room at ${siteName(ctx.siteId)} gave way. Inside: a cache of ${ctx.kind}. Worth the crowbars.`);
      } else {
        S.pending.push(`The door at ${siteName(ctx.siteId)} stays shut. ${aliveName("kav","Someone")} approved. ${aliveName("bec","Someone else")} did not.`);
      }
    }
  },
  {
    id:"neighborsAsk",
    when:()=>S.res.meds>=3,
    roll:()=>({giftIn:8+Math.floor(Math.random()*8), giftGood:Math.random()<0.6}),
    view:()=>({
      title:"A runner from two valleys over",
      text:"A settlement you've never traded with sent a kid on a bicycle. Fever there, the bad kind, and their stores are empty. They ask for medicine. They can promise nothing back.",
      opts:[
        {label:"Send medicine", sub:"−3 meds · no promises", can:()=>S.res.meds>=3},
        {label:"Keep it", sub:"your own laid-up may need it"}
      ]
    }),
    resolve:(ctx,i)=>{
      if(i===0){
        S.res.meds-=3; S.giftDay=S.day+ctx.giftIn; S.giftGood=ctx.giftGood;
        S.neighborStanding = Math.min(5, (S.neighborStanding||0)+1);
        S.pending.push("The kid rode off with three days' worth of meds in a feed sack. That's all there is to say about it.");
      } else {
        const petra=byId("petra");
        const line = (petra && petra.status!=="away")
          ? "The kid rode off with an apology. Petra didn't say anything, which said plenty."
          : "The kid rode off with an apology. Nobody said anything, which said plenty.";
        S.pending.push(line);
      }
    }
  },
  {
    id:"theoRun",
    when:()=>{const t=byId("theo");return t&&t.status==="ok"&&SITE_DEF.some(d=>S.sites[d.id].discovered&&!S.sites[d.id].depleted);},
    roll:()=>{
      const cands=SITE_DEF.filter(d=>S.sites[d.id].discovered&&!S.sites[d.id].depleted);
      return {siteId:cands.sort((a,b)=>a.days-b.days)[0].id};
    },
    view:ctx=>{
      const d=siteDef(ctx.siteId);
      return {
        title:"Theo wants to run",
        text:`Theo says he can do ${siteName(ctx.siteId)} alone, overnight, faster than any party. He's laid out his route on the table like it settles the question. He's sixteen, and he's not wrong about being fast.`,
        opts:[
          {label:"Let him go", sub:`${Math.max(1,d.days-1)} days, alone · faster, riskier`,
           can:()=>{const t=byId("theo");return t&&t.status==="ok";}},
          {label:"Not alone, not yet", sub:"Theo takes it hard"}
        ]
      };
    },
    resolve:(ctx,i)=>{
      const t=byId("theo"), d=siteDef(ctx.siteId);
      if(i===0 && t && t.status==="ok"){
        t.status="away"; t.job="away";
        S.expeditions.push({id:S.expSeq++,type:"salvage",siteId:ctx.siteId,party:["theo"],daysLeft:Math.max(1,d.days-1),total:Math.max(1,d.days-1),injured:[],riskMult:1.5});
        S.pending.push("Theo left before anyone could change their mind, including him.");
      } else if(t){
        t.wb=clamp(t.wb-6,wbFloor(t),100);
        S.pending.push("Theo took the no like a door closing. He'll forgive the village. Eventually.");
      }
    }
  },
  {
    id:"quietGrief",
    when:()=>{const j=byId("june");return j&&j.status==="ok";},
    roll:()=>({}),
    view:()=>({
      title:"June, by the beds",
      text:"June sat by the garden beds long after dark, not working, just sitting. Some day this was, before. Nobody asked which.",
      opts:[
        {label:"Give her tomorrow", sub:"June rests; the beds wait"},
        {label:"Let her work through it", sub:"some people mend by doing"}
      ]
    }),
    resolve:(ctx,i)=>{
      const j=byId("june"); if(!j) return;
      if(i===0){
        j.job=null; j.wb=clamp(j.wb+8,wbFloor(j),100);
        S.pending.push("June took the day. In the evening she left a handful of dried flowers on the long table and said nothing about them.");
      } else {
        S.pending.push("June worked through it, the way she always has. The rows she weeded were very straight.");
      }
    }
  }
];
const eventDef=id=>EVENTS.find(e=>e.id===id);
const exWhere=ex=>ex.type==="explore"?"the far country":ex.type==="forage"?"the near country":siteName(ex.siteId);
function eventView(){ const d=eventDef(S.event.defId); return d?d.view(S.event.ctx):null; }

function maybeSpawnEvent(){
  if(S.event) return;
  if(S.eventCd>0){ S.eventCd--; return; }
  if(Math.random()>0.18) return;
  const elig=EVENTS.filter(e=>e.when());
  if(!elig.length) return;
  let choice=pick(elig);
  const stranger=elig.find(e=>e.id==="stranger") || elig.find(e=>e.id==="strangerProc");
  // reputation (hidden) nudges this ±10% around baseline -- 0.9x at the worst,
  // 1.1x at the best, combined multiplicatively with tower/bridge founding effects
  const repMult = 0.9 + 0.2*(S.reputation??0.55);
  if(stranger && Math.random()<0.3*((S.f||{}).strangerRate||1)*repMult) choice=stranger;
  S.event={defId:choice.id, ctx:choice.roll()};
}

function tickRelationships() {
  S.bonds = S.bonds || {};
  
  // 1. Working together (for jobs that allow multiple people, like garden/preserve)
  const jobs = {};
  for (const p of S.people) {
    if (p.job && p.status !== "away" && p.status !== "down") {
      if (!jobs[p.job]) jobs[p.job] = [];
      jobs[p.job].push(p.id);
    }
  }
  for (const [jobId, workers] of Object.entries(jobs)) {
    if (workers.length > 1) {
      modifyBonds(workers, 0.04); 
    }
  }

  // 2. Resting together in the Commons
  const resting = S.people.filter(p => p.job === null && p.status === "ok").map(p => p.id);
  if (resting.length > 1) {
    modifyBonds(resting, 0.03); // Slightly slower but much more common
  }

  // 3. Caretaker and Patient bonding
  const caretaker = S.people.find(p => p.job === "care" && p.status === "ok");
  if (caretaker) {
    const patients = S.people.filter(p => p.status === "down" || p.status === "spent").map(p => p.id);
    for (const pid of patients) {
      const key = [caretaker.id, pid].sort().join(":");
      S.bonds[key] = Math.min(10, (S.bonds[key] || 0) + 0.08); // Fast bonding through vulnerability
    }
  }
  for (const ex of S.expeditions) {
  // Only bond characters who are actually in the active party and not dead/gone
    const travelers = ex.party.filter(pid => byId(pid)); 
    if (travelers.length > 1) {
      // Surviving the road builds bonds quickly
      modifyBonds(travelers, 0.08); 
  }
}
}

function tickDinnerBonds(hunger, commonsCond) {
  if (hunger > 0 || commonsCond < 50) return; // No bonding during a cold, hungry night

  // Find everyone present in the village for dinner
  const diners = S.people
    .filter(p => p.status !== "away" && p.status !== "down")
    .map(p => p.id);

  if (diners.length <= 1) return;

  S.bonds = S.bonds || {};

  for (let i = 0; i < diners.length; i++) {
    for (let j = i + 1; j < diners.length; j++) {
      const key = [diners[i], diners[j]].sort().join(":");
      const currentBond = S.bonds[key] || 0;

      // Baseline dinner boost
      let boost = 0.02; 

      // If they already have a meaningful connection, the bond deepens faster
      if (currentBond > 1.0) {
        boost = 0.05; 
      }

      S.bonds[key] = Math.min(10, currentBond + boost);
    }
  }
}


function modifyBonds(ids, amt) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = [ids[i], ids[j]].sort().join(":");
      S.bonds[key] = Math.min(10, (S.bonds[key] || 0) + amt);
    }
  }
}


//put new functions here

function tickVillageSpiritsStreak() {
  if (!S.people.length) return;

  const avgWb = S.people.reduce((a, p) => a + p.wb, 0) / S.people.length;
  
  if (avgWb < 40) {
    S.lowSpiritsStreak = (S.lowSpiritsStreak || 0) + 1;
  } else {
    S.lowSpiritsStreak = 0; // The streak instantly breaks if spirits recover
  }
}

function tickDepartures(lines) {
  const SPIRITS_THRESHOLD = 35;
  const DAYS_TO_LEAVE = 10;
  const MIN_POPULATION_TO_LEAVE = 4; // Prevent total population collapse

  if (S.people.length <= MIN_POPULATION_TO_LEAVE) {
    // If the village is in absolute crisis, people stay to hold the line
    for (const p of S.people) {
      p.lowSpiritsDays = 0;
    }
    return;
  }

  for (const p of [...S.people]) {
    // We only track spirits for people currently present in the village
    if (p.status === "away") continue;

    if (p.wb < SPIRITS_THRESHOLD) {
      p.lowSpiritsDays = (p.lowSpiritsDays || 0) + 1;
    } else {
      // If their spirits recover, reset the counter slowly
      p.lowSpiritsDays = Math.max(0, (p.lowSpiritsDays || 0) - 1);
    }

    // Daily rolling chance to leave once consistent sadness is established
    if (p.lowSpiritsDays >= DAYS_TO_LEAVE) {
      const leaveChance = 0.35; // 35% chance to leave each day once they've had enough
      if (Math.random() < leaveChance) {
        S.people = S.people.filter(x => x.id !== p.id);
        S.departures = (S.departures || 0) + 1;
        
        // Remove them from any job they had so they don't linger in systems
        if (p.job) p.job = null;

        // Rest of the village takes a spirits hit from the quiet departure
        S.people.forEach(q => {
          if (q.status !== "away") q.wb = clamp(q.wb - 5, wbFloor(q), 100);
        });

        lines.push(`${p.name} packed ${poss(p)} things in the grey light before dawn and left. ${Cap(subj(p))} didn't leave a note, but everyone at the table knew why. The quiet is heavier today.`);
        
        S.journal.unshift({
          day: S.day,
          weather: S.weather,
          event: true,
          lines: [`${p.name} left the community due to low spirits.`, `— "We couldn't make a life here that ${subj(p)} wanted to share."`]
        });
      }
    }
  }
}










export { eventDef, eventView, exWhere, maybeSpawnEvent, tickDepartures, tickDinnerBonds, tickRelationships, tickVillageSpiritsStreak };
