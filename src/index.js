export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 🔴 TEMP TEST — put this FIRST
    return new Response("Worker is running ✅", { status: 200 });

    // Only allow /p/... previews (optional safety)
    if (!url.pathname.startsWith("/p/")) {
      return new Response("Not found", { status: 404 });
    }

    // Parse client slug from /p/<client>/...
    const parts = url.pathname.split("/").filter(Boolean); // ["p","client-abc",...]
    const clientSlug = parts[1] || "";

    if (!clientSlug) {
      return new Response("Missing preview id", { status: 400 });
    }

    // ---- Kill switches (simple version) ----
    // Global kill switch via env var
    if (env.GLOBAL_OFF === "1") {
      return disabledPage("Preview temporarily unavailable.");
    }

    // Per-client kill using KV (optional)
    // If you set up KV binding called KILLSWITCH, you can use this:
    if (env.KILLSWITCH) {
      const status = await env.KILLSWITCH.get(clientSlug); // "off" or "on"
      if (status === "off") {
        return disabledPage("This preview has been turned off.");
      }
    }

    // ---- Proxy to Pages origin ----
    const origin = env.PAGES_ORIGIN; // e.g. https://golivelocal-previews.pages.dev
    if (!origin) {
      return new Response("Missing PAGES_ORIGIN", { status: 500 });
    }

    const targetUrl = new URL(origin);
    targetUrl.pathname = url.pathname; // keep /p/client-abc/...
    targetUrl.search = url.search;

    // Forward request (method, headers, body)
    const newReq = new Request(targetUrl.toString(), request);

    // Fetch from Pages
    const resp = await fetch(newReq);

    // Optional: reduce caching surprises while testing
    const newHeaders = new Headers(resp.headers);
    newHeaders.set("Cache-Control", "no-store");

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: newHeaders,
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
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
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

