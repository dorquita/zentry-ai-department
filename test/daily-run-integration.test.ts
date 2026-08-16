import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveHumanDecisions } from "../src/approvals/manual/decision";
import { buildNumberedProposals } from "../src/approvals/manual/proposal";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentApplySummary } from "../src/department/apply/types";
import { buildDailyBriefEmail, departmentHealthReport } from "../src/department/brief-email";
import { DepartmentDailyBrief } from "../src/department/daily-brief";
import { buildDepartmentHealth, isInternalTechnicalItem } from "../src/department/department-health";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { StagingInventory, StagingPageSnapshot, STAGING_INVENTORY_CONTRACT_VERSION } from "../src/department/staging-inventory";
import { buildChangePlanFromDraft } from "../src/department/web-engineer-changeplan";
import { buildDepartmentWebEngineerContext } from "../src/department/web-engineer-input";
import { DepartmentStageRecord } from "../src/department/types";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

/**
 * INTEGRACION del ChangePlan ejecutable en la pasada diaria.
 *
 * Los tests de `web-engineer-changeplan.test.ts` cubren la construccion
 * del plan y su ejecucion. Este fichero cubre lo que pasa ALREDEDOR:
 *
 * - que una propuesta ACTIONABLE llega al Daily Brief con todo lo que la
 *   hace aprobable (pageId real, BEFORE real, camino de ejecucion),
 * - que un fallo tecnico interno NO se convierte en una propuesta
 *   numerada de negocio,
 * - que un Daily Brief viejo no ejecuta lo que no es,
 * - que lo que QA bloqueo nunca llega a web-engineer,
 * - y que por este camino no aparece Telegram, ni Cloudflare, ni ningun
 *   secreto.
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const RUN_ID = "dept-2026-08-16T070000Z";
const NOW = new Date("2026-08-16T07:00:00.000Z");

const PAGE_1867: StagingPageSnapshot = {
  wordpressPageId: 1867,
  slug: "taquillas-vestuarios",
  stagingUrl: "https://staging.zentrylockers.com/taquillas-vestuarios/",
  status: "publish",
  title: "Taquillas para vestuarios",
  excerpt: "Taquillas para vestuarios de empresa.",
  contentHtml: [
    "<!-- wp:heading --><h2>Problemas habituales</h2><!-- /wp:heading -->",
    "<!-- wp:paragraph --><p>Llaves perdidas y candados forzados.</p><!-- /wp:paragraph -->",
  ].join("\n"),
  meta: { _yoast_wpseo_title: "Taquillas vestuarios | Zentry", _yoast_wpseo_metadesc: "Taquillas para vestuarios." },
};

function inventory(pages: StagingPageSnapshot[] = [PAGE_1867]): StagingInventory {
  return { contractVersion: STAGING_INVENTORY_CONTRACT_VERSION, capturedAt: NOW.toISOString(), pages, unavailableReason: "" };
}

const SPEC: WebEngineerOutput = {
  implementationSummary: "Actualizar el H2 de la pagina de vestuarios.",
  targetPages: ["https://staging.zentrylockers.com/taquillas-vestuarios/"],
  targetComponents: [],
  proposedChanges: [
    {
      description: "Reescribir el H2 de vestuarios: el actual no cita la keyword objetivo.",
      rationale: "Reescribir el H2 de vestuarios",
      targetPageOrComponent: "https://staging.zentrylockers.com/taquillas-vestuarios/",
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

function recommendation(rank: number, title: string, decision: "promoted" | "blocked" = "promoted", blockedBy: string[] = []) {
  return { rank, title, rationale: "r", impact: "high", confidence: "high", effort: "low", dependsOn: [], evidenceRefs: ["dept-seo-1"], decision, blockedBy, qaWarnings: [] };
}

function promotionWith(promoted: ReturnType<typeof recommendation>[], blocked: ReturnType<typeof recommendation>[] = []): DepartmentPromotionResult {
  return {
    departmentRunId: RUN_ID,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: promoted as DepartmentPromotionResult["promoted"],
    blocked: blocked as DepartmentPromotionResult["blocked"],
    unattributedBlockingSignals: [],
    qaSummary: null,
  };
}

/** El H2 nuevo, con el resto del cuerpo intacto: es el `post_content` ENTERO. */
const NEW_CONTENT = PAGE_1867.contentHtml.replace("Problemas habituales", "Problemas habituales de las taquillas de vestuario");

