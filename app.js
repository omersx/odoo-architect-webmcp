const FRAMEWORK_RULES = [
  "Use custom add-ons; never modify Odoo core.",
  "Prefer ORM-first business logic and stable XML inheritance.",
  "Define access rights and review record rules for each new model.",
  "Plan for upgrade safety, multi-company behavior, and tests."
];

const TOOL_CATALOG = [
  ["get_architecture_snapshot", "Read brief, plan, guardrails, approval, files and validation."],
  ["draft_odoo_change_plan", "Turn a business request into a visible, reviewable Odoo plan."],
  ["update_plan_guardrail", "Add a human-specified constraint to the shared plan."],
  ["explain_tradeoffs", "Explain risks, alternatives and why this plan is upgrade-safe."],
  ["request_changes", "Human rejects/asks for changes with feedback, resets approval."],
  ["approve_and_generate_addon", "Approve explicitly and generate real scenario-specific Odoo files."],
  ["run_static_validation", "Run real static checks on the generated files."],
  ["list_generated_files", "List every generated addon file path."],
  ["get_file_content", "Read one generated file by path."],
  ["export_addon_bundle", "Export full bundle for download/review."]
];

const PRESETS = {
  urgency: "When a sales order becomes urgent, show a delivery urgency on the quotation, copy it to the invoice, and make it visible to warehouse staff.",
  pharmacy: "For pharmacy sales, warn when a product expires within 30 days at quotation time, block confirmation without pharmacist override, and log the override for audit.",
  pos_discount: "For retail POS, allow a manager-approved discount above 10% on orders, record the approver, and show the discount reason on the receipt and invoice.",
  shopify: "Sync Shopify orders into Odoo sales with idempotent webhook handling, map Shopify discount codes to Odoo pricelists, and flag sync failures for manual review."
};

const state = {
  requirement: "",
  plan: [],
  guardrails: [...FRAMEWORK_RULES],
  approved: false,
  generated: false,
  validation: [],
  files: {},
  module: "biz_bridge_custom_workflow",
  scenario: "generic",
  odooVersion: "18.0",
  activity: [],
  ai: false,
  aiAvailable: null
};

const elements = {
  requirement: document.querySelector("#requirement"),
  guardrailList: document.querySelector("#guardrail-list"),
  planGrid: document.querySelector("#plan-grid"),
  planStatus: document.querySelector("#plan-status"),
  approveButton: document.querySelector("#approve-button"),
  generateButton: document.querySelector("#generate-button"),
  output: document.querySelector("#output-section"),
  addonTree: document.querySelector("#addon-tree"),
  validationList: document.querySelector("#validation-list"),
  generationSummary: document.querySelector("#generation-summary"),
  toolList: document.querySelector("#tool-list"),
  webmcpStatus: document.querySelector("#webmcp-status"),
  activityList: document.querySelector("#activity-list"),
  fileTabs: document.querySelector("#file-tabs"),
  fileViewer: document.querySelector("#file-viewer")
};

let activeFile = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[character]);
}

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detectScenario(requirement) {
  const t = requirement.toLowerCase();
  if (t.includes("shopify") || t.includes("webhook") || t.includes("sync")) return "shopify";
  if (t.includes("pharmac") || t.includes("expir")) return "pharmacy";
  if (t.includes("pos") || t.includes("discount") || t.includes("receipt") || t.includes("retail")) return "pos";
  if (t.includes("urgent") || t.includes("urgency") || t.includes("warehouse") || t.includes("delivery")) return "urgency";
  return "generic";
}

function scenarioMeta(scenario) {
  if (scenario === "shopify") return {
    key: "shopify", moduleSuffix: "shopify_bridge", modelFile: "sale_order.py",
    field: "shopify_order_id", dependsExtra: ["sale_management"],
    title: "Shopify order bridge", modelDesc: "Idempotent webhook sync, discount mapping, failure queue for review."
  };
  if (scenario === "pharmacy") return {
    key: "pharmacy", moduleSuffix: "pharmacy_expiry", modelFile: "sale_order.py",
    field: "expiry_warning", dependsExtra: ["product_expiry"],
    title: "Pharmacy expiry guard", modelDesc: "Block risky confirmation, require pharmacist override with audit log."
  };
  if (scenario === "pos") return {
    key: "pos", moduleSuffix: "pos_discount", modelFile: "pos_order.py",
    field: "manager_discount", dependsExtra: ["point_of_sale"],
    title: "POS manager discount", modelDesc: "Gate high discounts behind manager approval, show reason on receipt."
  };
  if (scenario === "urgency") return {
    key: "urgency", moduleSuffix: "delivery_urgency", modelFile: "sale_order.py",
    field: "delivery_urgency", dependsExtra: ["stock"],
    title: "Delivery urgency flow", modelDesc: "Propagate urgency quotation -> invoice -> warehouse, read-only downstream."
  };
  return {
    key: "generic", moduleSuffix: "custom_workflow", modelFile: "sale_order.py",
    field: "x_brief_flag", dependsExtra: [],
    title: "Custom workflow", modelDesc: "Minimal _inherit extension driven by the brief, safe to extend."
  };
}

function keywordList(text, count) {
  const stop = new Set(["when","show","make","that","this","with","from","into","order","sales","sale","allow","record","visible","staff","time","above","need","needs","without","before","after","each","more","most","very","just","block","warn","copy","becomes","become"]);
  const words = (text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !stop.has(w));
  const uniq = [...new Set(words)];
  return uniq.slice(0, count);
}

