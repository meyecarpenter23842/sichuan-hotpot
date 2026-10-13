import http from "node:http";
/** CI only: isolated local Resend-compatible sink; never a production sender. */
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("CI-only mail sandbox");
const inbox = new Map();
http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/emails") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10000) { res.writeHead(413).end(); return; }
    }
    try {
      const obj = JSON.parse(body);
      const code = /Mã xác minh của bạn: ([0-9]{6})/.exec(obj.text)?.[1];
      const email = obj.to?.[0];
      if (!code || typeof email !== "string") { res.writeHead(400).end(); return; }
      inbox.set(email, code);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "ci-only" }));
    } catch { res.writeHead(400).end(); }
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/test/inbox?to=")) {
    const email = new URL(req.url, "http://127.0.0.1:3333").searchParams.get("to");
    const code = inbox.get(email);
    res.writeHead(code ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(code ? { code } : { error: "not-yet-sent" }));
    return;
  }
  res.writeHead(404).end();
}).listen(3333, "127.0.0.1", () => console.log("CI email sandbox listening"));
