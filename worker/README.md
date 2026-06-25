# The proxy Worker

GitHub Pages can't fetch calicotab.com directly (browsers block cross-site
requests — "CORS"). This little Worker runs on Cloudflare's free tier, fetches
the page for us server-side, and returns it to the app. It only ever fetches
`calicotab.com` addresses, so it can't be misused as a general proxy.

## Deploy (no command line needed)

1. Make a free account at https://dash.cloudflare.com.
2. In the sidebar: **Workers & Pages → Create → Create Worker**.
3. Give it a name (e.g. `silent-round-proxy`) and click **Deploy** to make the
   starter worker.
4. Click **Edit code**. Delete everything in the editor, paste the contents of
   [`worker.js`](./worker.js), and click **Deploy** again.
5. Copy the Worker's URL — it looks like
   `https://silent-round-proxy.<your-subdomain>.workers.dev`.
6. Paste that URL into the app's "Proxy URL" box (later we'll hard-code it).

## Test it

Open this in your browser (replace with your Worker URL):

```
https://silent-round-proxy.<you>.workers.dev/?url=https://counterfactualhst.calicotab.com/srbp2024/draw/
```

You should see the raw HTML of the draw page. If you get a JSON `error`
instead, the message will say what went wrong.

## Free tier

Cloudflare's free plan allows 100,000 requests/day — far more than this tool
will ever use (each tournament load is ~2 requests).
