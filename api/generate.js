// POST /api/generate { module, primary, fields[], brief, guardrails[], allowedPaths[] }
// -> { files: {path: content} } filtered to allowlist. Key server-side only.
const { clientIp, rateLimited, readJsonBody, provider, chatJson } = require("./_guard");

const SYSTEM = [
  "You are Odoo Architect, a senior Odoo engineer.",
  "Write upgrade-safe Odoo 18 addon file contents. Never modify core.",
  "Use _inherit, ORM only (no SQL), stable XPath, ir.model.access.csv, TransactionCase tests.",
  "Return JSON ONLY: {\"files\":{\"__manifest__.py\":\"...\", ...}}.",
  "Only the requested paths. No markdown, no extra keys, no explanations."
].join("\n");

function cleanFiles(files, allowed) {
  const out = {};
  for (const p of allowed) {
    const c = files && files[p];
    if (typeof c === "string" && c.length > 0 && c.length <= 12000) out[p] = c;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }
  if (rateLimited(clientIp(req), 6, 60 * 1000)) {
    res.status(429).json({ error: "rate-limited" });
    return;
  }
  const prov = provider();
  if (!prov) {
    res.status(501).json({ error: "ai-unavailable" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req, 12 * 1024);
  } catch (e) {
    res.status(400).json({ error: "bad-request" });
    return;
  }
  const module = String(body.module || "").slice(0, 60);
  const primary = String(body.primary || "sale.order").slice(0, 40);
  const brief = String(body.brief || "").slice(0, 600);
  const guardrails = Array.isArray(body.guardrails) ? body.guardrails.map(String).slice(0, 12) : [];
  const allowedPaths = Array.isArray(body.allowedPaths) ? body.allowedPaths.map(String).slice(0, 14) : [];
  if (!/^biz_bridge_[a-z0-9_]+$/.test(module) || !allowedPaths.length) {
    res.status(400).json({ error: "bad-request" });
    return;
  }
  const user = [
    `Module: ${module} (Odoo 18, license LGPL-3)`,
    `Primary model _inherit: ${primary}`,
    `Brief: ${brief}`,
    `Guardrails: ${guardrails.join(" | ").slice(0, 1200)}`,
    `Write exactly these paths: ${allowedPaths.join(", ")}`
  ].join("\n");
  try {
    const out = await chatJson(prov.baseURL, prov.apiKey, prov.model, SYSTEM, user, 3000, 20000);
    const files = cleanFiles(out.files, allowedPaths);
    if (!Object.keys(files).length) throw new Error("bad-shape");
    res.status(200).json({ files });
  } catch (e) {
    res.status(502).json({ error: "ai-unavailable" });
  }
};
