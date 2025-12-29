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
              body{
                font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
                margin:0;
                display:grid;
                place-items:center;
                min-height:100vh;
                background:#ffffff;
                color:#111827;
              }
              .card{
                max-width:520px;
                padding:28px;
                border:1px solid #e5e7eb;
                border-radius:18px;
                box-shadow:0 10px 30px rgba(0,0,0,.06);
                text-align:center;
              }
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
        {
          status: 403,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      );
    }

    // Proxy traffic to your Pages site when LIVE=true
    const target = env.TARGET_URL;
    if (!target) {
      return new Response("Missing TARGET_URL environment variable", {
        status: 500,
      });
    }

    const url = new URL(request.url);
    const upstream = new URL(target);
    upstream.pathname = url.pathname;
    upstream.search = url.search;

    const newRequest = new Request(upstream.toString(), request);
    return fetch(newRequest);
  },
};
