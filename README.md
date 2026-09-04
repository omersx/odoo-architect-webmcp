# Odoo Architect Studio — Business apps your agent can't break

Agent proposes · Human disposes · Nothing generates without approval.

Before WebMCP, agents guessed ERP XML and broke upgrades. Now the agent plans in the open, explains tradeoffs, gets blocked without explicit approval, then generates audited Odoo files. Same governance pattern generalizes to Shopify, POS, any business app.

Odoo Architect Studio is a WebMCP-powered shared workspace for designing safe Odoo customizations. A person supplies the business outcome, an agent creates a structured extension plan, the person reviews the trade-offs, and a starter add-on blueprint is generated only after explicit approval.

This is a new, separate web experience inspired by the user-owned [Odoo Architect Agent Framework](https://github.com/omersx/odoo-architect-agent-framework). It translates that framework's Odoo guardrails into a human-visible, agent-callable browser workflow.

## What it demonstrates

1. **Human brief** — describe a business outcome in plain language.
2. **Shared plan** — an agent generates a visible plan covering scope, domain logic, views/access, and testing.
3. **Human control** — the user can add guardrails and must approve before a starter add-on is generated.
4. **Static validation** — the generated blueprint confirms the expected module structure and quality gates.

## WebMCP tools

The page uses the current imperative WebMCP API on `document.modelContext`:

- `get_architecture_snapshot` (read-only)
- `draft_odoo_change_plan`
- `update_plan_guardrail`
- `explain_tradeoffs` (read-only: risks, alternatives, why upgrade-safe)
- `request_changes` (human reject with feedback, resets approval)
- `approve_and_generate_addon` — requires `{ "approved": true }`
- `run_static_validation` (read-only, real checks: module name, manifest deps, XML parse, ORM use, access rights, tests)
- `list_generated_files` (read-only)
- `get_file_content` (read-only)
- `export_addon_bundle` (read-only)

All state-changing tools update the visible workspace + human+agent timeline. The app composes 11 Odoo files from your brief — module, targets, fields, views, and tests derived from the requirement text (presets included) — with file tabs, validation score, and one-click bundle download. Every visit starts fresh — refresh clears the workspace. Try presets: Delivery urgency / Pharmacy expiry / POS discount / Shopify bridge.

## AI model backend (optional, secure)

Off by default the app composes starters locally. Toggle **Draft with AI model** to use your own
OpenAI-compatible provider through secure Vercel functions. The browser never sees your key.

```powershell
vercel env add MODEL_BASE_URL      # e.g. https://api.openai.com/v1  (or OpenRouter, etc.)
vercel env add MODEL_API_KEY       # server-only, never shipped to the browser
vercel env add MODEL_NAME          # e.g. gpt-4o-mini
vercel --prod
```

Security: key + provider URL live only in server env; `GET /api/status` reports only
`{ai:true/false}`; plan/generate endpoints are POST-only, rate-limited, input-capped, and return
generic errors. Set spend caps on your provider — the endpoints are public by design for judging.

## Run locally

This dependency-free prototype can be served with any static server:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`. WebMCP itself requires a supporting browser; use the ChatGPT desktop app's in-app browser or WebMCP-enabled Chrome for the full agent-tool experience. The human UI remains usable in ordinary browsers, where it labels itself as preview mode.

## Test the agent flow

Use this prompt in a supported browser:

> Open Odoo Architect Studio. Create an Odoo plan for delivery urgency on sales orders, show me the plan, and wait for my approval before generating the add-on.

After reviewing the visible plan, confirm approval and ask the agent to call `approve_and_generate_addon` with `approved: true`.

## Challenge materials

- Live-app URL: https://odoo-architect-webmcp.vercel.app
- Demo video URL: add before Devpost submission
- Upstream framework: [Odoo Architect Agent Framework](https://github.com/omersx/odoo-architect-agent-framework)

## License

MIT. See [LICENSE](LICENSE).