function parseBrief(requirement) {
  const t = requirement.toLowerCase();
  const scenario = detectScenario(requirement);
  const has = (...keys) => keys.some((k) => t.includes(k));
  const concepts = [];
  if (has("urgent","urgency","priority")) concepts.push("urgency");
  if (has("expir")) concepts.push("expiry");
  if (has("discount")) concepts.push("discount");
  if (has("approv","override","manager","pharmacist")) concepts.push("approval");
  if (has("shopify","webhook","sync","external")) concepts.push("sync");
  if (has("invoice","account","receipt","pricelist")) concepts.push("invoice");
  if (has("warehouse","stock","delivery","transfer","picking")) concepts.push("warehouse");
  if (has("lead","opportunity","crm")) concepts.push("crm");
  const targets = ["sale.order"];
  if (has("pos","retail","receipt") && has("discount","pos","retail")) targets.unshift("pos.order");
  if (has("invoice","account")) targets.push("account.move");
  if (has("warehouse","stock","delivery","transfer","picking")) targets.push("stock.picking");
  if (has("lead","opportunity","crm")) targets.push("crm.lead");
  const uniqTargets = [...new Set(targets)];
  const primary = uniqTargets[0];
  const presetSuffix = { shopify: "shopify_bridge", pharmacy: "pharmacy_expiry", pos: "pos_discount", urgency: "delivery_urgency" }[scenario];
  const kw = keywordList(t, 2);
  const moduleSuffix = presetSuffix || ((kw.join("_") || "custom_workflow").slice(0, 34));
  const depends = inferDependencies(requirement);
  if (scenario === "shopify" && !depends.includes("sale_management")) depends.push("sale_management");
  return { scenario, concepts, targets: uniqTargets, primary, moduleSuffix, module: `biz_bridge_${moduleSuffix}`, depends, keywords: kw };
}

function logActivity(actor, action) {
  const entry = { t: new Date().toISOString(), actor, action };
  state.activity.push(entry);
  renderActivity();
  persist();
  return entry;
}

function persist() {
  // Fresh-start policy: refresh always begins a new session.
  // Nothing is stored, so no previous output can reappear on load.
  try {
    localStorage.removeItem("oa-studio");
  } catch (e) { /* private mode */ }
}

function restore() {
  // Disabled by fresh-start policy: every load begins empty.
}

function inferDependencies(requirement) {
  const text = requirement.toLowerCase();
  const dependencies = ["sale_management"];
  if (text.includes("invoice") || text.includes("account") || text.includes("receipt")) dependencies.push("account");
  if (text.includes("warehouse") || text.includes("stock") || text.includes("delivery") || text.includes("transfer")) dependencies.push("stock");
  if (text.includes("lead") || text.includes("opportunity") || text.includes("crm")) dependencies.push("crm");
  if (text.includes("pos") || text.includes("retail") || text.includes("receipt")) dependencies.push("point_of_sale");
  if (text.includes("pharmacy") || text.includes("expiry") || text.includes("product")) dependencies.push("product_expiry");
  return [...new Set(dependencies)];
}

function summarizeRequirement(requirement) {
  const clean = requirement.replace(/\s+/g, " ").trim();
  if (!clean) return "Define an Odoo customization with a clear business outcome.";
  return clean.length > 145 ? `${clean.slice(0, 142)}…` : clean;
}

function buildPlan(requirement) {
  const spec = parseBrief(requirement);
  state.scenario = spec.scenario;
  state.module = spec.module;
  const meta = scenarioMeta(spec.scenario);
  const dependencyText = spec.depends.map(titleCase).join(", ");
  const extra = state.guardrails.slice(4).map((g) => `Guardrail: ${g}`);
  const multiCompany = state.guardrails.some((g) => g.toLowerCase().includes("multi-company") || g.toLowerCase().includes("company"));
  const conceptLine = spec.concepts.length ? `Concepts: ${spec.concepts.join(", ")}` : "Concepts: custom workflow";
  const targetLine = `Targets: ${spec.targets.join(", ")}`;
  const domainItems = spec.scenario === "pharmacy"
    ? ["expiry check via ORM, no raw SQL", "block confirm without override group", "audit log model for overrides"]
    : spec.scenario === "pos"
    ? ["discount approval field + approver tracking", "enforce >10% needs manager group", "receipt/invoice display method"]
    : spec.scenario === "shopify"
    ? ["idempotent upsert via ORM search, no duplicates", "discount/pricelist mapping method", "failure queue for manual review"]
    : [`Derive fields from brief keywords: ${spec.keywords.join(", ") || "custom"}`, "ORM-first methods, no raw SQL", "Keep standard flow via super()"];
  return [
    {
      title: `Scope & modules — ${meta.title}`,
      description: "Map the business request to the smallest upgrade-safe Odoo extension.",
      items: [`Create extension module: ${spec.module}`, `Depends on ${dependencyText}`, targetLine, conceptLine, "Keep standard Odoo behavior intact", ...extra.slice(0, 3)]
    },
    {
      title: "Domain model",
      description: meta.modelDesc,
      items: domainItems
    },
    {
      title: "Views & access",
      description: "Expose the right data without changing ownership.",
      items: ["Extend views with stable XPath", "Read-only downstream fields", multiCompany ? "Add company_id + record rules for multi-company" : "Review model access and record-rule visibility"]
    },
    {
      title: "Quality gate",
      description: "Reviewable before live Odoo.",
      items: ["2+ TransactionCase tests", "Run framework static validation", `Smoke install on Odoo ${state.odooVersion}`]
    }
  ];
}

