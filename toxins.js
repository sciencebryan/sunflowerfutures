/* ================= toxins =================
   Cumulative lifetime exposure, not acute poisoning. One undifferentiated
   number per person — no distinction between kinds of toxin, deliberately.
   It only ever goes up, it goes up slowly, and it never announces itself.
   What it touches, and nothing else:
     - how fast practice accrues (a dulled person learns slower)
     - how often illness finds someone
     - the elder death roll

   Nobody in the village can measure this. It is never rendered outside the
   dev Ledger, and there is no test for it — the only signal available to
   the player is that people who drank from a bad well have worse years
   later, which is exactly the shape of the real thing.

   Scale: 0 is untouched, 100 is a lifetime of drinking something you
   shouldn't have. Import-light on purpose so day.js can use it freely. */

const TOX_CAP = 100;

// Normalized load, 0..1. Slightly concave — the first exposure matters more
// than the last, which keeps a long-lived villager from being a walking
// catastrophe just for having been around.
const toxLoad = p => Math.pow(Math.min(TOX_CAP, p.toxins || 0) / TOX_CAP, 0.85);

/* --- the three effects --- */
// practice: at full load, learning runs at 55% speed
const toxPracticeMult = p => 1 - 0.45 * toxLoad(p);
// illness: at full load, more than twice as likely to be the one who wakes ill
const toxSickMult     = p => 1 + 1.4 * toxLoad(p);
// death: at full load, +7 points on the elder's annual roll
const toxDeathAdd     = p => 0.07 * toxLoad(p);

/* --- accrual ---
   Called once a day from simulateDay. `wellShare` is the fraction of the
   day's water that came up out of the ground (0 when the well is off or
   unbuilt), `contam` is S.groundwaterContam.

   RATE is set against a 120-day year. Drinking a moderately fouled supply
   (contam 30) adds about 2 points a year — thirty years of it gets you to
   ~60, which is a real cost late in a life and invisible early in one. A
   badly fouled table (contam 70) does the same damage in a decade.
   Children accrue at the same rate; they simply have longer to do it. */
const TOX_RATE = 0.00055;

function accrueToxins(people, wellShare, contam) {
  if (!wellShare || !contam) return;
  const daily = TOX_RATE * wellShare * contam;
  for (const p of people) {
    if (p.status === "away") continue;   // drinking somewhere else today
    p.toxins = Math.min(TOX_CAP, (p.toxins || 0) + daily);
  }
}

export { TOX_CAP, accrueToxins, toxDeathAdd, toxLoad, toxPracticeMult, toxSickMult };
