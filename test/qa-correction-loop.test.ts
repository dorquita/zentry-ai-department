import * as assert from "assert";
import { QaReviewerOutput } from "../src/employees/qa-reviewer/output";
import { buildApplyPlan, resolvePlannedStatus } from "../src/department/apply/plan";
import { DepartmentPromotionResult } from "../src/department/promotion";
import {
  appendQaLoopRound,
  decideQaLoop,
  emptyQaLoopRecord,
  MAX_AUTOMATIC_CORRECTION_ROUNDS,
  normalizeQaCorrections,
  renderQaLoopSummary,
  reviewIsBlocking,
} from "../src/department/qa-correction";

/**
 * LO QUE ESTOS TESTS FIJAN.
 *
 * Antes, un FAIL de QA terminaba la pasada: nadie corregia nada y la
 * unica salida era una persona leyendo el Daily Brief. El bucle nuevo
 * tiene que cumplir cuatro cosas a la vez, y las cuatro son faciles de
 * romper en direcciones opuestas:
 *
 *   - un FAIL con correcciones accionables produce una correccion,
 *   - una correccion se vuelve a revisar SOBRE EL OUTPUT NUEVO,
 *   - el bucle TERMINA (nunca infinito),
 *   - y un FAIL que no se resuelve NO se maquilla de PASS.
 */

function reviewFor(overrides: Partial<QaReviewerOutput> = {}): QaReviewerOutput {
  return {
    reviewStatus: "pass",
    reviewedArtifact: {
      sourceEmployee: "web-engineer",
      artifactType: "technical-specification",
      artifactId: "dept-2026-08-17T090000Z-web-engineer",
      artifactPath: "reports/department/dept-2026-08-17T090000Z/stages/web-engineer/output.json",
    },
    findings: [],
    unsupportedClaims: [],
    contradictions: [],
    safetyConcerns: [],
    requiredCorrections: [],
    approvalRecommendation: { recommendedStatus: "approved", riskLevel: "low_medium", rationale: "Sin hallazgos bloqueantes." },
    evidence: [],
    summary: "Sin problemas.",
    ...overrides,
  };
}

/**
 * Adjunta `correctionRequests` cruda a una revision. Se pasa por
 * `unknown` a proposito: varios casos prueban formas INCOMPLETAS (lo que
 * dejaria un artifact antiguo o una salida a medias), y el objetivo es
 * justamente comprobar que la normalizacion no las pierde. El validador
 * de schema es otra capa, y esa si es estricta.
 */
function withRawCorrections(review: QaReviewerOutput, raw: unknown[]): QaReviewerOutput {
  return { ...(review as unknown as Record<string, unknown>), correctionRequests: raw } as unknown as QaReviewerOutput;
}

const FAIL_CON_CORRECCION = reviewFor({
  reviewStatus: "fail",
  requiredCorrections: ["El title propuesto no contiene la keyword objetivo declarada en la recomendacion."],
  summary: "El cambio no responde a la recomendacion.",
});

