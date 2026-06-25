# silent-round-results

A program that "backtabs" silent rounds in BP (British Parliamentary) debate tournaments: using the published draws, standings, and power-pairing logic to infer the hidden results.

## What's a silent round?

In most tournaments, one or more rounds are **silent** — the *draw* is released (you still need to know which room to go to), but the *results* aren't announced. So you debate, and then you're left guessing how you and everyone else actually did.

Here's the trick this tool is built on: the next round's draw quietly gives the secret away. Rounds are **power-paired**, meaning teams are matched against others on the same points. So if a silent round happened and then a new draw comes out, the rooms in that new draw line up teams by their (hidden) totals. Read the draw carefully and you can work backwards — *backtab* — to what must have happened.

## How it works

**Input**
- A link to the tournament on [Calicotab/Tabbycat](https://calicotab.com) — the tool reads the latest **standings** and the latest **draw** from it.
- *(Recommended)* the **draws of the silent rounds** themselves. These aren't always still public, so you can add them as saved files, screenshots, or by typing them in. They're optional, but they make the results much more precise (more on that below).

**Processing**
- The tool lines up every team by their points, then uses the new draw plus power-pairing to figure out which result each team must have gotten to end up where they are.
- It checks everything for consistency across the whole tournament at once — every room handed out a 1st, 2nd, 3rd and 4th, and the totals all have to add up — so the answers fit together rather than being guessed team-by-team.

**Output**
- Each team's most likely result in the silent round(s).
- Where the draw alone doesn't fully give it away, you get a **best guess plus the odds** (e.g. "probably a 1st, but possibly a 2nd") instead of a falsely confident answer.

## Example: one silent round

Say it's a 5-round tournament and **Round 4 is silent**. You finished Round 3 on 4 points. The Round 5 draw comes out and puts you up against a team on 7 points.

For you both to be in the same room, you must have equal totals after Round 4 — so you most likely **took a 1st in Round 4** (+3, taking you to 7) and they **took a 4th** (+0, keeping them at 7). That's the whole idea, and the tool does this for every team automatically.

## Example: several silent rounds (WUDC / EUDC)

Big tournaments like **WUDC** and **EUDC** run 9 rounds, with the **last three silent**. That's harder, because there can be two hidden rounds between the last known standings and the draw you're reading.

When that happens, the draw tells you a team's **combined** swing across both hidden rounds — for instance "you gained 4 points over Rounds 7 and 8" — but not exactly how it split (was it a 1st then a 2nd, or a 2nd then a 1st?). The tool reports that combined figure clearly, and if you feed it the **in-between silent-round draw** as well, it can pull the two rounds apart and tell you each one separately. This is why adding the silent-round draws is recommended: each one you give it sharpens the picture.

One honest limit: the **very last silent round can't be worked out**, because there's no later draw to give it away.

## Good to know

- Works only for tournaments run on **Calicotab / Tabbycat**.
- If you're at the very top or bottom of the standings, your results are usually obvious anyway (you're clearly breaking, or clearly not), so the tool is most useful for everyone in between.
