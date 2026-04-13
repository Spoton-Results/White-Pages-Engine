const https = require("https");
const http = require("http");

const TARGET_HOST = process.env.NEXUS_ORIGIN || "sospages.replit.app";
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const clientHost = (req.headers["x-forwarded-host"] || req.headers.host || "").split(":")[0];

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET_HOST,
      "x-forwarded-host": clientHost,
      "x-forwarded-proto": "https",
    },
  };

  const proxy = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on("error", () => {
    res.writeHead(502);
    res.end("Bad Gateway");
  });

  req.pipe(proxy, { end: true });
});

server.listen(PORT, () => console.log(`Nexus proxy listening on port ${PORT} → ${TARGET_HOST}`));
