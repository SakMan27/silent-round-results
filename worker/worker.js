// worker.js — a tiny CORS proxy for Calicotab/Tabbycat pages.
//
// Why this exists: GitHub Pages is static, and a browser there can't fetch
// calicotab.com directly (cross-origin requests are blocked). A server can,
// though — so this Worker fetches the page server-side and returns it to the
// app with permissive CORS headers. It only proxies calicotab hosts, so it
// can't be abused as an open proxy.
//
// Deploy: Cloudflare dashboard → Workers & Pages → Create Worker → paste this →
// Deploy. Copy the resulting *.workers.dev URL into the app's config.

const ALLOWED_HOST = /(^|\.)calicotab\.com$/i;

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return withCors(jsonError("Missing ?url= parameter", 400));

    let t;
    try { t = new URL(target); } catch { return withCors(jsonError("Invalid url", 400)); }

    if (t.protocol !== "https:" || !ALLOWED_HOST.test(t.hostname)) {
      return withCors(jsonError("Only https calicotab.com hosts are allowed", 403));
    }

    try {
      const upstream = await fetch(t.toString(), {
        headers: { "User-Agent": "silent-round-results/0.1 (+github pages app)" },
        redirect: "follow",
      });
      // Re-emit with our own headers (upstream headers are immutable).
      return withCors(new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "text/html; charset=utf-8" },
      }));
    } catch (e) {
      return withCors(jsonError("Upstream fetch failed: " + String(e), 502));
    }
  },
};

function withCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