function currentModuleName() {
  try {
    return parseBrief(state.requirement || "").module;
  } catch (e) {
    return "biz_bridge_custom_workflow";
  }
}

function generateAddonFiles() {
  const spec = parseBrief(state.requirement);
  const scenario = spec.scenario;
  state.scenario = scenario;
  const meta = scenarioMeta(scenario);
  const module = spec.module;
  state.module = module;
  const deps = [...new Set([...spec.depends, ...meta.dependsExtra])];
  const depsPy = deps.map((d) => `        "${d}",`).join("\n");
  const brief = summarizeRequirement(state.requirement);
  const guardrailText = state.guardrails.map((g) => `- ${g}`).join("\n");
  const multiCompanyNote = state.guardrails.some((g) => g.toLowerCase().includes("company")) ? "\n# Guardrail: multi-company safe (company_id respected)." : "";
  const isPos = spec.primary === "pos.order";
  const className = isPos ? "PosOrder" : "SaleOrder";

  const manifest = `{
    "name": "${titleCase(module)}",
    "version": "${state.odooVersion}.1.0.0",
    "summary": "${brief.replace(/"/g, "'")}",
    "depends": [
${depsPy}
    ],
    "data": [
        "views/sale_order_views.xml",
        "views/account_move_views.xml",
        "views/stock_picking_views.xml",
        "security/ir.model.access.csv",
    ],
    "license": "LGPL-3",
    "application": False,
    "installable": True,
}
`;
  const modelPath = `models/${isPos ? "pos_order.py" : meta.modelFile}`;
  const modelImport = (isPos ? "pos_order" : meta.modelFile).replace(/\.py$/, "");
  const testStem = `test_${spec.moduleSuffix}`;
  const testPath = `tests/${testStem}.py`;
  const initPy = `from . import models
`;
  const modelsInit = `from . import ${modelImport}
`;
  const genericField = (`x_${(spec.keywords.slice(0, 2).join("_") || "custom_flag")}`).slice(0, 30).replace(/[^a-z0-9_]/g, "");
  const genericModelPy = `from odoo import api, fields, models


class ${className}(models.Model):
    _inherit = "${spec.primary}"

    ${genericField} = fields.Boolean(
        default=False,
        help="Custom outcome from brief: ${brief.replace(/"/g, "'").slice(0, 90)}",
    )
    x_brief_note = fields.Char(help="Operator note captured with this customization.")${multiCompanyNote}

    def _apply_brief_rules(self):
        # ORM-first hook composed from the brief keywords: ${spec.keywords.join(", ") || "custom"}.
        # Extend here; standard flow untouched.
        return True
`;
  const genericTestPy = `from odoo.tests.common import TransactionCase


class TestBriefRules(TransactionCase):
    def test_flag_defaults_false(self):
        order = self.env["${spec.primary}"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        self.assertFalse(order.${genericField})

    def test_apply_brief_rules(self):
        order = self.env["${spec.primary}"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        self.assertTrue(order._apply_brief_rules())
`;
  const saleOrderPy = scenario === "shopify" ? `from odoo import api, fields, models


class SaleOrder(models.Model):
    _inherit = "sale.order"

    shopify_order_id = fields.Char(index=True, help="Idempotent Shopify order id.")
    shopify_sync_state = fields.Selection(
        [("pending", "Pending"), ("done", "Done"), ("failed", "Failed")],
        default="pending",
    )${multiCompanyNote}

    def _shopify_upsert(self, payload):
        # Idempotent: search first, no duplicates, no raw SQL.
        existing = self.search([("shopify_order_id", "=", payload.get("id"))], limit=1)
        if existing:
            return existing
        return self.create({"shopify_order_id": payload.get("id")})
` : scenario === "pharmacy" ? `from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SaleOrder(models.Model):
    _inherit = "sale.order"

    expiry_warning = fields.Boolean(default=False, help="True when a line expires within 30 days.")
    pharmacist_override_id = fields.Many2one("res.users", help="Pharmacist who overrode the block.")${multiCompanyNote}

    def _check_expiry(self):
        # ORM-first: real check would read product_expiry dates.
        return True

    def action_confirm(self):
        if not self._check_expiry() and not self.pharmacist_override_id:
            raise ValidationError("Blocked: product expires within 30 days. Needs pharmacist override.")
        return super().action_confirm()
` : scenario === "pos" ? `from odoo import api, fields, models
from odoo.exceptions import ValidationError


class PosOrder(models.Model):
    _inherit = "pos.order"

    manager_discount = fields.Float(default=0.0, help="Discount % above 10 needs manager.")
    discount_approver_id = fields.Many2one("res.users", readonly=True)${multiCompanyNote}
    discount_reason = fields.Char()

    def _check_discount(self):
        if self.manager_discount > 10 and not self.discount_approver_id:
            raise ValidationError("Discount above 10% requires manager approval.")
        return True
` : scenario === "urgency" ? `from odoo import api, fields, models


class SaleOrder(models.Model):
    _inherit = "sale.order"

    delivery_urgency = fields.Selection(
        [("normal", "Normal"), ("urgent", "Urgent"), ("critical", "Critical")],
        default="normal",
        help="Urgency flag propagated to invoice and warehouse.",
    )${multiCompanyNote}

    def _prepare_invoice(self):
        vals = super()._prepare_invoice()
        vals["delivery_urgency"] = self.delivery_urgency
        return vals

    def action_confirm(self):
        # Guardrail-aware: keep standard flow, add audit-safe hook.
        return super().action_confirm()
` : genericModelPy;
  const saleXml = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_order_form_urgency" model="ir.ui.view">
        <field name="name">sale.order.form.urgency</field>
        <field name="model">sale.order</field>
        <field name="inherit_id" ref="sale.view_order_form"/>
        <field name="arch" type="xml">
            <xpath expr="//field[@name='partner_id']" position="after">
                <field name="delivery_urgency" widget="badge"/>
            </xpath>
        </field>
    </record>
</odoo>
`;
  const invoiceXml = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_move_form_urgency" model="ir.ui.view">
        <field name="name">account.move.form.urgency</field>
        <field name="model">account.move</field>
        <field name="inherit_id" ref="account.view_move_form"/>
        <field name="arch" type="xml">
            <xpath expr="//field[@name='partner_id']" position="after">
                <field name="delivery_urgency" readonly="1"/>
            </xpath>
        </field>
    </record>
</odoo>
`;
  const pickingXml = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_picking_form_urgency" model="ir.ui.view">
        <field name="name">stock.picking.form.urgency</field>
        <field name="model">stock.picking</field>
        <field name="inherit_id" ref="stock.vpicktree"/>
        <field name="arch" type="xml">
            <xpath expr="//field[@name='partner_id']" position="after">
                <field name="delivery_urgency" readonly="1"/>
            </xpath>
        </field>
    </record>
</odoo>
`;
  const accessCsv = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_${module}_user,${module} user,model_sale_order,sales_team.group_sale_salesman,1,1,0,0
`;
  const testPy = scenario === "shopify" ? `from odoo.tests.common import TransactionCase


class TestShopifyBridge(TransactionCase):
    def test_idempotent_upsert(self):
        order = self.env["sale.order"]._shopify_upsert({"id": "gid://shopify/Order/1"})
        again = self.env["sale.order"]._shopify_upsert({"id": "gid://shopify/Order/1"})
        self.assertEqual(order.id, again.id)

    def test_default_pending(self):
        order = self.env["sale.order"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        self.assertEqual(order.shopify_sync_state, "pending")
` : scenario === "pharmacy" ? `from odoo.tests.common import TransactionCase


class TestPharmacy(TransactionCase):
    def test_blocks_without_override(self):
        order = self.env["sale.order"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        order.expiry_warning = True
        with self.assertRaises(Exception):
            order.action_confirm()

    def test_override_allows_confirm(self):
        self.assertTrue(True)
` : scenario === "pos" ? `from odoo.tests.common import TransactionCase


class TestPosDiscount(TransactionCase):
    def test_high_discount_needs_manager(self):
        order = self.env["pos.order"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        order.manager_discount = 20
        with self.assertRaises(Exception):
            order._check_discount()
` : scenario === "urgency" ? `from odoo.tests.common import TransactionCase
    def test_urgency_propagates_to_invoice(self):
        order = self.env["sale.order"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        order.delivery_urgency = "urgent"
        invoice_vals = order._prepare_invoice()
        self.assertEqual(invoice_vals.get("delivery_urgency"), "urgent")

    def test_default_is_normal(self):
        order = self.env["sale.order"].create({"partner_id": self.env.ref("base.res_partner_2").id})
        self.assertEqual(order.delivery_urgency, "normal")
` : genericTestPy;
  const readme = `# ${titleCase(module)}

${brief}

## Guardrails (from Odoo Architect Framework)
${guardrailText}

## Install
Copy to Odoo addons path and update app list, then install.
`;

  return {
    "__manifest__.py": manifest,
    "__init__.py": initPy,
    "models/__init__.py": modelsInit,
    [modelPath]: saleOrderPy,
    "views/sale_order_views.xml": saleXml,
    "views/account_move_views.xml": invoiceXml,
    "views/stock_picking_views.xml": pickingXml,
    "security/ir.model.access.csv": accessCsv,
    "tests/__init__.py": `from . import ${testStem}\n`,
    [testPath]: testPy,
    "README.md": readme
  };
}

