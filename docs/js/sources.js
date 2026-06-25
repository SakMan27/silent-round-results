// sources.js — turn a pasted tournament link into fetched, parsed data.
//
// The two required inputs (current standings + current draw) live at FIXED
// public paths, so there's no round number to guess. We derive those URLs from
// whatever tournament link the user pastes, fetch them through the proxy
// Worker (CORS), and run the HTML through the parser we already have.

import { parseStandings, parseDraw } from "./parse.js";

// Fixed public paths, relative to the tournament base ".../<slug>/".
// (These match Calicotab's standard public pages; adjust here if an instance
// differs, and we fall back to manual upload either way.)
const PATHS = {
  standings: "tab/current-standings/",
  draw: "draw/",
  participants: "participants/list/",
};

// Known Tabbycat page segments that appear *after* the tournament base. If the
// pasted link already points into one of these, we cut back to the base before
// it — so we never blindly append to a URL that's already a page within the
// tournament (e.g. ".../srbp2024/tab/current-standings/").
const PAGE_SEGMENTS = new Set([
  "draw", "tab", "standings", "participants", "results", "break", "motions",
  "feedback", "availability", "round", "info-slide", "admin", "assistant",
  "api", "privateurls",
]);

// From any page URL within a tournament, recover the tournament base.
//   .../srbp2024/                        -> .../srbp2024/
//   .../srbp2024/draw/                   -> .../srbp2024/
//   .../srbp2024/tab/current-standings/  -> .../srbp2024/   (multi-segment page)
//   example.com/tabbycat/srbp2024/draw/  -> example.com/tabbycat/srbp2024/ (path-mounted)
export function tournamentBase(pastedUrl) {
  let u;
  try { u = new URL(pastedUrl.trim()); }
  catch { throw new Error("That doesn't look like a valid link."); }

  const segments = u.pathname.split("/").filter(Boolean);

  // Everything before the first recognised page segment is the base path
  // (origin + any mount path + the tournament slug).
  const cut = segments.findIndex((s) => PAGE_SEGMENTS.has(s.toLowerCase()));
  const baseSegments = cut === -1 ? segments : segments.slice(0, cut);

  const path = baseSegments.length ? "/" + baseSegments.join("/") + "/" : "/";
  return u.origin + path;
}

export function derivedUrls(pastedUrl) {
  const base = tournamentBase(pastedUrl);
  return {
    base,
    standings: base + PATHS.standings,
    draw: base + PATHS.draw,
    participants: base + PATHS.participants,
  };
}

// Fetch a target page through the proxy Worker.
export async function fetchViaWorker(workerUrl, targetUrl) {
  const endpoint = workerUrl.replace(/\/+$/, "") + "/?url=" + encodeURIComponent(targetUrl);
  let res;
  try { res = await fetch(endpoint); }
  catch (e) { throw new Error("Couldn't reach the proxy. Is the Worker URL correct? (" + e + ")"); }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
    throw new Error(`Fetch failed (${res.status})${detail ? ": " + detail : ""}`);
  }
  return await res.text();
}

// Load the two required pages from a pasted link and parse them.
export async function loadTournament(pastedUrl, workerUrl) {
  if (!workerUrl) throw new Error("No proxy configured yet — set the Worker URL, or upload the pages instead.");
  const urls = derivedUrls(pastedUrl);

  const [standingsHtml, drawHtml] = await Promise.all([
    fetchViaWorker(workerUrl, urls.standings),
    fetchViaWorker(workerUrl, urls.draw),
  ]);

  return {
    urls,
    standings: parseStandings(standingsHtml),
    draw: parseDraw(drawHtml),
  };
}
