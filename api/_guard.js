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

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("bad-shape");
    return JSON.parse(text.slice(start, end + 1));
  }
}

async function postChat(baseURL, apiKey, model, system, user, maxTokens, timeoutMs, structured) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const payload = {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    };
    if (structured) payload.response_format = { type: "json_object" };
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const err = new Error(`upstream-${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error("upstream-empty");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function chatJson(baseURL, apiKey, model, system, user, maxTokens, timeoutMs) {
  // Prefer structured outputs; fall back to plain JSON for providers/models
  // (e.g. some free tiers) that reject response_format, then extract {...}.
  try {
    return extractJson(await postChat(baseURL, apiKey, model, system, user, maxTokens, timeoutMs, true));
  } catch (e) {
    if (e && e.status === 400) {
      return extractJson(await postChat(baseURL, apiKey, model, system, user, maxTokens, timeoutMs, false));
    }
    throw e;
  }
}

module.exports = { clientIp, rateLimited, readJsonBody, provider, chatJson };