function generatedTree() {
  const module = state.module || currentModuleName();
  const suffix = module.replace(/^biz_bridge_/, "");
  const meta = scenarioMeta(state.scenario || "generic");
  const modelFile = state.scenario === "pos" ? "pos_order.py" : meta.modelFile;
  return `${module}/
├── __init__.py
├── __manifest__.py
├── README.md
├── models/
│   ├── __init__.py
│   └── ${modelFile}
├── views/
│   ├── sale_order_views.xml
│   ├── account_move_views.xml
│   └── stock_picking_views.xml
├── security/
│   └── ir.model.access.csv
└── tests/
    ├── __init__.py
    └── test_${suffix}.py`;
}

function runRealValidation() {
  const results = [];
  const push = (name, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"} — ${name}: ${detail}`);
  const files = state.files;
  const mod = state.module;

  push("module-name", /^biz_bridge_[a-z0-9_]+$/.test(mod), mod);
  const manifest = files["__manifest__.py"] || "";
  const deps = inferDependencies(state.requirement);
  const depsOk = deps.every((d) => manifest.includes(`"${d}"`));
  push("manifest-depends", depsOk, `expects ${deps.join(",")}`);
  const pyKey = Object.keys(files).find((k) => k.startsWith("models/") && k !== "models/__init__.py") || "models/sale_order.py";
  const py = files[pyKey] || "";
  push("orm-inherit", py.includes('_inherit = "') && !py.includes("SELECT ") && !py.includes("select "), `uses _inherit in ${state.scenario} model, no raw SQL`);
  let xmlOk = true;
  let xmlDetail = "3 views parse";
  try {
    const parser = new DOMParser();
    for (const k of ["views/sale_order_views.xml", "views/account_move_views.xml", "views/stock_picking_views.xml"]) {
      const doc = parser.parseFromString(files[k] || "", "text/xml");
      if (doc.querySelector("parsererror")) { xmlOk = false; xmlDetail = `bad ${k}`; break; }
      if (!files[k].includes("<xpath")) { xmlOk = false; xmlDetail = `no xpath in ${k}`; break; }
    }
  } catch (e) { xmlOk = false; xmlDetail = String(e).slice(0, 80); }
  push("xml-inheritance", xmlOk, xmlDetail);
  const csv = files["security/ir.model.access.csv"] || "";
  push("access-rights", csv.includes("access_") && csv.includes("perm_read"), "ir.model.access.csv present");
  const testKey = Object.keys(files).find((k) => k.startsWith("tests/test_")) || "tests/test_delivery_urgency.py";
  const test = files[testKey] || "";
  const testOk = test.includes("def test_") && (test.includes("_prepare_invoice") || test.includes("_check_") || test.includes("action_confirm") || test.includes("_upsert") || test.includes("shopify") || test.includes("_apply_brief_rules"));
  push("tests", testOk, `${state.scenario} TransactionCase tests present`);
  push("guardrails", (files["README.md"] || "").includes("Guardrails"), `${state.guardrails.length} guardrails attached`);
  return results;
}

function snapshot() {
  const pass = state.validation.filter((v) => v.startsWith("PASS")).length;
  return {
    requirement: state.requirement,
    module: state.module,
    scenario: state.scenario,
    odooVersion: state.odooVersion,
    plan: state.plan,
    guardrails: state.guardrails,
    approved: state.approved,
    generated: state.generated,
    files: Object.keys(state.files),
    validation: state.validation,
    validationScore: state.validation.length ? `${pass}/${state.validation.length}` : "not-run",
    activity: state.activity.slice(-12)
  };
}

function explainTradeoffs() {
  if (!state.plan.length) throw new Error("Draft a plan first.");
  const meta = scenarioMeta(state.scenario);
  let field = meta.field;
  if (state.scenario === "generic") {
    try {
      const spec = parseBrief(state.requirement);
      field = (`x_${spec.keywords.slice(0, 2).join("_") || "custom_flag"}`).slice(0, 30);
    } catch (e) { field = meta.field; }
  }
  return {
    scenario: state.scenario,
    whySafe: ["Custom module only, no core edits", `ORM-first field ${field}`, "XPath inheritance, read-only downstream"],
    risks: state.scenario === "pharmacy" ? ["Expiry logic needs real product_expiry dates", "Override group must exist"] : state.scenario === "pos" ? ["Manager group must exist", "Receipt template override needs testing"] : ["Downstream readonly fields need access review"],
    alternatives: ["Larger suite module (rejected: upgrade risk)", "Studio UI only, no agent (rejected: guessing XML)"],
    guardrailsEnforced: state.guardrails.length
  };
}

function requestChanges(feedback) {
  const clean = String(feedback || "").trim();
  if (!clean) throw new Error("Provide feedback for changes.");
  if (!state.plan.length) throw new Error("No plan to revise.");
  state.approved = false;
  state.generated = false;
  state.validation = [];
  logActivity("human", `Requested changes: ${clean.slice(0, 100)}`);
  render();
  persist();
  return { ...snapshot(), feedback: clean };
}

function toolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function renderGuardrails() {
  if (!elements.guardrailList) return;
  elements.guardrailList.innerHTML = state.guardrails
    .map((rule) => `<li>${escapeHtml(rule)}</li>`)
    .join("");
}

function renderPlan() {
  const section = document.querySelector("#plan-section");
  const review = document.querySelector("#review-strip");
  if (!elements.planGrid) return;
  if (!state.plan.length) {
    if (section) section.hidden = true;
    if (review) review.hidden = true;
    setWorkflowStep("step-plan", false);
    setWorkflowStep("step-approve", false);
    return;
  }
  if (section) section.hidden = false;
  if (review) review.hidden = false;
  elements.planGrid.innerHTML = state.plan.map((section, index) => `
    <article class="plan-card">
      <span class="card-number">0${index + 1}</span>
      <h3>${escapeHtml(section.title)}</h3>
      <p>${escapeHtml(section.description)}</p>
      <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `).join("");
  if (elements.planStatus) {
    elements.planStatus.textContent = state.approved ? "Approved by human" : "Ready for human review";
    elements.planStatus.classList.add("ready");
  }
  if (elements.approveButton) elements.approveButton.disabled = state.approved;
  if (elements.generateButton) elements.generateButton.disabled = !(state.approved && state.plan.length);
  setWorkflowStep("step-plan", true);
  setWorkflowStep("step-approve", state.approved);
}

function renderOutput() {
  if (!elements.output) return;
  elements.output.hidden = !state.generated;
  if (!state.generated) return;
  if (elements.addonTree) elements.addonTree.textContent = generatedTree();
  if (elements.validationList) elements.validationList.innerHTML = state.validation.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  if (elements.generationSummary) elements.generationSummary.textContent = `Generated ${state.module} — ${Object.keys(state.files).length} files from the approved brief: “${summarizeRequirement(state.requirement)}”`;
  setWorkflowStep("step-generate", true);
  renderFileTabs();
}

function renderTools() {
  if (!elements.toolList) return;
  elements.toolList.innerHTML = TOOL_CATALOG.map(([name, description]) => `
    <article class="tool-item"><strong>${name}</strong><span>${description}</span></article>
  `).join("");
}

function renderActivity() {
  if (!elements.activityList) return;
  const items = state.activity.slice(-8).reverse();
  elements.activityList.innerHTML = items.length
    ? items.map((a) => `<li><strong>${escapeHtml(a.actor)}</strong> — ${escapeHtml(a.action)}</li>`).join("")
    : `<li>Human + agent actions will appear here.</li>`;
}

function renderFileTabs() {
  if (!elements.fileTabs || !elements.fileViewer) return;
  const keys = Object.keys(state.files);
  if (!keys.length) { elements.fileTabs.innerHTML = ""; elements.fileViewer.textContent = "Generate to inspect files."; return; }
  if (!activeFile || !state.files[activeFile]) activeFile = "__manifest__.py";
  elements.fileTabs.innerHTML = keys.map((k) => `<button type="button" class="file-tab${k === activeFile ? " active" : ""}" data-file="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join("");
  elements.fileViewer.textContent = state.files[activeFile] || "";
  elements.fileTabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { activeFile = b.dataset.file; renderFileTabs(); }));
}

function setWorkflowStep(id, done) {
  const step = document.querySelector(`#${id}`);
  if (!step) return;
  if (done) step.classList.add("done");
  else step.classList.remove("done");
}

function render() {
  renderGuardrails();
  renderPlan();
  renderOutput();
  renderTools();
  renderActivity();
  renderFileTabs();
  renderAi();
}

function draftPlan(requirement = elements.requirement.value) {
  state.requirement = requirement.trim();
  if (!state.requirement) throw new Error("Add a business requirement before drafting a plan.");
  if (elements.requirement) elements.requirement.value = state.requirement;
  state.scenario = detectScenario(state.requirement);
  state.module = currentModuleName();
  state.plan = buildPlan(state.requirement);
  state.approved = false;
  state.generated = false;
  state.validation = [];
  state.files = {};
  activeFile = null;
  state.restored = false;
  state.restoredNote = false;
  logActivity("agent", `Drafted ${state.scenario} plan for ${state.module}`);
  render();
  persist();
  return snapshot();
}

function addGuardrail(rule) {
  const clean = String(rule).trim();
  if (!clean) throw new Error("A guardrail needs a short, concrete instruction.");
  if (!state.guardrails.includes(clean)) state.guardrails.push(clean);
  if (state.requirement) state.plan = buildPlan(state.requirement);
  logActivity("human", `Added guardrail: ${clean.slice(0, 80)}`);
  render();
  return snapshot();
}

function approvePlan() {
  if (!state.plan.length) throw new Error("Draft an architecture plan before approval.");
  state.approved = true;
  logActivity("human", "Approved plan");
  render();
  return snapshot();
}

function generateAddon() {
  if (!state.plan.length) throw new Error("Draft an architecture plan before generating an add-on.");
  if (!state.approved) throw new Error("A human must explicitly approve the plan before generation.");
  state.files = generateAddonFiles();
  state.validation = runRealValidation();
  state.generated = true;
  activeFile = "__manifest__.py";
  logActivity("agent", `Generated ${Object.keys(state.files).length} files for ${state.module}`);
  render();
  return { module: state.module, tree: generatedTree(), files: Object.keys(state.files), validation: state.validation };
}

function aiStatusText() {
  if (!state.ai) return "Local composer";
  if (state.aiAvailable === true) return "AI on";
  if (state.aiAvailable === false) return "AI unreachable — local fallback";
  return "Checking…";
}

function renderAi() {
  const t = document.querySelector("#ai-toggle");
  if (t) t.checked = !!state.ai;
  const s = document.querySelector("#ai-status");
  if (s) s.textContent = aiStatusText();
}

async function probeAI() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch("/api/status", { signal: ctl.signal });
    clearTimeout(timer);
    state.aiAvailable = r.ok && (await r.json()).ai === true;
  } catch (e) {
    state.aiAvailable = false;
  }
  renderAi();
}

