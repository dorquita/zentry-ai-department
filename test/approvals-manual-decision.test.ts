import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveHumanDecisions } from "../src/approvals/manual/decision";
import { appendHumanDecision, HumanDecisionRecord, listHumanFeedbackFor } from "../src/approvals/manual/decision-store";
import { buildNumberedProposals, findProposalByNumber } from "../src/approvals/manual/proposal";
import { isServerlessApprovalsEnabled } from "../src/approvals/feature-flag";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { NOW, OWNED_PAGES, PROMOTION, RUN_ID, SPEC } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void;
}

function recommendation(rank: number, title: string) {
  return { ...PROMOTION.promoted[0], rank, title };
}

/** Pasada con varias propuestas, para poder numerar de verdad. */
function summaryWith(count: number, blockedRanks: number[] = []) {
  const promoted = [];
  const blocked = [];
  for (let rank = 1; rank <= count; rank++) {
    const rec = recommendation(rank, `Propuesta numero ${rank}`);
    if (blockedRanks.includes(rank)) blocked.push({ ...rec, decision: "blocked" as const, blockedBy: ["QA la bloqueo"] });
    else promoted.push(rec);
  }
  const promotion: DepartmentPromotionResult = { ...PROMOTION, promoted, blocked };
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion,
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: OWNED_PAGES,
    now: NOW,
  });
}

