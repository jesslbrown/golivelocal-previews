export default {
  async fetch(request, env) {
    // KILL SWITCH (true = allow, false = block)
    const isLive = (env.LIVE ?? "true").toLowerCase() === "true";

    if (!isLive) {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Preview Disabled</title>
            <style>
              body{font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#111827}
              .card{max-width:520px;padding:28px;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
              h1{margin:0 0 8px;font-size:22px}
              p{margin:0;color:#6b7280;line-height:1.5}
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Preview disabled</h1>
              <p>This preview link is currently turned off.</p>
            </div>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" }, status: 403 }
      );
    }

    // When live, just proxy through to the real Pages site
    const target = env.TARGET_URL; // e.g. https://client-preview.pages.dev
    if (!target) return new Response("Missing TARGET_URL", { status: 500 });

    const url = new URL(request.url);
    const upstream = new URL(target);
    upstream.pathname = url.pathname;
    upstream.search = url.search;

    const newReq = new Request(upstream.toString(), request);
    return fetch(newReq);
  },
};
