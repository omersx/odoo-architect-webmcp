// POST /api/plan { requirement, guardrails[], targets[] }
// -> { sections: [{title, description, items[]}] } or generic {error}.
// Key + provider URL stay server-side. Rate-limited, size-capped, no leaks.
const { clientIp, rateLimited, readJsonBody, provider, chatJson } = require("./_guard");

const SYSTEM = [
  "You are Odoo Architect, a senior Odoo engineer.",
  "Design upgrade-safe custom addons only. Never modify Odoo core.",
  "Prefer _inherit, ORM-first logic, stable XPath XML inheritance, access rights, tests.",
  "Return JSON ONLY in this shape:",
  '{"sections":[{"title":"Scope & modules","description":"...","items":["..."]}]}',
  "Exactly 4 sections: Scope & modules, Domain model, Views & access, Quality gate.",
  "Each section: 2-4 short concrete items. No markdown, no extra keys."
].join("\n");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }
  if (rateLimited(clientIp(req), 10, 60 * 1000)) {
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
    body = await readJsonBody(req, 8 * 1024);
  } catch (e) {
    res.status(400).json({ error: "bad-request" });
    return;
  }
  const requirement = String(body.requirement || "").slice(0, 1000).trim();
  const guardrails = Array.isArray(body.guardrails) ? body.guardrails.map(String).slice(0, 12) : [];
  const targets = Array.isArray(body.targets) ? body.targets.map(String).slice(0, 6) : [];
  if (!requirement) {
    res.status(400).json({ error: "bad-request" });
    return;
  }
  const user = [
    `Business requirement: ${requirement}`,
    `Target models: ${targets.join(", ") || "sale.order"}`,
    `Guardrails: ${guardrails.join(" | ").slice(0, 1200)}`
  ].join("\n");
  try {
    const out = await chatJson(prov.baseURL, prov.apiKey, prov.model, SYSTEM, user, 800, 15000);
    const sections = Array.isArray(out.sections) ? out.sections : null;
    if (!sections || sections.length < 1) throw new Error("bad-shape");
    const clean = sections.slice(0, 4).map((s) => ({
      title: String(s.title || "Section").slice(0, 80),
      description: String(s.description || "").slice(0, 300),
      items: (Array.isArray(s.items) ? s.items : []).map((i) => String(i).slice(0, 200)).slice(0, 5)
    }));
    if (clean.some((s) => !s.items.length)) throw new Error("bad-shape");
    res.status(200).json({ sections: clean });
  } catch (e) {
    res.status(502).json({ error: "ai-unavailable" });
  }
};