function withTempStore<T>(fn: (filePath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-decisions-"));
  try {
    return fn(path.join(dir, "department-human-decisions.jsonl"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function record(overrides: Partial<HumanDecisionRecord> = {}): HumanDecisionRecord {
  return {
    decisionId: "d-1",
    departmentRunId: RUN_ID,
    proposalNumber: 1,
    recommendationId: `${RUN_ID}#rec-1`,
    changeId: null,
    recommendationTitle: "Reescribir metas de la familia melamina",
    action: "reject",
    rejectionReason: "No me gusta el H1, quiero el enfoque en cerraduras electronicas.",
    overrides: {},
    target: "staging",
    decidedBy: "pau",
    decidedAt: "2026-08-16T09:00:00.000Z",
    executionStatus: null,
    executionDetail: "",
    ...overrides,
  };
}

export function runApprovalsManualDecisionTests(): TestCase[] {
  return [
    // --- Numeracion ---
    {
      name: "La numeracion es determinista y arranca en 1, siguiendo el rank de la pasada",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(4));
        assert.deepEqual(
          proposals.map((p) => p.number),
          [1, 2, 3, 4]
        );
        assert.deepEqual(
          proposals.map((p) => p.recommendationRank),
          [1, 2, 3, 4]
        );
        // Dos lecturas del mismo brief numeran igual.
        assert.deepEqual(buildNumberedProposals(summaryWith(4)).map((p) => p.id), proposals.map((p) => p.id));
      },
    },
    {
      name: "Se numeran TAMBIEN las no accionables: si no, el 3 del email y el 3 de la persona podrian no coincidir",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(4, [2]));
        assert.equal(proposals.length, 4, "la bloqueada sigue ocupando su numero");
        const blocked = findProposalByNumber(proposals, 2);
        assert.equal(blocked?.actionable, false);
        assert.ok(blocked?.notActionableReason.length ?? 0 > 0, "y dice por que no se puede ejecutar");
        assert.equal(findProposalByNumber(proposals, 3)?.number, 3);
      },
    },
    {
      name: "INVARIANTE: el numero visible coincide con el recommendationRank que imprime el resto del informe",
      fn: () => {
        // Todo el flujo manual se apoya en que "aprueba 3" y el "3" del
        // email sean la MISMA propuesta. Hoy coinciden porque
        // promotion.ts asigna `rank: index + 1` sobre la lista completa
        // (promovidas + bloqueadas), pero nada lo obligaba: si esa
        // numeracion dejara de ser contigua, el email y la persona
        // estarian hablando de propuestas distintas sin que nadie lo
        // note. Este test lo convierte en un fallo de CI.
        for (const count of [1, 3, 6]) {
          for (const proposal of buildNumberedProposals(summaryWith(count))) {
            assert.equal(
              proposal.number,
              proposal.recommendationRank,
              `El numero visible (${proposal.number}) y el rank (${proposal.recommendationRank}) han dejado de coincidir. Si esto cambia a proposito, hay que revisar TODOS los sitios del email que imprimen el rank en crudo.`
            );
          }
        }
        // Y tambien con propuestas bloqueadas por medio, que es cuando
        // seria mas facil que se descolgaran.
        for (const proposal of buildNumberedProposals(summaryWith(5, [2, 4]))) {
          assert.equal(proposal.number, proposal.recommendationRank);
        }
      },
    },
    {
      name: "El numero SIEMPRE viaja con el id real: el numero es para la persona, el id para el sistema",
      fn: () => {
        for (const proposal of buildNumberedProposals(summaryWith(3))) {
          assert.ok(proposal.id.length > 0);
          assert.ok(proposal.recommendationId.includes(RUN_ID), "el id ata la propuesta a SU pasada");
        }
      },
    },

    // --- La regla central ---
    {
      name: "EL SILENCIO NO ES APROBACION: lo no mencionado queda pendiente, nunca aprobado",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(5));
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve" }] });
        assert.equal(result.ok, true);
        assert.equal(result.decisions.length, 1);
        assert.deepEqual(result.untouched.map((p) => p.number), [2, 3, 4, 5]);
        assert.ok(result.interpretation.some((line) => /nunca se interpreta como aprobacion/i.test(line)));
      },
    },
    {
      name: "Un numero que no existe invalida la instruccion ENTERA (probablemente se esta mirando otro informe)",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3));
        const result = resolveHumanDecisions({
          proposals,
          instructions: [
            { number: 1, action: "approve" },
            { number: 9, action: "approve" },
          ],
        });
        assert.equal(result.ok, false, "no se ejecuta NADA, ni siquiera la 1 que si existe");
        assert.ok(result.errors.some((e) => /No existe la propuesta #9/.test(e)));
        assert.ok(result.errors.some((e) => /Daily Brief distinto/i.test(e)));
      },
    },
    {
      name: "El mismo numero con dos acciones distintas es ambiguo: error, no se elige una",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3));
        const result = resolveHumanDecisions({
          proposals,
          instructions: [
            { number: 2, action: "approve" },
            { number: 2, action: "reject", reason: "no me convence" },
          ],
        });
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((e) => /dos acciones distintas/i.test(e)));
      },
    },
    {
      name: "Un rechazo SIN motivo no se acepta: el motivo es el producto del rechazo",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3));
        for (const reason of [undefined, "", "   ", "no"]) {
          const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "reject", reason }] });
          assert.equal(result.ok, false, `deberia rechazarse el motivo ${JSON.stringify(reason)}`);
        }
        const ok = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "reject", reason: "el copy no me gusta" }] });
        assert.equal(ok.ok, true);
        assert.equal(ok.decisions[0].reason, "el copy no me gusta");
      },
    },
    {
      name: "Aprobar algo no accionable NO lo hace accionable: se registra pero no se ejecuta",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3, [2]));
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 2, action: "approve" }] });
        assert.equal(result.ok, true, "la instruccion es valida...");
        assert.equal(result.decisions[0].executable, false, "...pero no se ejecuta");
        assert.ok(result.decisions[0].blockedReason.length > 0);
        assert.ok(result.interpretation.some((line) => /NO SE EJECUTARA/.test(line)));
      },
    },
    {
      name: "Una modificacion que ninguna capacidad sabe hacer no se aplica a medias",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(2));
        const result = resolveHumanDecisions({
          proposals,
          // "cambia el H1" -> el H1 vive en el cuerpo, y la unica
          // capacidad de hoy es title/meta.
          instructions: [{ number: 1, action: "approve", overrides: { h1: "Otro H1" } as never }],
        });
        assert.equal(result.decisions[0].executable, false);
        assert.match(result.decisions[0].blockedReason, /implementacion manual/i);
      },
    },
    {
      name: "Las modificaciones soportadas (title/meta) se conservan tal cual",
      fn: () => {
        // Una sola propuesta promovida: asi la especificacion de
        // web-engineer se le atribuye sin ambiguedad y la propuesta es
        // realmente accionable (mismo criterio que la puerta de QA).
        const proposals = buildNumberedProposals(summaryWith(1));
        assert.equal(proposals[0].actionable, true, "precondicion del test: la propuesta tiene executor");
        const result = resolveHumanDecisions({
          proposals,
          instructions: [{ number: 1, action: "approve", overrides: { title: "Title que quiero yo" } }],
        });
        assert.equal(result.ok, true);
        assert.equal(result.decisions[0].executable, true);
        assert.equal(result.decisions[0].overrides.title, "Title que quiero yo");
        assert.ok(result.interpretation.some((line) => /Title que quiero yo/.test(line)));
      },
    },
    {
      name: "Aprobar apunta a STAGING por defecto: publicar en produccion hay que pedirlo explicitamente",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(2));
        const porDefecto = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve" }] });
        assert.equal(porDefecto.decisions[0].target, "staging");
        assert.ok(porDefecto.interpretation.some((line) => /STAGING/.test(line)));

        const explicito = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "approve", target: "production" }] });
        assert.equal(explicito.decisions[0].target, "production");
      },
    },
    {
      name: "`defer` deja la propuesta pendiente sin ejecutar nada",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3));
        const result = resolveHumanDecisions({ proposals, instructions: [{ number: 1, action: "defer" }] });
        assert.equal(result.ok, true);
        assert.equal(result.decisions[0].executable, false);
        assert.ok(result.interpretation.some((line) => /PENDIENTE/.test(line)));
      },
    },
    {
      name: "La interpretacion se puede enseñar ANTES de ejecutar, y nombra numero + id + accion",
      fn: () => {
        const proposals = buildNumberedProposals(summaryWith(3));
        const result = resolveHumanDecisions({
          proposals,
          instructions: [
            { number: 1, action: "approve" },
            { number: 2, action: "reject", reason: "el copy es generico" },
          ],
        });
        const text = result.interpretation.join("\n");
        assert.ok(text.includes("#1") && text.includes("#2"));
        assert.ok(text.includes(proposals[0].id), "el id real aparece, no solo el numero");
        assert.ok(text.includes("el copy es generico"));
      },
    },

    // --- Feedback humano persistido ---
    {
      name: "Un rechazo con motivo queda disponible LITERAL para las siguientes propuestas",
      fn: () =>
        withTempStore((filePath) => {
          const reason = 'No me gusta el H1: dice "control de acceso" y <strong>no</strong> es eso.';
          appendHumanDecision(record({ rejectionReason: reason }), filePath);
          const feedback = listHumanFeedbackFor(`${RUN_ID}#rec-1`, filePath);
          assert.equal(feedback.length, 1);
          assert.equal(feedback[0].rejectionReason, reason, "ni se resume, ni se escapa, ni se reinterpreta");
          assert.equal(feedback[0].version, 1);
        }),
    },
    {
      name: "Solo los rechazos CON motivo alimentan el feedback",
      fn: () =>
        withTempStore((filePath) => {
          appendHumanDecision(record({ action: "approve", rejectionReason: "" }), filePath);
          appendHumanDecision(record({ decisionId: "d-2", rejectionReason: "   " }), filePath);
          assert.deepEqual(listHumanFeedbackFor(`${RUN_ID}#rec-1`, filePath), []);
        }),
    },
    {
      name: "El registro es append-only y sobrevive a releerlo desde cero",
      fn: () =>
        withTempStore((filePath) => {
          appendHumanDecision(record({ decisionId: "d-1", decidedAt: "2026-08-16T09:00:00.000Z", rejectionReason: "primero" }), filePath);
          appendHumanDecision(record({ decisionId: "d-2", decidedAt: "2026-08-17T09:00:00.000Z", rejectionReason: "segundo" }), filePath);
          const feedback = listHumanFeedbackFor(`${RUN_ID}#rec-1`, filePath);
          assert.deepEqual(feedback.map((f) => f.rejectionReason), ["primero", "segundo"]);
          assert.deepEqual(feedback.map((f) => f.version), [1, 2], "la version sale del orden cronologico real");
          assert.equal(fs.readFileSync(filePath, "utf-8").trim().split("\n").length, 2);
        }),
    },

    // --- Feature flag ---
    {
      name: "El carril serverless esta DESACTIVADO por defecto y solo se activa con el valor exacto",
      fn: () => {
        assert.equal(isServerlessApprovalsEnabled({}), false);
        assert.equal(isServerlessApprovalsEnabled({ SERVERLESS_APPROVALS_ENABLED: "" }), false);
        assert.equal(isServerlessApprovalsEnabled({ SERVERLESS_APPROVALS_ENABLED: "1" }), false);
        assert.equal(isServerlessApprovalsEnabled({ SERVERLESS_APPROVALS_ENABLED: "yes" }), false);
        assert.equal(isServerlessApprovalsEnabled({ SERVERLESS_APPROVALS_ENABLED: "true" }), true);
        assert.equal(isServerlessApprovalsEnabled({ SERVERLESS_APPROVALS_ENABLED: "TRUE" }), true);
      },
    },
  ];
}