export function runQaCorrectionLoopTests(): { name: string; fn: () => void }[] {
  return [
    {
      name: "CASO B del circuito: FAIL con correcciones -> se pide correccion, y la ronda siguiente PASS cierra el bucle",
      fn: () => {
        const primera = decideQaLoop({ review: FAIL_CON_CORRECCION, round: 0 });
        assert.equal(primera.action, "request_correction");
        assert.equal(primera.nextRound, 1);
        assert.equal(primera.corrections.length, 1);
        assert.ok(primera.corrections[0].problem.includes("keyword objetivo"));

        // La re-QA se hace sobre el OUTPUT NUEVO: aqui se simula que la
        // correccion resolvio el problema.
        const segunda = decideQaLoop({ review: reviewFor({ reviewStatus: "pass" }), round: 1 });
        assert.equal(segunda.action, "accept");
        assert.equal(segunda.nextRound, null);
        // El motivo tiene que dejar claro que se acepto la CORRECCION, no
        // la propuesta original: si no, un PASS de la ronda 1 seria
        // indistinguible de no haber corregido nada.
        assert.ok(segunda.reason.includes("ronda 1"), `el motivo debe decir que ronda se acepto: ${segunda.reason}`);
        assert.ok(segunda.reason.toLowerCase().includes("nuevo"), `el motivo debe decir que se juzgo el output nuevo: ${segunda.reason}`);
      },
    },
    {
      name: "LIMITE DURO: agotadas las 2 rondas automaticas el resultado es NEEDS_HUMAN_REVIEW, nunca una tercera correccion",
      fn: () => {
        assert.equal(MAX_AUTOMATIC_CORRECTION_ROUNDS, 2);
        // Rondas 0 y 1 pueden pedir correccion...
        assert.equal(decideQaLoop({ review: FAIL_CON_CORRECCION, round: 0 }).action, "request_correction");
        assert.equal(decideQaLoop({ review: FAIL_CON_CORRECCION, round: 1 }).action, "request_correction");
        // ...la 2 ya no: autorizarla seria la TERCERA correccion.
        const agotado = decideQaLoop({ review: FAIL_CON_CORRECCION, round: 2 });
        assert.equal(agotado.action, "needs_human_review");
        assert.equal(agotado.nextRound, null);
        assert.ok(agotado.reason.includes("2 ronda"), `el motivo debe decir cuantas rondas se agotaron: ${agotado.reason}`);
        // Las correcciones pendientes se conservan: el humano necesita
        // saber QUE seguia mal, no solo que no se pudo.
        assert.ok(agotado.corrections.length > 0, "un NEEDS_HUMAN_REVIEW sin correcciones no le dice nada a quien lo lee");
      },
    },
    {
      name: "Un FAIL NUNCA se maquilla: agotar las rondas no degrada el veredicto a PASS ni a PASS_WITH_WARNINGS",
      fn: () => {
        for (const round of [0, 1, 2, 3, 9]) {
          const decision = decideQaLoop({ review: FAIL_CON_CORRECCION, round });
          assert.notEqual(decision.action, "accept", `ronda ${round}: un FAIL no puede aceptarse sin una revision nueva que lo diga`);
        }
      },
    },
    {
      name: "Un finding critical o un safetyConcern bloquean aunque reviewStatus diga pass -- mismo criterio que la puerta de promocion",
      fn: () => {
        assert.equal(reviewIsBlocking(reviewFor()), false);
        assert.equal(
          reviewIsBlocking(reviewFor({ findings: [{ category: "unsafe_actions", severity: "critical", description: "Escribe sin aprobacion." }] })),
          true
        );
        assert.equal(reviewIsBlocking(reviewFor({ safetyConcerns: ["Toca produccion sin confirmar."] })), true);
        // Un warning NO bloquea: si lo hiciera, cualquier observacion
        // menor pararia la pasada entera.
        assert.equal(
          reviewIsBlocking(reviewFor({ findings: [{ category: "actionability", severity: "warning", description: "Podria concretarse mas." }] })),
          false
        );
      },
    },
    {
      name: "REGRESION REAL: fail con findings critical y requiredCorrections VACIO SI dispara correccion",
      fn: () => {
        // Esto paso de verdad en la pasada dept-2026-08-17T234302Z: QA
        // bloqueo con dos findings `critical` y `requiredCorrections`
        // vacio (el schema exige el array, no su contenido). Con la regla
        // anterior -- "sin correcciones declaradas no se corrige" -- la
        // pasada se iba a NEEDS_HUMAN_REVIEW teniendo la informacion
        // accionable delante, en la descripcion del propio finding.
        const review = reviewFor({
          reviewStatus: "fail",
          requiredCorrections: [],
          findings: [
            {
              category: "fabrication_risk",
              severity: "critical",
              description: "growth.output.dependencies afirma 70 candidatas SEM pese a que semStatus es not_available.",
            },
            { category: "actionability", severity: "warning", description: "Podria concretarse mas." },
          ],
          summary: "Hay una cifra de SEM sin respaldo.",
        });

        const corrections = normalizeQaCorrections(review);
        assert.equal(corrections.length, 1, "solo el finding CRITICAL genera correccion; un warning no bloquea");
        assert.equal(corrections[0].derivedFrom, "finding");
        assert.ok(corrections[0].problem.includes("70 candidatas SEM"), "el problema es el texto LITERAL de QA, no una parafrasis");
        // El criterio de aceptacion NO se inventa: QA no lo dio.
        assert.equal(corrections[0].expectedCriterion, "");

        const decision = decideQaLoop({ review, round: 0 });
        assert.equal(decision.action, "request_correction", "el bucle TIENE que dispararse: la informacion accionable estaba ahi");
        assert.equal(decision.nextRound, 1);
      },
    },
    {
      name: "Un safetyConcern sin correcciones declaradas tambien dispara correccion",
      fn: () => {
        const review = reviewFor({
          reviewStatus: "fail",
          requiredCorrections: [],
          safetyConcerns: ["La propuesta promete un plazo de entrega que nadie ha confirmado."],
        });
        const corrections = normalizeQaCorrections(review);
        assert.equal(corrections.length, 1);
        assert.equal(corrections[0].derivedFrom, "safety_concern");
        assert.equal(decideQaLoop({ review, round: 0 }).action, "request_correction");
      },
    },
    {
      name: "Lo declarado GANA a lo derivado: si QA declara correcciones, no se duplican con los findings",
      fn: () => {
        const review = reviewFor({
          reviewStatus: "fail",
          requiredCorrections: ["Quita la cifra de SEM."],
          findings: [{ category: "fabrication_risk", severity: "critical", description: "Cifra de SEM sin respaldo." }],
        });
        const corrections = normalizeQaCorrections(review);
        assert.equal(corrections.length, 1, "la derivacion es un ULTIMO recurso, no un anadido");
        assert.equal(corrections[0].derivedFrom, "required_correction");
      },
    },
    {
      name: "Un fail SIN ninguna senal bloqueante detras si va a revision humana: es una revision incoherente consigo misma",
      fn: () => {
        const decision = decideQaLoop({
          review: reviewFor({ reviewStatus: "fail", requiredCorrections: [], findings: [], safetyConcerns: [], summary: "No me convence." }),
          round: 0,
        });
        assert.equal(decision.action, "needs_human_review");
        assert.ok(decision.reason.toLowerCase().includes("ciegas") || decision.reason.toLowerCase().includes("accionable"));
      },
    },
    {
      name: "Las correcciones estructuradas traen campo, criterio esperado y evidencia -- una correccion dirigida, no una frase suelta",
      fn: () => {
        const review = withRawCorrections(reviewFor({ reviewStatus: "fail", requiredCorrections: ["El title no lleva la keyword."] }), [
          {
            field: "changePlans[0].newValue",
            problem: "El title propuesto no contiene la keyword objetivo.",
            expectedCriterion: "El title debe contener la keyword exacta declarada en la recomendacion.",
            evidence: ["dept-seo-1: la keyword objetivo es taquillas metalicas"],
            targetRecommendationId: "dept-2026-08-17T090000Z#rec-1",
            blocking: true,
          },
        ]);

        const corrections = normalizeQaCorrections(review);
        const estructurada = corrections.find((c) => !c.fromPlainText);
        assert.ok(estructurada, "la correccion estructurada debe conservarse");
        assert.equal(estructurada!.field, "changePlans[0].newValue");
        assert.equal(estructurada!.expectedCriterion.length > 0, true);
        assert.equal(estructurada!.evidence.length, 1);
        assert.equal(estructurada!.targetRecommendationId, "dept-2026-08-17T090000Z#rec-1");
      },
    },
    {
      name: "Sin forma estructurada, el texto plano NO se pierde: se conserva literal y se marca como tal",
      fn: () => {
        const corrections = normalizeQaCorrections(FAIL_CON_CORRECCION);
        assert.equal(corrections.length, 1);
        assert.equal(corrections[0].fromPlainText, true);
        assert.equal(corrections[0].problem, "El title propuesto no contiene la keyword objetivo declarada en la recomendacion.");
        // Los campos que QA no dio quedan VACIOS, no inventados.
        assert.equal(corrections[0].field, "");
        assert.equal(corrections[0].expectedCriterion, "");
        assert.deepStrictEqual(corrections[0].evidence, []);
      },
    },
    {
      name: "Una correccion que no declara si bloquea, BLOQUEA (fail-closed)",
      fn: () => {
        const base = reviewFor({ reviewStatus: "fail", requiredCorrections: [] });
        const [correction] = normalizeQaCorrections(withRawCorrections(base, [{ problem: "Falta el criterio de aceptacion." }]));
        assert.equal(correction.blocking, true);
        assert.equal(normalizeQaCorrections(withRawCorrections(base, [{ problem: "Podria mejorarse el copy.", blocking: false }]))[0].blocking, false);
      },
    },
    {
      name: "El texto plano no se duplica cuando ya viene representado en la forma estructurada",
      fn: () => {
        const review = withRawCorrections(reviewFor({ reviewStatus: "fail", requiredCorrections: ["El title no lleva la keyword."] }), [
          { problem: "El title no lleva la keyword.", blocking: true },
        ]);
        assert.equal(normalizeQaCorrections(review).length, 1);
      },
    },
    {
      name: "TRAZABILIDAD: cada ronda registra revision y qaAttempt, y el historial permite demostrar que el PASS es del output corregido",
      fn: () => {
        let record = emptyQaLoopRecord("dept-2026-08-17T090000Z", "web-engineer");
        assert.equal(record.finalStatus, "in_progress");

        record = appendQaLoopRound(record, {
          revision: 0,
          qaAttempt: 1,
          employee: "web-engineer",
          reviewStatus: "fail",
          blocking: true,
          action: "request_correction",
          corrections: normalizeQaCorrections(FAIL_CON_CORRECCION),
          reason: "QA bloquea con 1 correccion.",
          reviewedOutputPath: "reports/department/x/stages/web-engineer/output.json",
          reviewOutputPath: "reports/department/x/stages/qa-reviewer/output.json",
          at: "2026-08-17T09:10:00.000Z",
        });
        assert.equal(record.finalStatus, "in_progress");

        record = appendQaLoopRound(record, {
          revision: 1,
          qaAttempt: 2,
          employee: "web-engineer",
          reviewStatus: "pass",
          blocking: false,
          action: "accept",
          corrections: [],
          reason: "QA acepto la correccion de la ronda 1.",
          reviewedOutputPath: "reports/department/x/stages/web-engineer/rounds/1/output.json",
          reviewOutputPath: "reports/department/x/stages/qa-reviewer/rounds/1/output.json",
          at: "2026-08-17T09:20:00.000Z",
        });

        assert.equal(record.finalStatus, "PASS");
        assert.equal(record.rounds.length, 2);
        // La prueba de que la re-QA fue real: los DOS caminos revisados
        // son distintos. Si fueran iguales, se habria revisado dos veces
        // el mismo artifact.
        assert.notEqual(record.rounds[0].reviewedOutputPath, record.rounds[1].reviewedOutputPath);
        assert.notEqual(record.rounds[0].reviewOutputPath, record.rounds[1].reviewOutputPath);
        assert.deepStrictEqual(
          record.rounds.map((r) => `${r.revision}/${r.qaAttempt}`),
          ["0/1", "1/2"]
        );

        const summary = renderQaLoopSummary(record);
        assert.ok(summary[0].includes("PASS"));
        assert.ok(summary.some((line) => line.includes("revision=0") && line.includes("qaAttempt=1")));
        assert.ok(summary.some((line) => line.includes("revision=1") && line.includes("qaAttempt=2")));
      },
    },
    {
      name: "El bucle acaba en NEEDS_HUMAN_REVIEW cuando no converge, y eso queda en el registro, no en un PASS",
      fn: () => {
        let record = emptyQaLoopRecord("dept-x", "web-engineer");
        for (const revision of [0, 1]) {
          record = appendQaLoopRound(record, {
            revision,
            qaAttempt: revision + 1,
            employee: "web-engineer",
            reviewStatus: "fail",
            blocking: true,
            action: "request_correction",
            corrections: [],
            reason: "sigue mal",
            reviewedOutputPath: `p${revision}`,
            reviewOutputPath: `q${revision}`,
            at: "2026-08-17T09:00:00.000Z",
          });
        }
        const final = decideQaLoop({ review: FAIL_CON_CORRECCION, round: 2 });
        record = appendQaLoopRound(record, {
          revision: 2,
          qaAttempt: 3,
          employee: "web-engineer",
          reviewStatus: "fail",
          blocking: true,
          action: final.action,
          corrections: final.corrections,
          reason: final.reason,
          reviewedOutputPath: "p2",
          reviewOutputPath: "q2",
          at: "2026-08-17T09:30:00.000Z",
        });
        assert.equal(record.finalStatus, "NEEDS_HUMAN_REVIEW");
        assert.equal(record.rounds.length, 3);
      },
    },
    {
      name: "El limite se puede endurecer, nunca queda abierto: con maxRounds=0 no hay ninguna correccion automatica",
      fn: () => {
        const decision = decideQaLoop({ review: FAIL_CON_CORRECCION, round: 0, maxRounds: 0 });
        assert.equal(decision.action, "needs_human_review");
      },
    },
    {
      name: "LA PUERTA: NEEDS_HUMAN_REVIEW bloquea el apply aunque el ChangePlan sea tecnicamente ejecutable",
      fn: () => {
        // Sin esta puerta habria un agujero real: `change-plans.json` es
        // la ruta canonica y siempre lleva la ULTIMA version producida,
        // incluida una que QA acaba de rechazar. El executor la aplicaria.
        assert.equal(
          resolvePlannedStatus({ isBlockedByQa: false, capabilitySupported: false, hasExecutablePlan: true }),
          "proposed"
        );
        assert.equal(
          resolvePlannedStatus({ isBlockedByQa: false, capabilitySupported: false, hasExecutablePlan: true, planQaNeedsHumanReview: true }),
          "blocked"
        );
        // Tampoco pasa el camino legacy.
        assert.equal(
          resolvePlannedStatus({ isBlockedByQa: false, capabilitySupported: true, planQaNeedsHumanReview: true }),
          "blocked"
        );
      },
    },
    {
      name: "La puerta se aplica a TODOS los elementos de la pasada, y el motivo queda escrito en el rastro de auditoria",
      fn: () => {
        const promotion: DepartmentPromotionResult = {
          departmentQaStatus: "PASS",
          promoted: [
            { rank: 1, title: "Mejorar el title de taquillas", rationale: "La keyword no aparece.", impact: "medium", confidence: "high", effort: "low", evidenceRefs: [], decision: "promoted", blockedBy: [] },
            { rank: 2, title: "Revisar la meta de vestuarios", rationale: "Meta duplicada.", impact: "low", confidence: "medium", effort: "low", evidenceRefs: [], decision: "promoted", blockedBy: [] },
          ],
          blocked: [],
          globalBlockReason: null,
          unattributedBlockingSignals: [],
        } as unknown as DepartmentPromotionResult;

        const bloqueado = buildApplyPlan({
          departmentRunId: "dept-x",
          promotion,
          webEngineer: { status: "not_available" },
          ownedStagingPages: [],
          planQaStatus: "NEEDS_HUMAN_REVIEW",
          now: new Date("2026-08-17T09:00:00.000Z"),
        });
        assert.equal(bloqueado.items.length, 2);
        for (const item of bloqueado.items) {
          assert.equal(item.applyStatus, "blocked", `#${item.recommendationRank} deberia estar bloqueado`);
          assert.ok(
            item.auditTrail.some((entry) => entry.detail.includes("QA del plan")),
            "el motivo del bloqueo tiene que quedar escrito, no solo el estado"
          );
        }

        // Sin el veredicto, el comportamiento de siempre NO cambia: una
        // pasada que no use el bucle no puede empezar a bloquearse sola.
        const normal = buildApplyPlan({
          departmentRunId: "dept-x",
          promotion,
          webEngineer: { status: "not_available" },
          ownedStagingPages: [],
          now: new Date("2026-08-17T09:00:00.000Z"),
        });
        for (const item of normal.items) {
          assert.notEqual(item.applyStatus, "blocked");
        }
      },
    },
  ];
}
