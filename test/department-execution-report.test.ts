import * as assert from "node:assert/strict";
import { ResolvedDecision } from "../src/approvals/manual/decision";
import { buildNumberedProposals, NumberedProposal } from "../src/approvals/manual/proposal";
import { buildApplyPlan } from "../src/department/apply/plan";
import { escapeHtml } from "../src/department/brief-email";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import {
  buildExecutionReportEmail,
  ExecutedWork,
  ExecutionNewRecommendation,
  ExecutionReportInput,
  ExecutionRollback,
} from "../src/department/execution-report";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { NOW, OWNED_PAGES, PROMOTION, RUN_ID, SPEC } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Las propuestas del informe de ejecucion son las MISMAS que numera el
 * Daily Brief: se construyen con `buildNumberedProposals` sobre un plan de
 * apply real, no a mano. Si el contrato cambiara, estos tests se enteran.
 */
function proposals(): NumberedProposal[] {
  const promotion: DepartmentPromotionResult = {
    ...PROMOTION,
    promoted: [
      PROMOTION.promoted[0],
      { ...PROMOTION.promoted[0], rank: 2, title: "Rehacer la home de Tukandado", evidenceRefs: [] },
      { ...PROMOTION.promoted[0], rank: 3, title: "Anadir FAQ a la familia fenolica", evidenceRefs: [] },
    ],
  };
  const summary = buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion,
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: OWNED_PAGES,
    now: NOW,
  });
  return buildNumberedProposals(summary);
}

function decision(proposal: NumberedProposal, overrides: Partial<ResolvedDecision> = {}): ResolvedDecision {
  return {
    proposal,
    action: "approve",
    target: "staging",
    reason: "",
    overrides: {},
    executable: true,
    blockedReason: "",
    ...overrides,
  };
}

function work(proposal: NumberedProposal, overrides: Partial<ExecutedWork> = {}): ExecutedWork {
  return {
    decision: decision(proposal),
    action: "Actualizar title y meta description de page_id=2091 en staging",
    environment: "staging",
    changes: [
      { field: "title", before: "Titulo antiguo", after: "Taquillas de melamina para vestuarios | Zentry" },
      { field: "meta description", before: "Meta antigua", after: "Taquillas de melamina resistentes para vestuarios y colegios." },
    ],
    validation: "La pagina sigue publicada y devuelve 200 con el nuevo title",
    outcome: "applied",
    outcomeDetail: "",
    url: "https://staging.zentrylockers.com/taquillas-melamina/",
    rollback: null,
    ...overrides,
  };
}

const COST = summarizeDepartmentRunCost([
  { employee: "seo-specialist", model: "claude-x", durationMs: 60_000, costUsd: 0.12, numTurns: 3, outputSource: "structured_output", outcome: "success", note: "" },
]);

function input(overrides: Partial<ExecutionReportInput> = {}): ExecutionReportInput {
  const all = proposals();
  return {
    generatedAt: "2026-08-15T18:30:00.000Z",
    runIds: {
      departmentRunId: RUN_ID,
      executionRunId: "exec-2026-08-15T183000Z",
      briefRunUrl: "https://github.com/o/r/actions/runs/42",
      executionRunUrl: "",
    },
    executed: [work(all[0])],
    pending: [all[2]],
    rejected: [decision(all[1], { action: "reject", executable: false, reason: "No me convence el copy" })],
    newRecommendations: [],
    writes: { staging: 1, production: 0 },
    cost: COST,
    ...overrides,
  };
}

const FAILED_ROLLBACK: ExecutionRollback = {
  performed: true,
  reason: "La validacion posterior no encontro el nuevo title en la pagina",
  status: "rollback_failed",
  detail: "La escritura de restauracion devolvio 500: la pagina sigue con el title nuevo",
};

