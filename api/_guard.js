// Shared server-side guard for AI endpoints. Leading underscore => never served.
// Security: key + provider URL stay in Vercel env only. Never logged, never echoed.

const buckets = new Map(); // best-effort per-IP rate limit (resets per instance)

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function rateLimited(ip, limit, windowMs) {
  const now = Date.now();
  let rec = buckets.get(ip);
  if (!rec || now - rec.start > windowMs) {
    rec = { start: now, count: 0 };
    buckets.set(ip, rec);
  }
  rec.count += 1;
  return rec.count > limit;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("too-large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(new Error("bad-json"));
      }
    });
    req.on("error", () => reject(new Error("bad-json")));
  });
}

function provider() {
  const baseURL = process.env.MODEL_BASE_URL || "";
  const apiKey = process.env.MODEL_API_KEY || "";
  const model = process.env.MODEL_NAME || "";
  if (!baseURL || !apiKey || !model) return null;
  return { baseURL: baseURL.replace(/\/+$/, ""), apiKey, model };
}

async function chatJson(baseURL, apiKey, model, system, user, maxTokens, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!resp.ok) throw new Error(`upstream-${resp.status}`);
    const data = await resp.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error("upstream-empty");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { clientIp, rateLimited, readJsonBody, provider, chatJson };
