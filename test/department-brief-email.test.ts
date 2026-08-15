import * as assert from "node:assert/strict";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentApplySummary } from "../src/department/apply/types";
import { buildDailyBriefEmail, buildDailyBriefSubject, buildExecutiveLines, escapeHtml, MAX_EMAIL_PRIORITIES } from "../src/department/brief-email";
import { DepartmentDailyBrief } from "../src/department/daily-brief";
import { containsSecretValue, DAILY_BRIEF_EMAIL_TO_VAR, resolveDailyBriefEmailConfig } from "../src/department/email-config";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const RUN_ID = "dept-2026-08-15T120000Z";
const NOW = new Date("2026-08-15T12:00:00.000Z");

function priority(rank: number, overrides: Partial<DepartmentDailyBrief["topPriorities"][number]> = {}): DepartmentDailyBrief["topPriorities"][number] {
  return {
    rank,
    action: `Prioridad numero ${rank}`,
    reason: "239 impresiones con CTR 0% en la familia melamina.",
    impact: "medium",
    confidence: "high",
    effort: "low",
    evidence: [{ ref: "dept-seo-1", description: "239 impresiones, CTR 0%", originEmployees: ["seo-specialist"] }],
    originEmployees: ["seo-specialist"],
    qaStatus: "PASS",
    qaNotes: [],
    approvalRequired: true,
    dependsOn: [],
    hasEngineeringSpec: true,
    ...overrides,
  };
}

function brief(overrides: Partial<DepartmentDailyBrief> = {}): DepartmentDailyBrief {
  const section = { employee: "x", status: "executed" as const, headline: "h", bullets: ["b"] };
  return {
    contractVersion: "department-run/v1",
    departmentRunId: RUN_ID,
    generatedAt: NOW.toISOString(),
    executiveSummary: { discovered: ["Descubrimiento uno", "Descubrimiento dos"], needsAttention: ["Atencion uno"], changed: ["Cambio uno"] },
    topPriorities: [priority(1), priority(2)],
    sections: { seo: section, content: section, analytics: section, growth: section, qa: section, webEngineering: section },
    blockedOrUnknown: ["SEM: pendiente / temporalmente no disponible -- fuera de esta fase."],
    approvalsNeeded: [{ decision: 'APROBAR o RECHAZAR: "Reescribir metas de familia melamina"', why: "Impacto medium, confianza high, esfuerzo low. 239 impresiones / CTR 0%.", qaStatus: "PASS", origin: "seo-specialist" }],
    stageStatuses: [
      { stage: "seo-specialist", phase: "specialists", status: "executed", reason: "ok", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
      { stage: "sem-specialist", phase: "specialists", status: "not_available", reason: "pendiente", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
    ],
    departmentQaStatus: "PASS",
    externalWrites: "none",
    apply: null,
    cost: null,
    note: "nota de seguridad",
    ...overrides,
  };
}

const SPEC: WebEngineerOutput = {
  implementationSummary: "Actualizar metas.",
  targetPages: ["https://staging.zentrylockers.com/?page_id=2091"],
  targetComponents: [],
  proposedChanges: [
    {
      // Cita el titulo EXACTO de la prioridad #1 (mismo criterio de
      // atribucion literal que usa la puerta de QA) y trae el bloque
      // maquina TITLE/META sobre una pagina de staging propia.
      description: "Prioridad numero 1: reescribir metas.\nTITLE: Taquillas de melamina | Zentry\nMETA: Taquillas de melamina para vestuarios.",
      rationale: "CTR 0%.",
      targetPageOrComponent: "https://staging.zentrylockers.com/?page_id=2091",
    },
  ],
  filesOrSystemsAffected: [],
  acceptanceCriteria: [],
  validationPlan: [],
  rollbackPlan: [],
  dependencies: [],
  risks: [],
  approvalRequired: true,
  unknowns: [],
};

function applySummary(): DepartmentApplySummary {
  const promotion: DepartmentPromotionResult = {
    departmentRunId: RUN_ID,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: [
      { rank: 1, title: "Prioridad numero 1", rationale: "r", impact: "medium", confidence: "high", effort: "low", dependsOn: [], evidenceRefs: ["dept-seo-1"], decision: "promoted", blockedBy: [], qaWarnings: [] },
      { rank: 2, title: "Prioridad numero 2", rationale: "r", impact: "low", confidence: "low", effort: "high", dependsOn: [], evidenceRefs: [], decision: "promoted", blockedBy: [], qaWarnings: [] },
    ],
    blocked: [],
    unattributedBlockingSignals: [],
    qaSummary: null,
  };
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion,
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: [{ wordpressPageId: 2091, stagingUrl: "https://staging.zentrylockers.com/?page_id=2091" }],
    approvalRequests: [],
    now: NOW,
  });
}

