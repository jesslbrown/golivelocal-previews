export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only allow /p/... previews
    if (!url.pathname.startsWith("/p/")) {
      return new Response("Not found", { status: 404 });
    }

    // /p/<client>/...
    const parts = url.pathname.split("/").filter(Boolean);
    const clientSlug = parts[1] || "";

    if (!clientSlug) {
      return new Response("Missing preview id", { status: 400 });
    }

    // Global kill switch
    if (env.GLOBAL_OFF === "1") {
      return disabledPage("Preview temporarily unavailable.");
    }

    let debugInfo = null;

    // Per-client kill switch (KV)
    if (env.KILLSWITCH) {
      // IMPORTANT: disable KV edge caching so updates apply immediately
      const v1 = await env.KILLSWITCH.get(clientSlug, { cacheTtl: 0 });
      const v2 = await env.KILLSWITCH.get(`p/${clientSlug}`, { cacheTtl: 0 });
      const raw = v1 ?? v2;

      debugInfo = { keyTried1: clientSlug, keyTried2: `p/${clientSlug}`, raw };

      if (raw) {
        // Simple legacy: "off"
        if (String(raw).trim().toLowerCase() === "off") {
          return disabledPage("This preview has been turned off.");
        }

        // JSON: {"status":"on|off","expiresAt":<unix seconds>}
        try {
          const obj = JSON.parse(raw);
          const status = String(obj.status || "").toLowerCase();
          const expiresAt = Number(obj.expiresAt || 0);
          const now = Math.floor(Date.now() / 1000);

          debugInfo.parsed = { status, expiresAt, now, expired: !!(expiresAt && now >= expiresAt) };

          if (status === "off") {
            return disabledPage("This preview has been turned off.");
          }

          if (expiresAt && now >= expiresAt) {
            return disabledPage("This preview link has expired.");
          }
        } catch (e) {
          // If it's not JSON and not "off", treat as "on"
          debugInfo.parseError = String(e);
        }
      }
    }

    // DEBUG: visit ?debug=1 to see what the Worker reads from KV
    // (Remove this block once you’re done testing)
    if (url.searchParams.get("debug") === "1") {
      return new Response(JSON.stringify({ clientSlug, debugInfo }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Proxy to Pages origin
    const origin = env.PAGES_ORIGIN; // https://golivelocal-previews.pages.dev
    if (!origin) {
      return new Response("Missing PAGES_ORIGIN", { status: 500 });
    }

    const targetUrl = new URL(origin);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;

    const newReq = new Request(targetUrl.toString(), request);
    const resp = await fetch(newReq);

    const headers = new Headers(resp.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    });
  },
};

function disabledPage(message) {
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preview disabled</title>
<style>
  body{font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#111827}
  .card{max-width:520px;padding:24px;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 12px 30px rgba(17,24,39,.08)}
  .btn{display:inline-block;margin-top:12px;padding:10px 14px;border-radius:999px;background:#2563EB;color:#fff;text-decoration:none;font-weight:800}
</style></head>
<body>
  <div class="card">
    <h1 style="margin:0 0 8px">Preview unavailable</h1>
    <p style="margin:0;color:#6b7280">${escapeHtml(message)}</p>
    <a class="btn" href="https://golivelocal.ca">GoLive Local</a>
  </div>
</body></html>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