export function runDepartmentExecutionReportTests(): TestCase[] {
  return [
    // --- Estructura ---
    {
      name: "El informe trae las cuatro secciones del contrato mas escrituras, coste y run ids",
      fn: () => {
        const email = buildExecutionReportEmail(input());
        for (const section of [
          "TRABAJOS REALIZADOS",
          "PENDIENTES",
          "RECHAZADAS",
          "NUEVAS RECOMENDACIONES",
          "ESCRITURAS REALES",
          "COSTE",
          "TRAZABILIDAD (RUN IDS)",
        ]) {
          assert.ok(email.text.includes(section), `falta la seccion "${section}" en el texto`);
          assert.ok(email.html.includes(escapeHtml(section)), `falta la seccion "${section}" en el HTML`);
        }
      },
    },
    {
      name: "El asunto dice cuantas se ejecutaron, rechazaron y quedaron pendientes, y avisa si hubo incidencias",
      fn: () => {
        const sane = buildExecutionReportEmail(input());
        assert.ok(sane.subject.startsWith("Zentry AI Department — Ejecucion — 2026-08-15"));
        assert.ok(sane.subject.includes("1 ejecutada(s), 1 rechazada(s), 1 pendiente(s)"));
        assert.ok(!sane.subject.includes("incidencia"), "sin fallos no se anuncia ninguna incidencia");

        const all = proposals();
        const broken = buildExecutionReportEmail(input({ executed: [work(all[0], { outcome: "failed", outcomeDetail: "WordPress devolvio 500" })] }));
        assert.ok(broken.subject.includes("1 con incidencia"), "un fallo tiene que verse ya en el asunto");

        // Una aprobacion que no llego a escribir NO puede contarse como
        // ejecutada en el asunto: se cuenta aparte y se dice.
        const notExecuted = buildExecutionReportEmail(
          input({ executed: [work(all[0], { outcome: "not_executed", outcomeDetail: "Sin executor determinista para esta propuesta." })] })
        );
        assert.ok(notExecuted.subject.includes("0 ejecutada(s)"), "nada se escribio: 0 ejecutadas");
        assert.ok(notExecuted.subject.includes("1 aprobada(s) sin ejecutar"), "la aprobacion no ejecutada tiene que verse en el asunto");
        assert.ok(!notExecuted.subject.includes("con incidencia"), "no ejecutar por falta de executor no es una incidencia de escritura");
      },
    },

    // --- TRABAJOS REALIZADOS ---
    {
      name: "Cada trabajo ejecutado sale con su NUMERO y con su ID real, igual que en el Daily Brief",
      fn: () => {
        const data = input();
        const email = buildExecutionReportEmail(data);
        for (const executed of data.executed) {
          const proposal = executed.decision.proposal;
          assert.ok(email.text.includes(`[ ${proposal.number} ]  ${proposal.title}`), `falta el numero ${proposal.number} junto a su titulo`);
          assert.ok(email.text.includes(`id: ${proposal.id}`), "falta el id real del trabajo ejecutado");
          assert.ok(email.text.includes(`recommendationId: ${proposal.recommendationId}`));
          assert.ok(email.html.includes(`>${proposal.number}</span>`));
          assert.ok(email.html.includes(escapeHtml(proposal.id)));
        }
      },
    },
    {
      name: "Un trabajo ejecutado reporta decision humana, accion, before, after, validacion, resultado y URL",
      fn: () => {
        const data = input();
        const email = buildExecutionReportEmail(data);
        const executed = data.executed[0];
        assert.ok(email.text.includes("Decision humana: APROBADA por una persona para STAGING"));
        assert.ok(email.text.includes(`Accion ejecutada: ${executed.action}`));
        for (const change of executed.changes) {
          assert.ok(email.text.includes(`${change.field}: antes "${change.before}" -> despues "${change.after}"`), `falta el before/after de ${change.field}`);
        }
        assert.ok(email.text.includes(`Validacion: ${executed.validation}`));
        assert.ok(email.text.includes("RESULTADO: APLICADO"));
        assert.ok(email.text.includes(`URL: ${executed.url}`));
        assert.ok(email.html.includes(escapeHtml(executed.action)));
        assert.ok(email.html.includes(escapeHtml(executed.url)));
      },
    },
    {
      name: "Aprobar CON MODIFICACIONES no se reporta como una aprobacion normal: las modificaciones pedidas se ven",
      fn: () => {
        const all = proposals();
        const modified = work(all[0], { decision: decision(all[0], { overrides: { title: "Taquillas de melamina | Zentry" } }) });
        const email = buildExecutionReportEmail(input({ executed: [modified] }));
        assert.ok(email.text.includes('con modificaciones pedidas (title := "Taquillas de melamina | Zentry")'));
      },
    },
    {
      name: "Un dato que no se sabe se dice 'no reportado': un before desconocido no se rellena con el after",
      fn: () => {
        const all = proposals();
        const blind = work(all[0], { changes: [{ field: "title", before: "", after: "Titulo nuevo" }], validation: "", url: "" });
        const email = buildExecutionReportEmail(input({ executed: [blind] }));
        assert.ok(email.text.includes('title: antes "no reportado" -> despues "Titulo nuevo"'));
        assert.ok(email.text.includes("Validacion: no se ejecuto ninguna validacion (no reportada)"));
        assert.ok(email.text.includes("URL: no reportada"));
        assert.ok(!email.text.includes('antes "Titulo nuevo"'), "el before jamas se copia del after");
      },
    },
    {
      name: "Un ROLLBACK ejecutado se ve, no se esconde: aparece el motivo y el detalle",
      fn: () => {
        const all = proposals();
        const rolled = work(all[0], {
          outcome: "rolled_back",
          outcomeDetail: "El title escrito no aparecia al releer la pagina",
          rollback: { performed: true, reason: "La validacion posterior fallo", status: "rolled_back", detail: "Restaurados title y meta anteriores" },
        });
        const email = buildExecutionReportEmail(input({ executed: [rolled] }));
        assert.ok(email.text.includes("RESULTADO: REVERTIDO (se escribio y se deshizo)"));
        assert.ok(email.text.includes("ROLLBACK EJECUTADO -- el cambio se ha deshecho"));
        assert.ok(email.text.includes("Motivo del rollback: La validacion posterior fallo"));
        assert.ok(email.text.includes("Detalle: Restaurados title y meta anteriores"));
        assert.ok(email.html.includes(escapeHtml("ROLLBACK EJECUTADO -- el cambio se ha deshecho")));
      },
    },
    {
      name: "Un rollback que FALLA se reporta como fallido: el sistema no ha vuelto a su estado anterior",
      fn: () => {
        const all = proposals();
        const email = buildExecutionReportEmail(input({ executed: [work(all[0], { outcome: "validation_failed", rollback: FAILED_ROLLBACK })] }));
        assert.ok(email.text.includes("ROLLBACK FALLIDO -- el sistema NO ha vuelto a su estado anterior"));
        assert.ok(email.text.includes("RESULTADO: VALIDACION FALLIDA"));
        assert.ok(email.html.includes(escapeHtml("ROLLBACK FALLIDO -- el sistema NO ha vuelto a su estado anterior")));
      },
    },
    {
      name: "Una aprobacion que NO se pudo ejecutar se reporta como no ejecutada, no se omite",
      fn: () => {
        const all = proposals();
        const notRun = work(all[1], {
          decision: decision(all[1], { executable: false, blockedReason: "sin executor" }),
          environment: "none",
          changes: [],
          validation: "",
          outcome: "not_executed",
          outcomeDetail: "No hay executor determinista para esta propuesta",
          url: "",
        });
        const email = buildExecutionReportEmail(input({ executed: [notRun] }));
        assert.ok(email.text.includes("RESULTADO: NO EJECUTADO"));
        assert.ok(email.text.includes("Entorno: ninguno (no se escribio en ningun sistema)"));
        assert.ok(email.text.includes("Detalle: No hay executor determinista para esta propuesta"));
      },
    },
    {
      name: "Una sesion sin ejecuciones lo dice explicitamente en vez de dejar la seccion vacia",
      fn: () => {
        const email = buildExecutionReportEmail(input({ executed: [], writes: { staging: 0, production: 0 } }));
        assert.ok(email.text.includes("No se ha ejecutado ninguna propuesta en esta sesion. No se ha escrito en ningun sistema."));
        assert.ok(email.html.includes(escapeHtml("No se ha ejecutado ninguna propuesta en esta sesion.")));
      },
    },

    // --- RECHAZADAS ---
    {
      name: "El motivo de un rechazo se imprime LITERAL, con sus comillas y su markup, sin reescribirlo",
      fn: () => {
        const all = proposals();
        const literal = 'El copy dice "fabricante directo" y <b>no</b> lo somos; ademas el CTA es flojo';
        const email = buildExecutionReportEmail(input({ rejected: [decision(all[1], { action: "reject", executable: false, reason: literal })] }));
        assert.ok(email.text.includes(`Motivo del rechazo (literal): "${literal}"`), "el motivo tiene que salir palabra por palabra");
        // En HTML sigue siendo literal, pero escapado: no puede inyectar markup.
        assert.ok(email.html.includes(escapeHtml(literal)));
        assert.ok(!email.html.includes("<b>no</b>"), "el markup del motivo no puede llegar vivo al HTML");
      },
    },
    {
      name: "Una propuesta rechazada deja claro que no se ha ejecutado nada suyo",
      fn: () => {
        const data = input();
        const email = buildExecutionReportEmail(data);
        const rejected = data.rejected[0].proposal;
        assert.ok(email.text.includes(`[ ${rejected.number} ]  ${rejected.title}`));
        assert.ok(email.text.includes(`id: ${rejected.id}`));
        assert.ok(email.text.includes("No se ha ejecutado nada de esta propuesta."));
      },
    },

    // --- PENDIENTES ---
    {
      name: "Las pendientes dicen explicitamente que el silencio no aprobo nada",
      fn: () => {
        const data = input();
        const email = buildExecutionReportEmail(data);
        const pending = data.pending[0];
        assert.ok(email.text.includes("silencio NUNCA se interpreta como aprobacion"));
        assert.ok(email.text.includes("siguen PENDIENTES"));
        assert.ok(email.text.includes(`[ ${pending.number} ]  ${pending.title}`));
        assert.ok(email.text.includes(`id: ${pending.id}`));
        assert.ok(email.html.includes(escapeHtml("silencio NUNCA se interpreta como aprobacion")));
      },
    },

    // --- NUEVAS RECOMENDACIONES ---
    {
      name: "Las recomendaciones nuevas se marcan como NO ejecutadas y necesitadas de una aprobacion nueva",
      fn: () => {
        const recommendation: ExecutionNewRecommendation = {
          title: "Revisar los enlaces internos de la familia fenolica",
          description: "Al releer la pagina se vieron tres enlaces a URLs que ya no existen.",
          origin: "validacion posterior del executor",
        };
        const email = buildExecutionReportEmail(input({ newRecommendations: [recommendation] }));
        assert.ok(email.text.includes("NO se han ejecutado"));
        assert.ok(email.text.includes("Necesitan una aprobacion nueva"));
        assert.ok(email.text.includes(recommendation.title));
        assert.ok(email.text.includes(`Origen: ${recommendation.origin}`));
        assert.ok(email.html.includes(escapeHtml(recommendation.title)));

        const none = buildExecutionReportEmail(input());
        assert.ok(none.text.includes("Ninguna recomendacion nueva ha salido de esta ejecucion."));
      },
    },

    // --- Escrituras, coste y trazabilidad ---
    {
      name: "Las escrituras en produccion se reportan como 0 cuando son 0: la cifra nunca se omite",
      fn: () => {
        const email = buildExecutionReportEmail(input({ writes: { staging: 3, production: 0 } }));
        assert.ok(email.text.includes("Escrituras en STAGING: 3"));
        assert.ok(email.text.includes("Escrituras en PRODUCCION: 0"));
        assert.ok(email.text.includes("No se ha escrito NADA en produccion en esta ejecucion."));
        assert.ok(email.html.includes(escapeHtml("Escrituras en PRODUCCION: 0")));
      },
    },
    {
      name: "Si SI se escribio en produccion, el informe lo dice y remite a la decision humana de cada escritura",
      fn: () => {
        const email = buildExecutionReportEmail(input({ writes: { staging: 1, production: 2 } }));
        assert.ok(email.text.includes("Escrituras en PRODUCCION: 2"));
        assert.ok(email.text.includes("Se ha escrito en PRODUCCION en esta ejecucion"));
        assert.ok(!email.text.includes("No se ha escrito NADA en produccion"));
      },
    },
    {
      name: "El coste aparece si hay registros, y se declara no reportado si no los hay (nunca un 0 inventado)",
      fn: () => {
        const withCost = buildExecutionReportEmail(input());
        assert.ok(withCost.text.includes("0.1200 USD"));
        const withoutCost = buildExecutionReportEmail(input({ cost: null }));
        assert.ok(withoutCost.text.includes("no reportado"));
        assert.ok(!withoutCost.text.includes("0.0000 USD"));
      },
    },
    {
      name: "Los run ids de la pasada y de la ejecucion viajan siempre, y una URL ausente se declara ausente",
      fn: () => {
        const email = buildExecutionReportEmail(input());
        assert.ok(email.text.includes(`departmentRunId (pasada que produjo las propuestas): ${RUN_ID}`));
        assert.ok(email.text.includes("executionRunId (esta ejecucion): exec-2026-08-15T183000Z"));
        assert.ok(email.text.includes("Run del Daily Brief: https://github.com/o/r/actions/runs/42"));
        assert.ok(email.text.includes("Run de la ejecucion: no reportado (se ejecuto fuera de GitHub Actions)"));
      },
    },

    // --- Seguridad del render ---
    {
      name: "El HTML escapa el contenido: un titulo de propuesta con markup no puede inyectar nada",
      fn: () => {
        const all = proposals();
        const dirty: NumberedProposal = { ...all[0], title: '<script>alert("x")</script>' };
        const email = buildExecutionReportEmail(
          input({ executed: [work(dirty)], rejected: [decision(dirty, { action: "reject", reason: "<img onerror=1>" })], pending: [dirty] })
        );
        assert.ok(!email.html.includes("<script>"), "el HTML no puede contener el script sin escapar");
        assert.ok(!email.html.includes("<img onerror=1>"));
        assert.ok(email.html.includes("&lt;script&gt;"));
      },
    },
    {
      name: "El mensaje de seguridad deja claro que lo que no aparece como ejecutado no se ha ejecutado",
      fn: () => {
        const email = buildExecutionReportEmail(input());
        const expected = "Lo que no aparece como ejecutado no se ha ejecutado.";
        assert.ok(email.text.includes(expected));
        assert.ok(email.html.includes(escapeHtml(expected)));
      },
    },
  ];
}