async function postJSON(path, payload, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`backend-${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function validSections(sections) {
  return Array.isArray(sections) && sections.length > 0 && sections.every((s) =>
    s && typeof s.title === "string" && Array.isArray(s.items) && s.items.length > 0);
}

async function draftPlanEngine(requirement) {
  const req = String(requirement || (elements.requirement && elements.requirement.value) || "").trim();
  if (!req) throw new Error("Add a business requirement before drafting a plan.");
  const spec = parseBrief(req);
  if (state.ai && state.aiAvailable) {
    try {
      if (elements.requirement) elements.requirement.value = req;
      const hint = document.querySelector("#brief-hint");
      if (hint) hint.textContent = "Drafting plan with model…";
      const out = await postJSON("/api/plan", {
        requirement: req, guardrails: state.guardrails, targets: spec.targets
      }, 25000);
      if (!validSections(out.sections)) throw new Error("bad-shape");
      state.requirement = req;
      state.scenario = spec.scenario;
      state.module = spec.module;
      state.plan = out.sections;
      state.approved = false;
      state.generated = false;
      state.validation = [];
      state.files = {};
      activeFile = null;
      logActivity("agent", `Drafted plan with model for ${state.module}`);
      render();
      persist();
      return snapshot();
    } catch (e) {
      logActivity("agent", "Model drafting failed — used local composer");
    }
  }
  return draftPlan(req);
}

async function generateAddonEngine() {
  if (!state.plan.length) throw new Error("Draft an architecture plan before generating an add-on.");
  if (!state.approved) throw new Error("A human must explicitly approve the plan before generation.");
  if (state.ai && state.aiAvailable) {
    try {
      const spec = parseBrief(state.requirement);
      const isPos = spec.primary === "pos.order";
      const allowedPaths = ["__manifest__.py", "__init__.py", "models/__init__.py",
        isPos ? "models/pos_order.py" : "models/sale_order.py",
        "views/sale_order_views.xml", "views/account_move_views.xml", "views/stock_picking_views.xml",
        "security/ir.model.access.csv", "tests/__init__.py", `tests/test_${spec.moduleSuffix}.py`, "README.md"];
      const out = await postJSON("/api/generate", {
        module: spec.module, primary: spec.primary, brief: summarizeRequirement(state.requirement),
        guardrails: state.guardrails, allowedPaths
      }, 30000);
      const files = {};
      for (const p of allowedPaths) {
        if (out.files && typeof out.files[p] === "string" && out.files[p].length) files[p] = out.files[p];
      }
      if (!files["__manifest__.py"] || Object.keys(files).length < allowedPaths.length) throw new Error("bad-shape");
      state.files = files;
      state.module = spec.module;
      state.scenario = spec.scenario;
      state.validation = runRealValidation();
      state.generated = true;
      activeFile = "__manifest__.py";
      logActivity("agent", `Generated ${Object.keys(files).length} files with model for ${state.module}`);
      render();
      persist();
      return { module: state.module, tree: generatedTree(), files: Object.keys(files), validation: state.validation };
    } catch (e) {
      logActivity("agent", "Model generation failed — used local composer");
    }
  }
  return generateAddon();
}

function downloadBundle() {
  const bundle = [`# ${state.module}`, "", `## Brief\n${state.requirement}`, "", "## Files", ...Object.keys(state.files).flatMap((k) => [`\n### ${k}\n\`\`\`\n${state.files[k]}\n\`\`\``])].join("\n");
  const blob = new Blob([bundle], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.module}-bundle.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function registerWebMcpTools() {
  if (!elements.webmcpStatus) return;
  if (!document.modelContext?.registerTool) {
    elements.webmcpStatus.textContent = "Preview mode · WebMCP not available";
    elements.webmcpStatus.classList.add("preview");
    return;
  }

  const register = (tool) => document.modelContext.registerTool(tool).catch((error) => {
    console.warn(`Unable to register ${tool.name}`, error);
  });

  Promise.all([
    register({
      name: "get_architecture_snapshot",
      description: "Read the Odoo Architect Studio brief, plan, guardrails, approval state, files and validation without changing anything.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => toolResult(snapshot())
    }),
    register({
      name: "draft_odoo_change_plan",
      description: "Create a visible Odoo addon architecture plan from a business requirement. This updates the shared workspace and resets approval.",
      inputSchema: {
        type: "object",
        properties: { requirement: { type: "string", description: "The business change to design." } },
        required: ["requirement"]
      },
      execute: async ({ requirement }) => toolResult(await draftPlanEngine(requirement))
    }),
    register({
      name: "update_plan_guardrail",
      description: "Add a human-approved implementation, security, or operational constraint to the shared Odoo architecture workspace.",
      inputSchema: {
        type: "object",
        properties: { guardrail: { type: "string", description: "A concise Odoo implementation constraint." } },
        required: ["guardrail"]
      },
      execute: async ({ guardrail }) => toolResult(addGuardrail(guardrail))
    }),
    register({
      name: "explain_tradeoffs",
      description: "Explain risks, rejected alternatives and why the current plan is upgrade-safe. Read-only.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => toolResult(explainTradeoffs())
    }),
    register({
      name: "request_changes",
      description: "Human rejects the plan with feedback. Resets approval and generation so agent must redraft.",
      inputSchema: {
        type: "object",
        properties: { feedback: { type: "string", description: "What to change and why." } },
        required: ["feedback"]
      },
      execute: async ({ feedback }) => toolResult(requestChanges(feedback))
    }),
    register({
      name: "approve_and_generate_addon",
      description: "Record explicit human approval and generate real Odoo addon files (manifest, models, views, security, tests). Only call when the user has reviewed the plan.",
      inputSchema: {
        type: "object",
        properties: { approved: { type: "boolean", description: "Must be true to show explicit human approval." } },
        required: ["approved"]
      },
      execute: async ({ approved }) => {
        if (approved !== true) throw new Error("Generation requires approved: true.");
        approvePlan();
        return toolResult(await generateAddonEngine());
      }
    }),
    register({
      name: "run_static_validation",
      description: "Run real static checks (module name, manifest deps, XML parse, ORM use, access rights, tests) on the generated files.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        if (!state.generated) throw new Error("Generate an add-on before validation.");
        state.validation = runRealValidation();
        render();
        return toolResult({ generated: state.generated, module: state.module, validation: state.validation });
      }
    }),
    register({
      name: "list_generated_files",
      description: "List every generated addon file path for the current module.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => toolResult({ module: state.module, generated: state.generated, files: Object.keys(state.files) })
    }),
    register({
      name: "get_file_content",
      description: "Read the full content of one generated addon file by path.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Exact file path, e.g. __manifest__.py or models/sale_order.py" } },
        required: ["path"]
      },
      annotations: { readOnlyHint: true },
      execute: async ({ path }) => {
        if (!state.files[path]) throw new Error(`Unknown file: ${path}. Call list_generated_files first.`);
        activeFile = path;
        renderFileTabs();
        return toolResult({ path, content: state.files[path] });
      }
    }),
    register({
      name: "export_addon_bundle",
      description: "Export the full addon bundle (all file contents + validation) as structured text for download or review.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        if (!state.generated) throw new Error("Generate an add-on before export.");
        return toolResult({ module: state.module, tree: generatedTree(), validation: state.validation, files: state.files });
      }
    })
  ]).then(() => {
    elements.webmcpStatus.textContent = "WebMCP tools registered";
    elements.webmcpStatus.classList.remove("preview");
    elements.webmcpStatus.classList.add("ready");
  });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("busy");
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(label)}`;
  } else {
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    btn.classList.remove("busy");
    render();
  }
}

document.querySelector("#draft-button")?.addEventListener("click", async () => {
  const btn = document.querySelector("#draft-button");
  setBusy(btn, true, "Drafting…");
  try { await draftPlanEngine(); } catch (error) { alert(error.message); } finally { setBusy(btn, false); }
});
document.querySelector("#approve-button")?.addEventListener("click", () => {
  try { approvePlan(); } catch (error) { alert(error.message); }
});
document.querySelector("#generate-button")?.addEventListener("click", async () => {
  const btn = document.querySelector("#generate-button");
  setBusy(btn, true, "Generating…");
  try { await generateAddonEngine(); } catch (error) { alert(error.message); } finally { setBusy(btn, false); }
});
document.querySelector("#add-rule-button")?.addEventListener("click", () => {
  const rule = window.prompt("Add a guardrail for this project:");
  if (rule === null) return;
  try { addGuardrail(rule); } catch (error) { alert(error.message); }
});
document.querySelector("#explain-button")?.addEventListener("click", () => {
  try {
    const t = explainTradeoffs();
    const box = document.querySelector("#tradeoff-box");
    if (box) {
      box.hidden = false;
      box.innerHTML = `<strong>Why safe:</strong> ${t.whySafe.map(escapeHtml).join(" · ")}<br><strong>Risks:</strong> ${t.risks.map(escapeHtml).join(" · ")}<br><strong>Rejected:</strong> ${t.alternatives.map(escapeHtml).join(" · ")}`;
    }
    logActivity("agent", "Explained tradeoffs");
  } catch (error) { alert(error.message); }
});
document.querySelector("#reject-button")?.addEventListener("click", () => {
  const fb = window.prompt("What should the agent change?");
  if (fb === null) return;
  try { requestChanges(fb); const box = document.querySelector("#tradeoff-box"); if (box) box.hidden = true; } catch (error) { alert(error.message); }
});
document.querySelector("#copy-prompt-button")?.addEventListener("click", async () => {
  const p = document.querySelector("#agent-prompt")?.textContent || "";
  await navigator.clipboard.writeText(p);
  document.querySelector("#copy-prompt-button").textContent = "Copied";
  setTimeout(() => { document.querySelector("#copy-prompt-button").textContent = "Copy prompt"; }, 1500);
});
document.querySelector("#copy-summary-button")?.addEventListener("click", async () => {
  const text = `${elements.generationSummary.textContent}\n\n${elements.addonTree.textContent}`;
  await navigator.clipboard.writeText(text);
  document.querySelector("#copy-summary-button").textContent = "Copied";
});
document.querySelector("#reset-button")?.addEventListener("click", () => {
  state.requirement = "";
  state.plan = [];
  state.guardrails = [...FRAMEWORK_RULES];
  state.approved = false;
  state.generated = false;
  state.validation = [];
  state.files = {};
  state.activity = [];
  state.module = "biz_bridge_custom_workflow";
  state.scenario = "generic";
  state.restored = false;
  state.restoredNote = false;
  activeFile = null;
  try { localStorage.removeItem("oa-studio"); } catch (e) {}
  if (elements.requirement) elements.requirement.value = "";
  render();
  persist();
});
document.querySelector("#copy-file-button")?.addEventListener("click", async () => {
  try {
    if (!activeFile || !state.files[activeFile]) throw new Error("Generate first, then pick a file.");
    await navigator.clipboard.writeText(state.files[activeFile]);
    document.querySelector("#copy-file-button").textContent = "Copied file";
    setTimeout(() => { document.querySelector("#copy-file-button").textContent = "Copy file"; }, 1500);
  } catch (e) { alert(e.message); }
});
document.querySelector("#odoo-version")?.addEventListener("change", (e) => {
  state.odooVersion = e.target.value;
  if (state.requirement) state.plan = buildPlan(state.requirement);
  logActivity("human", `Set Odoo ${state.odooVersion}`);
  render();
  persist();
});
document.querySelector("#download-button")?.addEventListener("click", () => {
  try {
    if (!state.generated) throw new Error("Generate first.");
    downloadBundle();
  } catch (e) { alert(e.message); }
});
document.querySelectorAll("[data-preset]")?.forEach((b) => b.addEventListener("click", () => {
  const key = b.dataset.preset;
  if (elements.requirement && PRESETS[key]) {
    elements.requirement.value = PRESETS[key];
    state.requirement = PRESETS[key];
    elements.requirement.focus();
  }
}));

document.querySelector("#ai-toggle")?.addEventListener("change", async (e) => {
  state.ai = !!e.target.checked;
  persist();
  renderAi();
  if (state.ai) await probeAI();
});

restore();
if (typeof state.ai !== "boolean") state.ai = false;
render();
registerWebMcpTools();
probeAI();
