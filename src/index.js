export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/p/")) {
      return new Response("Not found", { status: 404 });
    }

    const parts = url.pathname.split("/").filter(Boolean); // ["p","client-abc",...]
    const clientSlug = parts[1] || "";
    if (!clientSlug) return new Response("Missing preview id", { status: 400 });

    const debug = url.searchParams.get("debug") === "1";
    const now = Math.floor(Date.now() / 1000);

    // Global kill switch
    if (env.GLOBAL_OFF === "1") {
      return disabledPage("Preview temporarily unavailable.");
    }

    // ---- KV lookup (fail-closed) ----
    let raw = null;
    let keyUsed = null;

    if (env.KILLSWITCH) {
      const v1 = await env.KILLSWITCH.get(clientSlug);
      const v2 = await env.KILLSWITCH.get(`p/${clientSlug}`);
      raw = v1 ?? v2;
      keyUsed = v1 != null ? clientSlug : (v2 != null ? `p/${clientSlug}` : null);
    }

    // If you want fail-closed: NO KV entry => disabled
    if (!raw) {
      if (debug) {
        return new Response(
          JSON.stringify(
            {
              ok: false,
              reason: "No KV entry found (fail-closed)",
              clientSlug,
              lookedUp: [clientSlug, `p/${clientSlug}`],
              keyUsed,
              raw,
              now,
              hasKVBinding: !!env.KILLSWITCH,
              hasPagesOrigin: !!env.PAGES_ORIGIN,
            },
            null,
            2
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return disabledPage("This preview is not enabled.");
    }

    // Parse KV value
    const parsed = parseKV(raw);
    const status = String(parsed?.status || "").toLowerCase();
    const expiresAt = Number(parsed?.expiresAt || 0);

    if (debug) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            clientSlug,
            keyUsed,
            raw,
            parsed,
            status,
            expiresAt,
            now,
            expired: !!expiresAt && now >= expiresAt,
            hasKVBinding: !!env.KILLSWITCH,
            pagesOrigin: env.PAGES_ORIGIN || null,
          },
          null,
          2
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (status === "off") return disabledPage("This preview has been turned off.");
    if (expiresAt && now >= expiresAt) return disabledPage("This preview link has expired.");

    // ---- Proxy to Pages ----
    const origin = env.PAGES_ORIGIN;
    if (!origin) return new Response("Missing PAGES_ORIGIN", { status: 500 });

    const targetUrl = new URL(origin);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;

    const resp = await fetch(new Request(targetUrl.toString(), request));

    const headers = new Headers(resp.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(resp.body, { status: resp.status, headers });
  },
};

function parseKV(raw) {
  const s = String(raw).trim();

  // Legacy: "off"
  if (s.toLowerCase() === "off") return { status: "off" };

  // Normal JSON
  try {
    return JSON.parse(s);
  } catch {}

  // Double-encoded JSON: "\"{...}\""
  try {
    const once = JSON.parse(s);
    if (typeof once === "string") return JSON.parse(once);
  } catch {}

  // If unknown, default “on”
  return { status: "on" };
}

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