function resolvedPlan(recommendationRank = 1) {
  return buildChangePlanFromDraft({
    draft: {
      recommendationId: `${RUN_ID}#rec-${recommendationRank}`,
      targetPage: "https://staging.zentrylockers.com/taquillas-vestuarios/",
      operation: "update_post_content",
      newValue: NEW_CONTENT,
      rationale: "El H2 actual no cita la keyword objetivo.",
    },
    inventory: inventory(),
  });
}

function applyWithPlan(): DepartmentApplySummary {
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion: promotionWith([recommendation(1, "Reescribir el H2 de vestuarios")]),
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: [],
    resolvedChangePlans: [resolvedPlan()],
    now: NOW,
  });
}

function stage(name: string, status: DepartmentStageRecord["status"], reason: string): DepartmentStageRecord {
  return { stage: name as DepartmentStageRecord["stage"], phase: "specialists", status, reason, outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() };
}

const ALL_STAGES_OK: DepartmentStageRecord[] = [
  stage("seo-specialist", "executed", "ok"),
  stage("content-strategist", "executed", "ok"),
  stage("analytics-specialist", "executed", "ok"),
  stage("sem-specialist", "not_available", "fuera de esta fase"),
  stage("growth-director-v2", "executed", "ok"),
  stage("qa-reviewer", "executed", "ok"),
  stage("web-engineer", "executed", "ok"),
];

function brief(overrides: Partial<DepartmentDailyBrief> = {}): DepartmentDailyBrief {
  const section = { employee: "x", status: "executed" as const, headline: "h", bullets: ["b"] };
  return {
    contractVersion: "department-run/v1",
    departmentRunId: RUN_ID,
    generatedAt: NOW.toISOString(),
    executiveSummary: { discovered: ["d1", "d2"], needsAttention: ["a1"], changed: ["c1"] },
    topPriorities: [],
    sections: { seo: section, content: section, analytics: section, growth: section, qa: section, webEngineering: section },
    blockedOrUnknown: [],
    approvalsNeeded: [],
    stageStatuses: ALL_STAGES_OK,
    departmentQaStatus: "PASS",
    externalWrites: "none",
    apply: null,
    cost: null,
    note: "nota",
    ...overrides,
  };
}

