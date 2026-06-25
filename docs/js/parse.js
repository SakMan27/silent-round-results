// parse.js
// Pure parsing layer for Calicotab / Tabbycat pages.
//
// Tabbycat renders every table (draws, standings, participants) into the page
// as a server-side template variable:  window.vueData = { tablesData: [ ... ] }.
// That JSON is the untruncated source of truth — far cleaner than scraping the
// rendered DOM. This module extracts it and shapes it into the structures the
// solver consumes. No DOM dependency, so it runs identically in the browser and
// in Node (for tests).
//
// Canonical key for every team is its numeric Tabbycat team ID (from the
// /participants/team/<id>/ link in each cell's popover), NOT its display name.
// Names are chaotic (emoji, duplicates, unicode); IDs are stable across pages.

const POS = ["OG", "OO", "CG", "CO"]; // BP positions, in draw-column order

// ---------------------------------------------------------------------------
// Low-level: pull the tablesData JSON array out of a saved/fetched page.
// ---------------------------------------------------------------------------

export function extractTablesData(html) {
  const anchor = html.indexOf("tablesData");
  if (anchor === -1) {
    throw new ParseError(
      "No tablesData found. Is this a Calicotab/Tabbycat page (draw, standings, or participants)?"
    );
  }
  const arrStart = html.indexOf("[", anchor);
  if (arrStart === -1) throw new ParseError("Malformed tablesData: no array start.");

  // Bracket-match while respecting JSON string literals + escapes.
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new ParseError("Malformed tablesData: unbalanced brackets.");

  const raw = html.slice(arrStart, end + 1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ParseError("tablesData is not valid JSON: " + e.message);
  }
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function teamIdFromCell(cell) {
  const pop = cell && cell.popover;
  if (!pop || !Array.isArray(pop.content)) return null;
  for (const item of pop.content) {
    const link = item && item.link;
    if (typeof link === "string") {
      const m = link.match(/\/participants\/team\/(\d+)\//);
      if (m) return m[1];
    }
  }
  return null;
}

function isTeamCell(cell) {
  return cell && typeof cell.class === "string" && cell.class.includes("team-name");
}

// A team's display identity. `emoji` is already a separate field in the JSON,
// so on this path we never have to strip it out of the name. `text` is the full
// untruncated name (the visual "..." truncation is pure CSS).
function teamIdentity(cell) {
  return {
    id: teamIdFromCell(cell),
    name: (cell.text || "").trim(),
    emoji: cell.emoji || "",
    speakers: speakersFromCell(cell),
  };
}

function speakersFromCell(cell) {
  const pop = cell && cell.popover;
  if (!pop || !Array.isArray(pop.content) || !pop.content.length) return "";
  // First popover line is the speaker list; later lines are "View record" links.
  const first = pop.content[0];
  if (first && typeof first.text === "string" && !first.link) return first.text.trim();
  return "";
}

// ---------------------------------------------------------------------------
// Per-round result cells in the STANDINGS table carry a popover describing the
// whole room: "Teams in debate:<br />A (OG)<br /><strong>Me (OO)</strong>..."
// plus a title like "Placed 1st". We parse both: the placement (-> points) and
// the room composition (-> exact open-round draw, for free).
// ---------------------------------------------------------------------------

const PLACE_TO_POINTS = { "1st": 3, "2nd": 2, "3rd": 1, "4th": 0 };

function parseRoundResultCell(cell) {
  if (!cell || !cell.popover) return null; // "—" / didn't play
  const title = cell.popover.title || "";
  const pm = title.match(/Placed\s+(\d(?:st|nd|rd|th))/i);
  const place = pm ? pm[1].toLowerCase() : null;
  const points = place ? PLACE_TO_POINTS[place] : null;

  let room = [];
  const content = cell.popover.content || [];
  if (content[0] && typeof content[0].text === "string") {
    // Each "<name> (POS)" entry; the team itself is wrapped in <strong>.
    const re = /(?:<strong>)?\s*(.*?)\s*\((OG|OO|CG|CO)\)\s*(?:<\/strong>)?/g;
    const text = content[0].text;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].replace(/<\/?strong>/g, "").replace(/&amp;/g, "&").trim();
      room.push({ name, pos: m[2] });
    }
  }
  return { place, points, room };
}

// ---------------------------------------------------------------------------
// Public: parse a STANDINGS page.
// ---------------------------------------------------------------------------

export function parseStandings(html) {
  const tables = extractTablesData(html);
  const t = tables[0];
  const head = t.head.map((h) => h.title || h.tooltip || h.key);

  // Which columns are per-round result columns (R1, R2, ...)?
  const roundCols = [];
  head.forEach((label, idx) => {
    const m = String(label).match(/^R(\d+)$/i);
    if (m) roundCols.push({ idx, round: Number(m[1]) });
  });
  const pointsIdx = head.findIndex((l) => /point/i.test(l));

  const teams = {};
  for (const row of t.data) {
    const teamCell = row.find(isTeamCell) || row[0];
    const ident = teamIdentity(teamCell);
    if (!ident.id) continue; // skip anything without a resolvable team ID

    const pointsCell = pointsIdx >= 0 ? row[pointsIdx] : null;
    const points =
      pointsCell != null
        ? Number(pointsCell.sort != null ? pointsCell.sort : pointsCell.text)
        : null;

    const perRound = {};
    for (const { idx, round } of roundCols) {
      perRound[round] = parseRoundResultCell(row[idx]);
    }

    teams[ident.id] = { ...ident, points, perRound };
  }

  return {
    kind: "standings",
    roundsShown: roundCols.map((c) => c.round).sort((a, b) => a - b),
    teams,
  };
}

// ---------------------------------------------------------------------------
// Public: parse a DRAW page into rooms of four positioned teams.
// ---------------------------------------------------------------------------

export function parseDraw(html, roundHint = null) {
  const tables = extractTablesData(html);
  const t = tables[0];
  const head = t.head.map((h) => h.title || h.key);

  // Map header columns to BP positions by their label.
  const posIdx = {};
  head.forEach((label, idx) => {
    if (POS.includes(label)) posIdx[label] = idx;
  });

  const rooms = [];
  for (const row of t.data) {
    const venueCell = row.find((c) => c && c.class === "venue-name");
    const room = {
      venue: venueCell ? (venueCell.text || "").trim() : null,
      teams: [],
    };
    for (const pos of POS) {
      const idx = posIdx[pos];
      if (idx == null) continue;
      const cell = row[idx];
      if (!isTeamCell(cell)) continue;
      const ident = teamIdentity(cell);
      if (ident.id) room.teams.push({ ...ident, pos });
    }
    if (room.teams.length) rooms.push(room);
  }

  return { kind: "draw", round: roundHint ?? detectRoundFromHtml(html), rooms };
}

function detectRoundFromHtml(html) {
  // Best-effort: the <title> / page heading usually says "Draw for Round N".
  const m = html.match(/Draw for Round\s+(\d+)/i) || html.match(/Round\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(msg) { super(msg); this.name = "ParseError"; }
}

export const _internals = { teamIdFromCell, parseRoundResultCell, POS };
