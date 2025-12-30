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
      return disabledPage(env, "Preview temporarily unavailable.");
    }

    // ---- KV lookup (fail-closed) ----
    let raw = null;
    let keyUsed = null;

    if (env.KILLSWITCH) {
      const v1 = await env.KILLSWITCH.get(clientSlug);
      const v2 = await env.KILLSWITCH.get(`p/${clientSlug}`);
      raw = v1 ?? v2;
      keyUsed =
        v1 != null ? clientSlug : v2 != null ? `p/${clientSlug}` : null;
    }

    // Fail-closed: NO KV entry => disabled
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
              hasStripeUrl: !!env.STRIPE_CHECKOUT_URL,
            },
            null,
            2
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return disabledPage(env, "This preview is not enabled.");
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
            stripeCheckoutUrl: env.STRIPE_CHECKOUT_URL ? "set" : "missing",
          },
          null,
          2
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (status === "off") return disabledPage(env, "This preview has been turned off.");
    if (expiresAt && now >= expiresAt) return disabledPage(env, "This preview link has expired.");

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

function disabledPage(env, message) {
  // Set these in Worker → Settings → Variables
  // STRIPE_CHECKOUT_URL = https://buy.stripe.com/28E6oH7Zq4GObxF91F08g00
  // HOME_URL = https://golivelocal.ca (optional)
  const stripeUrl = env.STRIPE_CHECKOUT_URL || "https://golivelocal.ca";
  const homeUrl = env.HOME_URL || "https://golivelocal.ca";

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Preview Locked</title>
  <meta name="robots" content="noindex,nofollow"/>
  <style>
    :root{
      --bg:#0b1220;
      --card: rgba(255,255,255,.06);
      --line: rgba(255,255,255,.10);
      --text:#eaf0ff;
      --muted:#a7b0c0;
      --primary:#2563eb;
      --accent:#f59e0b;
      --shadow: 0 24px 70px rgba(0,0,0,.45);
      --r: 22px;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color:var(--text);
      min-height:100vh;
      display:grid;
      place-items:center;
      background:
        radial-gradient(900px 520px at 20% -10%, rgba(37,99,235,.30), transparent 60%),
        radial-gradient(900px 520px at 90% 0%, rgba(245,158,11,.22), transparent 55%),
        radial-gradient(900px 700px at 55% 110%, rgba(37,99,235,.18), transparent 55%),
        var(--bg);
      padding:22px;
    }
    .wrap{width:min(720px, 100%);}
    .card{
      background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
      border:1px solid var(--line);
      border-radius: var(--r);
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .top{
      padding:20px 22px;
      border-bottom:1px solid var(--line);
      display:flex;
      gap:12px;
      align-items:center;
      justify-content:space-between;
      flex-wrap:wrap;
    }
    .badge{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:10px 12px;
      border-radius:999px;
      background: rgba(255,255,255,.06);
      border:1px solid var(--line);
      color:var(--muted);
      font-weight:800;
      font-size:13px;
    }
    .body{padding:22px;}
    h1{margin:0 0 8px; font-size:28px; letter-spacing:-.4px;}
    p{margin:0; color:var(--muted); font-weight:650; line-height:1.55;}
    .grid{
      display:grid;
      gap:14px;
      grid-template-columns: 1fr 1fr;
      margin-top:18px;
    }
    .panel{
      background: rgba(255,255,255,.04);
      border:1px solid var(--line);
      border-radius: 18px;
      padding:16px;
    }
    .panel h3{margin:0 0 6px; font-size:15px;}
    .panel ul{margin:10px 0 0; padding:0; list-style:none;}
    .panel li{display:flex; gap:10px; padding:8px 0; color:var(--muted); font-weight:650;}
    .check{
      width:22px; height:22px; border-radius:8px;
      background: rgba(245,158,11,.18);
      border:1px solid rgba(245,158,11,.26);
      display:grid; place-items:center;
      color:#ffd28a;
      flex:0 0 22px;
      font-weight:900;
    }
    .actions{
      display:flex;
      gap:12px;
      flex-wrap:wrap;
      margin-top:18px;
    }
    .btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      padding:12px 14px;
      border-radius:999px;
      border:1px solid var(--line);
      background: rgba(255,255,255,.06);
      color:var(--text);
      font-weight:900;
      text-decoration:none;
      transition:.15s ease;
      white-space:nowrap;
    }
    .btn:hover{transform: translateY(-1px); background: rgba(255,255,255,.09);}
    .btn-primary{
      background: linear-gradient(135deg, var(--primary), #3b82f6);
      border-color: transparent;
    }
    .btn-primary:hover{filter:saturate(1.05);}
    .fine{margin-top:12px; font-size:12px; color:rgba(167,176,192,.9);}
    @media (max-width: 720px){
      .grid{grid-template-columns:1fr;}
      h1{font-size:24px;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="badge">🔒 Preview Locked</div>
        <div class="badge">⚡ Instant unlock</div>
      </div>
      <div class="body">
        <h1>This preview is unavailable</h1>
        <p>${escapeHtml(message)}</p>

        <div class="grid">
          <div class="panel">
            <h3>Unlock this website</h3>
            <p style="margin:0;color:var(--muted);font-weight:650">Get the full live version + edits.</p>
            <ul>
              <li><span class="check">✓</span> Live on your domain</li>
              <li><span class="check">✓</span> Mobile optimized</li>
              <li><span class="check">✓</span> Fast turnaround</li>
            </ul>
          </div>
          <div class="panel">
            <h3>Prefer to talk first?</h3>
            <p style="margin:0;color:var(--muted);font-weight:650">We can confirm details and launch.</p>
            <ul>
              <li><span class="check">✓</span> Quick call</li>
              <li><span class="check">✓</span> Clear pricing</li>
              <li><span class="check">✓</span> Simple process</li>
            </ul>
          </div>
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="${escapeHtml(stripeUrl)}">💳 Pay & Unlock Now</a>
          <a class="btn" href="${escapeHtml(homeUrl)}">🌐 Visit GoLiveLocal</a>
        </div>

        <div class="fine">If you already paid, reply “PAID” to the last message and we’ll re-enable access.</div>
      </div>
    </div>
  </div>
</body>
</html>`,
    {
      status: 403,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
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