export function runDailyRunIntegrationTests(): TestCase[] {
  return [
    // --- Daily Brief: la propuesta ACTIONABLE se ve entera --------------
    {
      name: "Una propuesta con ChangePlan sale ACTIONABLE en el email con pageId real, BEFORE real, AFTER, operacion y camino de ejecucion",
      fn: () => {
        const apply = applyWithPlan();
        const [proposal] = buildNumberedProposals(apply);
        assert.equal(proposal.proposalStatus, "ACTIONABLE");
        assert.equal(proposal.wordpressPageId, 1867);
        assert.equal(proposal.operation, "update_post_content");
        assert.equal(proposal.executionPath, "execute_php_fallback");

        const email = buildDailyBriefEmail({ brief: brief(), apply, cost: null, runUrl: "" });
        assert.ok(email.text.includes("ESTADO: ACTIONABLE"), "el estado de la propuesta no sale en el texto");
        assert.ok(email.text.includes("Pagina de WordPress: page_id=1867"));
        assert.ok(email.text.includes("Camino de ejecucion: execute_php_fallback"));
        assert.ok(email.text.includes("Operacion: update_post_content"));
        assert.ok(email.text.includes("ANTES (real, leido de staging)"), "el BEFORE real no se distingue del que aun no se ha leido");
        assert.ok(email.text.includes("Problemas habituales"), "el BEFORE no lleva el contenido real de la pagina");
        assert.ok(email.html.includes("ACTIONABLE"));
      },
    },
    {
      name: "Sin ChangePlan resuelto el email lo dice: no imprime operacion ni pageId vacios como si fueran datos",
      fn: () => {
        const apply = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: promotionWith([recommendation(1, "Reescribir el H2 de vestuarios")]),
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: [],
          now: NOW,
        });
        const [proposal] = buildNumberedProposals(apply);
        assert.equal(proposal.proposalStatus, "MANUAL");
        const email = buildDailyBriefEmail({ brief: brief(), apply, cost: null, runUrl: "" });
        assert.ok(email.text.includes("ESTADO: MANUAL"));
        assert.ok(email.text.includes("sin ChangePlan resuelto en esta pasada"));
        assert.ok(!email.text.includes("Camino de ejecucion: \n"), "imprime un camino de ejecucion vacio");
      },
    },
    {
      name: "El email explica que ACTIONABLE significa que el sistema sabe ejecutarla",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: brief(), apply: applyWithPlan(), cost: null, runUrl: "" });
        assert.ok(email.text.includes("ESTADO ACTIONABLE significa literalmente: si la apruebas, el sistema sabe ejecutarla"));
      },
    },

    // --- Salud del departamento ----------------------------------------
    {
      name: "Un fallo tecnico interno (seo-specialist failed) va a SALUD DEL DEPARTAMENTO con su politica, no a la lista numerada",
      fn: () => {
        const stages = ALL_STAGES_OK.map((s) => (s.stage === "seo-specialist" ? stage("seo-specialist", "failed", "el step murio por timeout") : s));
        const email = buildDailyBriefEmail({ brief: brief({ stageStatuses: stages }), apply: applyWithPlan(), cost: null, runUrl: "" });
        assert.ok(email.text.includes("6. SALUD DEL DEPARTAMENTO"));
        assert.ok(email.text.includes("[FAILED] seo-specialist"));
        assert.ok(email.text.includes("el step murio por timeout"));
        assert.ok(email.text.includes("Se reintenta en la siguiente pasada diaria"));
        assert.ok(email.text.includes("Estas incidencias son TECNICAS: no se aprueban ni se rechazan."));

        // Y sobre todo: no se ha convertido en una propuesta aprobable.
        const proposals = buildNumberedProposals(applyWithPlan());
        assert.equal(proposals.length, 1);
        assert.ok(!proposals.some((p) => p.title.includes("seo-specialist")));
      },
    },
    {
      name: "Una recomendacion que habla del propio departamento se saca de la lista numerada y aparece como incidencia",
      fn: () => {
        const apply = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: promotionWith([
            recommendation(1, "Reescribir el H2 de vestuarios"),
            recommendation(2, "Arreglar el seo-specialist, que ha fallado dos pasadas seguidas"),
          ]),
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: [],
          resolvedChangePlans: [resolvedPlan(1)],
          now: NOW,
        });
        const proposals = buildNumberedProposals(apply);
        assert.equal(proposals.length, 1, "la incidencia tecnica sigue ocupando un numero de propuesta");
        assert.equal(proposals[0].number, 1);
        assert.ok(!proposals.some((p) => p.title.includes("seo-specialist")));

        const health = departmentHealthReport({ brief: brief(), apply, cost: null, runUrl: "" });
        assert.ok(health.incidents.some((i) => i.detail.includes("seo-specialist")), "la incidencia no se reporta en ningun sitio: se habria perdido");
      },
    },
    {
      name: "El reconocimiento de incidencia interna es conservador: en cuanto hay pagina objetivo, es trabajo del sitio",
      fn: () => {
        const apply = applyWithPlan();
        // La #1 lleva un plan sobre una pagina real. Aunque su titulo
        // citara un componente interno, sigue siendo trabajo del sitio.
        const item = { ...apply.items[0], title: "web-engineer: reescribir el H2 de vestuarios" };
        assert.equal(isInternalTechnicalItem(item), false);
      },
    },
    {
      name: "Si el inventario de staging no se pudo leer, eso es una incidencia tecnica con su motivo, no un silencio",
      fn: () => {
        const email = buildDailyBriefEmail({
          brief: brief(),
          apply: applyWithPlan(),
          cost: null,
          runUrl: "",
          stagingInventoryUnavailableReason: "El REST del core de staging.zentrylockers.com respondio HTTP 401 al leer el inventario de staging.",
        });
        assert.ok(email.text.includes("HTTP 401"));
        assert.ok(email.text.includes("staging-inventory"));
        assert.ok(email.text.includes("Sin inventario real no se resuelve ningun pageId"));
      },
    },
    {
      name: "Con todas las etapas sanas, la salud del departamento lo dice y no fabrica incidencias",
      fn: () => {
        const report = buildDepartmentHealth({ stageStatuses: ALL_STAGES_OK });
        assert.equal(report.healthy, true);
        // SEM sigue apareciendo como pendiente: su ausencia se reporta,
        // no se oculta, pero no es un fallo.
        assert.ok(report.incidents.some((i) => i.component === "sem-specialist" && i.severity === "pending"));
        assert.ok(!report.incidents.some((i) => i.severity === "failed"));
      },
    },
    {
      name: "Una etapa que no aparece en el manifiesto se trata como fallo, nunca como 'seguro que fue bien'",
      fn: () => {
        const report = buildDepartmentHealth({ stageStatuses: ALL_STAGES_OK.filter((s) => s.stage !== "qa-reviewer") });
        assert.equal(report.healthy, false);
        assert.ok(report.incidents.some((i) => i.component === "qa-reviewer" && i.severity === "failed"));
      },
    },

    // --- Aprobacion humana por prompt ----------------------------------
    {
      name: "\"Aprueba 1\" sobre una propuesta con ChangePlan resuelve al recommendationId real y queda ejecutable",
      fn: () => {
        const apply = applyWithPlan();
        const proposals = buildNumberedProposals(apply);
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve" }] });
        assert.equal(result.ok, true);
        assert.equal(result.decisions.length, 1);
        const [decision] = result.decisions;
        assert.equal(decision.executable, true);
        assert.equal(decision.target, "staging", "una aprobacion sin destino explicito NUNCA puede significar produccion");
        assert.equal(decision.proposal.recommendationId, `${RUN_ID}#rec-1`);
        const item = apply.items.find((i) => i.recommendationId === decision.proposal.recommendationId);
        assert.ok(item?.executableChangePlan, "la decision no llega a ningun plan cargable");
        assert.equal(item.executableChangePlan.plan.targetId, 1867);
      },
    },
    {
      name: "Un numero de un Daily Brief VIEJO no ejecuta nada: si no existe en esta pasada, falla la instruccion entera",
      fn: () => {
        const proposals = buildNumberedProposals(applyWithPlan());
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 7, action: "approve" }] });
        assert.equal(result.ok, false);
        assert.equal(result.decisions.length, 0);
        assert.ok(result.errors.some((e) => e.includes("Daily Brief distinto")));
      },
    },
    {
      name: "El silencio queda PENDIENTE: aprobar la 1 no toca la 2",
      fn: () => {
        const apply = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: promotionWith([recommendation(1, "Reescribir el H2 de vestuarios"), recommendation(2, "Otra propuesta distinta")]),
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: [],
          resolvedChangePlans: [resolvedPlan(1)],
          now: NOW,
        });
        const proposals = buildNumberedProposals(apply);
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve" }] });
        assert.equal(result.ok, true);
        assert.equal(result.untouched.length, 1);
        assert.equal(result.untouched[0].number, 2);
        assert.ok(result.interpretation.some((line) => line.includes("El silencio nunca se interpreta como aprobacion")));
      },
    },
    {
      name: "Aprobar una propuesta MANUAL no la ejecuta: se registra y se dice por que no",
      fn: () => {
        const apply = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: promotionWith([recommendation(1, "Reescribir el H2 de vestuarios")]),
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: [],
          now: NOW,
        });
        const proposals = buildNumberedProposals(apply);
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve" }] });
        assert.equal(result.ok, true);
        assert.equal(result.decisions[0].executable, false);
        assert.ok(result.decisions[0].blockedReason.length > 0);
      },
    },

    // --- QA ------------------------------------------------------------
    {
      name: "Lo que QA bloqueo nunca llega a web-engineer, y su elemento de apply no lleva plan ni capacidad",
      fn: () => {
        const promotion = promotionWith(
          [recommendation(1, "Reescribir el H2 de vestuarios")],
          [recommendation(2, "Publicar en produccion las landings nuevas", "blocked", ["QA: las paginas no estan revisadas"])]
        );
        const context = buildDepartmentWebEngineerContext({
          departmentRunId: RUN_ID,
          promotion,
          growthSummary: "resumen",
          evidenceCatalog: [],
          specialistInputs: [],
          stagingInventory: [],
        });
        assert.equal(context.approvedRecommendations.length, 1);
        assert.ok(!context.approvedRecommendations.some((r) => r.title.includes("produccion")));
        assert.equal(context.blockedRecommendations.length, 1);

        const apply = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion,
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: [],
          // Aunque llegara un plan para la bloqueada, no se adjunta.
          resolvedChangePlans: [resolvedPlan(2)],
          now: NOW,
        });
        const blocked = apply.items.find((i) => i.recommendationRank === 2);
        assert.equal(blocked?.executableChangePlan, null);
        assert.equal(blocked?.applyCapability.supported, false);
        assert.equal(blocked?.applyStatus, "blocked");

        const proposals = buildNumberedProposals(apply);
        const blockedProposal = proposals.find((p) => p.recommendationId === `${RUN_ID}#rec-2`);
        assert.equal(blockedProposal?.proposalStatus, "BLOCKED");
        assert.equal(blockedProposal?.actionable, false);
      },
    },

    // --- Fuera de alcance y secretos -----------------------------------
    {
      name: "El camino del ChangePlan no toca Telegram ni Cloudflare: ningun modulo de la cadena los importa",
      fn: () => {
        const chain = [
          "src/department/staging-inventory.ts",
          "src/department/web-engineer-changeplan.ts",
          "src/department/department-health.ts",
          "src/adapters/staging-inventory-reader.ts",
          "src/department/apply/execute-php-executor.ts",
          "src/core/execute-php-guard.ts",
          "src/core/execute-php-builder.ts",
          "src/core/execute-php-operations.ts",
        ];
        for (const file of chain) {
          const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
          const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
          for (const imported of imports) {
            assert.ok(!/telegram/i.test(imported), `${file} importa Telegram: ${imported}`);
            assert.ok(!/cloudflare|worker|\bd1\b/i.test(imported), `${file} importa el carril serverless: ${imported}`);
          }
        }
      },
    },
    {
      name: "Ni el Daily Brief ni las propuestas numeradas llevan credenciales: no aparece ningun valor de WP_API_*",
      fn: () => {
        const secrets = ["WP_API_PASSWORD", "WP_API_USERNAME", "NOVAMIRA_API_KEY", "SMTP_PASSWORD"];
        const previous = secrets.map((key) => [key, process.env[key]] as const);
        for (const key of secrets) process.env[key] = `valor-secreto-de-${key}`;
        try {
          const apply = applyWithPlan();
          const email = buildDailyBriefEmail({ brief: brief(), apply, cost: null, runUrl: "" });
          const rendered = `${email.subject}\n${email.text}\n${email.html}\n${JSON.stringify(buildNumberedProposals(apply))}\n${JSON.stringify(apply)}`;
          for (const key of secrets) {
            assert.ok(!rendered.includes(`valor-secreto-de-${key}`), `el valor de ${key} aparece en la salida`);
          }
        } finally {
          for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      },
    },
    {
      name: "El plan persistido solo lleva las operaciones del catalogo de esta fase: nada de redirecciones, media, usuarios, plugins ni SQL",
      fn: () => {
        const resolved = resolvedPlan();
        assert.equal(resolved.status, "ACTIONABLE");
        assert.ok(["update_post_content", "update_post_title", "update_post_excerpt", "update_post_meta"].includes(resolved.plan!.operation));
        const serialized = JSON.stringify(resolved.plan);
        for (const forbidden of ["wp_insert_user", "wp_redirect", "wp_delete", "install_plugin", "switch_theme", "$wpdb", "shell_exec"]) {
          assert.ok(!serialized.includes(forbidden), `el plan persistido menciona ${forbidden}`);
        }
      },
    },
  ];
}