const COST = summarizeDepartmentRunCost([
  { employee: "seo-specialist", model: "claude-x", durationMs: 60_000, costUsd: 0.12, numTurns: 3, outputSource: "structured_output", outcome: "success", note: "" },
  { employee: "qa-reviewer", model: "claude-x", durationMs: 30_000, costUsd: 0.05, numTurns: 2, outputSource: "execution_file_fallback", outcome: "success", note: "" },
]);

export function runDepartmentBriefEmailTests(): TestCase[] {
  return [
    // --- Asunto y estructura ---
    {
      name: "El asunto sigue el formato pedido: Zentry AI Department — Daily Brief — <fecha>",
      fn: () => {
        assert.equal(buildDailyBriefSubject("2026-08-15"), "Zentry AI Department — Daily Brief — 2026-08-15");
        const email = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        assert.equal(email.subject, "Zentry AI Department — Daily Brief — 2026-08-15");
      },
    },
    {
      name: "El resumen ejecutivo tiene entre 5 y 8 lineas (nunca un volcado)",
      fn: () => {
        const lines = buildExecutiveLines({ brief: brief(), apply: applySummary(), cost: COST, runUrl: "" });
        assert.ok(lines.length >= 5 && lines.length <= 8, `resumen ejecutivo con ${lines.length} lineas`);
      },
    },
    {
      name: "El texto plano incluye TODAS las secciones pedidas por el contrato del email",
      fn: () => {
        const { text } = buildDailyBriefEmail({ brief: brief(), apply: applySummary(), cost: COST, runUrl: "https://github.com/x/y/actions/runs/1" });
        for (const section of [
          "1. RESUMEN EJECUTIVO",
          "2. TOP PRIORITIES",
          "3. APPROVALS NEEDED",
          "4. ESTADO DE APPLY",
          "5. BLOCKED / UNKNOWN",
          "6. ESTADO DEL DEPARTAMENTO",
          "7. COSTE DE LA PASADA",
          "8. RUN DE GITHUB",
          "9. SEGURIDAD",
        ]) {
          assert.ok(text.includes(section), `falta la seccion "${section}"`);
        }
      },
    },
    {
      name: "Cada prioridad trae titulo, por que importa, impacto, confianza, esfuerzo, evidencia, QA, accion y si necesita aprobacion",
      fn: () => {
        const { text } = buildDailyBriefEmail({ brief: brief(), apply: applySummary(), cost: COST, runUrl: "" });
        assert.ok(text.includes("1. Prioridad numero 1"));
        assert.ok(text.includes("Por que importa:"));
        assert.ok(text.includes("Impacto: medium | Confianza: high | Esfuerzo: low"));
        assert.ok(text.includes("Evidencia: dept-seo-1"));
        assert.ok(text.includes("QA status: PASS"));
        assert.ok(text.includes("Accion propuesta:"));
        assert.ok(text.includes("Necesita aprobacion: SI"));
      },
    },
    {
      name: "APPROVALS NEEDED sale muy visible, con el marcador [APPROVAL REQUIRED] en texto y en HTML",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: brief(), apply: applySummary(), cost: COST, runUrl: "" });
        assert.ok(email.text.includes("[APPROVAL REQUIRED]"));
        assert.ok(email.html.includes("[APPROVAL REQUIRED]"));
      },
    },
    {
      name: "BLOCKED / UNKNOWN sigue diciendo que SEM esta pendiente",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        assert.ok(email.text.includes("SEM: pendiente"));
        assert.ok(email.html.includes("SEM: pendiente"));
      },
    },
    {
      name: "El estado del departamento lista los seis empleados mas SEM",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        for (const employee of ["SEO", "Content", "Analytics", "SEM", "Growth", "QA", "Web Engineer"]) {
          assert.ok(email.text.includes(`- ${employee}:`), `falta el estado de ${employee}`);
        }
      },
    },
    {
      name: "El mensaje de seguridad aparece literal en texto y HTML",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        const expected = "Solo las acciones que hayan pasado la puerta de aprobacion correspondiente pueden ejecutarse mediante APPLY";
        assert.ok(email.text.includes(expected));
        assert.ok(email.html.includes(expected));
      },
    },
    {
      name: "El link al run aparece si existe, y si no se dice explicitamente (no se inventa)",
      fn: () => {
        const withUrl = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "https://github.com/o/r/actions/runs/42" });
        assert.ok(withUrl.text.includes("https://github.com/o/r/actions/runs/42"));
        assert.ok(withUrl.html.includes('href="https://github.com/o/r/actions/runs/42"'));
        const withoutUrl = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        assert.ok(withoutUrl.text.includes("no hay URL de run"));
      },
    },

    // --- APPLY en el email ---
    {
      name: "El email distingue los estados de APPLY con sus etiquetas propias",
      fn: () => {
        const summary = applySummary();
        const email = buildDailyBriefEmail({ brief: brief(), apply: summary, cost: COST, runUrl: "" });
        assert.ok(email.text.includes("READY FOR APPROVAL"), "la prioridad con executor espera aprobacion");
        assert.ok(email.text.includes("REQUIRES MANUAL IMPLEMENTATION"), "la prioridad sin executor se marca como manual");
        assert.ok(email.html.includes("READY FOR APPROVAL"));
      },
    },

    // --- Priorizacion / volumen ---
    {
      name: "El email nunca lista 40 tareas: corta en 8 prioridades y dice cuantas quedan fuera",
      fn: () => {
        const many = brief({ topPriorities: Array.from({ length: 12 }, (_, i) => priority(i + 1)) });
        const email = buildDailyBriefEmail({ brief: many, apply: null, cost: null, runUrl: "" });
        assert.ok(email.text.includes(`${12 - MAX_EMAIL_PRIORITIES} prioridad(es) adicional(es)`));
        assert.ok(!email.text.includes("9. Prioridad numero 9"), "la novena prioridad no entra en el cuerpo");
      },
    },
    {
      name: "Una pasada sin prioridades lo dice, en vez de rellenar con recomendaciones genericas",
      fn: () => {
        const empty = brief({ topPriorities: [], approvalsNeeded: [] });
        const email = buildDailyBriefEmail({ brief: empty, apply: null, cost: null, runUrl: "" });
        assert.ok(email.text.includes("Ninguna prioridad del departamento en esta pasada"));
        assert.ok(email.text.includes("Ninguna decision pendiente"));
      },
    },

    // --- Coste ---
    {
      name: "El coste total aparece si hay datos, y se declara no reportado si no los hay (nunca 0 inventado)",
      fn: () => {
        const withCost = buildDailyBriefEmail({ brief: brief(), apply: null, cost: COST, runUrl: "" });
        assert.ok(withCost.text.includes("0.1700 USD"), "el total es la suma de los costes realmente reportados");
        const withoutCost = buildDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "" });
        assert.ok(withoutCost.text.includes("no reportado"));
        assert.ok(!withoutCost.text.includes("0.0000 USD"));
      },
    },

    // --- Seguridad del render ---
    {
      name: "El HTML escapa el contenido: una accion con etiquetas no puede inyectar markup",
      fn: () => {
        const dirty = brief({ topPriorities: [priority(1, { action: '<script>alert("x")</script>' })] });
        const email = buildDailyBriefEmail({ brief: dirty, apply: null, cost: null, runUrl: "" });
        assert.ok(!email.html.includes("<script>"), "el HTML no puede contener el script sin escapar");
        assert.ok(email.html.includes("&lt;script&gt;"));
        assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
      },
    },
    {
      name: "El email construido no contiene el valor de ninguna variable sensible",
      fn: () => {
        const env = { SMTP_PASS: "clave-super-secreta-1234", SMTP_USER: "usuario@zentry.example" };
        const email = buildDailyBriefEmail({ brief: brief(), apply: applySummary(), cost: COST, runUrl: "" });
        assert.equal(containsSecretValue(`${email.subject}\n${email.text}\n${email.html}`, env, ["SMTP_PASS", "SMTP_USER"]), null);
        // Y el detector funciona de verdad cuando SI hay una fuga.
        assert.equal(containsSecretValue("texto con clave-super-secreta-1234 dentro", env, ["SMTP_PASS"]), "SMTP_PASS");
      },
    },

    // --- Configuracion del destinatario ---
    {
      name: "El destinatario sale de DAILY_BRIEF_EMAIL_TO cuando existe",
      fn: () => {
        const config = resolveDailyBriefEmailConfig({
          env: {
            DAILY_BRIEF_EMAIL_TO: "director@zentry.example",
            REPORT_EMAIL_TO: "otro@zentry.example",
            SMTP_HOST: "h",
            SMTP_PORT: "587",
            SMTP_SECURE: "false",
            SMTP_USER: "u",
            SMTP_PASS: "p",
            REPORT_EMAIL_FROM: "f",
          },
          fallbackRecipientVar: "REPORT_EMAIL_TO",
        });
        assert.equal(config.configured, true);
        assert.equal(config.to, "director@zentry.example");
        assert.equal(config.recipientVar, DAILY_BRIEF_EMAIL_TO_VAR);
      },
    },
    {
      name: "Sin DAILY_BRIEF_EMAIL_TO se usa el destinatario del cliente activo como fallback explicito",
      fn: () => {
        const config = resolveDailyBriefEmailConfig({
          env: { REPORT_EMAIL_TO: "informes@zentry.example", SMTP_HOST: "h", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "u", SMTP_PASS: "p", REPORT_EMAIL_FROM: "f" },
          fallbackRecipientVar: "REPORT_EMAIL_TO",
        });
        assert.equal(config.configured, true);
        assert.equal(config.recipientVar, "REPORT_EMAIL_TO");
      },
    },
    {
      name: "Sin configuracion NO se envia nada y se listan los NOMBRES de las variables que faltan (nunca valores)",
      fn: () => {
        const config = resolveDailyBriefEmailConfig({ env: {}, fallbackRecipientVar: "REPORT_EMAIL_TO" });
        assert.equal(config.configured, false);
        assert.ok(config.missing.includes("SMTP_HOST"));
        assert.ok(config.missing.includes("SMTP_PASS"));
        assert.ok(config.missing.some((m) => m.includes(DAILY_BRIEF_EMAIL_TO_VAR)));
        assert.match(config.reason, /NO se envia ningun correo/);
      },
    },
    {
      name: "Una variable presente pero vacia cuenta como ausente (fail-closed)",
      fn: () => {
        const config = resolveDailyBriefEmailConfig({
          env: { DAILY_BRIEF_EMAIL_TO: "  ", SMTP_HOST: "h", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "u", SMTP_PASS: "p", REPORT_EMAIL_FROM: "f" },
          fallbackRecipientVar: "REPORT_EMAIL_TO",
        });
        assert.equal(config.configured, false);
      },
    },
  ];
}
