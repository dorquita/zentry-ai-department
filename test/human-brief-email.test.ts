import * as assert from "node:assert/strict";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentApplyItem, DepartmentApplySummary } from "../src/department/apply/types";
import { DepartmentDailyBrief } from "../src/department/daily-brief";
import { containsSecretValue } from "../src/department/email-config";
import {
  buildHumanDailyBriefEmail,
  buildHumanDailyBriefSubject,
  HUMAN_EMAIL_MAX_WORDS,
  HUMAN_EMAIL_MIN_WORDS,
  resolveBriefMode,
} from "../src/department/human-brief-email";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { DepartmentStageName, DepartmentStageRecord, DepartmentStageStatus } from "../src/department/types";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const RUN_ID = "dept-2026-08-15T120000Z";
const NOW = new Date("2026-08-15T12:00:00.000Z");
const STAGING_URL = "https://staging.zentrylockers.com/taquillas-melamina/";

/**
 * Jerga que este email NO puede contener JAMAS. La lista se escribe aqui
 * a mano, literal, en vez de importarla del modulo: si el modulo cambiara
 * su propia lista, este test tiene que seguir protegiendo lo que le
 * importa al lector del correo, no lo que el modulo crea recordar.
 */
const FORBIDDEN_LITERALS = [
  "ChangePlan",
  "page_id",
  "requires_manual_staging_implementation",
  "update_post_meta",
  "execute_php",
  "recommendationId",
  "changeId",
  ".json",
  "departmentRunId",
  "USD",
];

/** Conteo de palabras REAL: solo cuentan los tokens con alguna letra o digito. */
function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function stage(name: DepartmentStageName, status: DepartmentStageStatus): DepartmentStageRecord {
  return {
    stage: name,
    phase: "specialists",
    status,
    reason: status === "executed" ? "ok" : "la etapa no produjo salida utilizable",
    outputPath: null,
    artifactPath: null,
    sourceRunId: null,
    auditWarningCount: null,
    recordedAt: NOW.toISOString(),
  };
}

/** Pasada sana: las dos etapas criticas ejecutadas. */
const HEALTHY_STAGES: DepartmentStageRecord[] = [
  stage("seo-specialist", "executed"),
  stage("growth-director-v2", "executed"),
  stage("qa-reviewer", "executed"),
  stage("sem-specialist", "not_available"),
];

function priority(rank: number, overrides: Partial<DepartmentDailyBrief["topPriorities"][number]> = {}): DepartmentDailyBrief["topPriorities"][number] {
  return {
    rank,
    action: `Prioridad numero ${rank}`,
    reason: "239 impresiones con CTR 0% en la familia melamina.",
    impact: "medium",
    confidence: "high",
    effort: "low",
    evidence: [],
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
    executiveSummary: { discovered: [], needsAttention: [], changed: [] },
    topPriorities: [priority(1), priority(2)],
    sections: { seo: section, content: section, analytics: section, growth: section, qa: section, webEngineering: section },
    blockedOrUnknown: [],
    approvalsNeeded: [
      { decision: 'APROBAR o RECHAZAR: "Reescribir el titulo de la pagina de taquillas de melamina"', why: "CTR 0%.", qaStatus: "PASS", origin: "seo-specialist" },
    ],
    stageStatuses: HEALTHY_STAGES,
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

function applySummary(count = 2, titleOf: (rank: number) => string = (rank) => `Reescribir el titulo de la pagina de taquillas numero ${rank}`): DepartmentApplySummary {
  const promotion: DepartmentPromotionResult = {
    departmentRunId: RUN_ID,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: Array.from({ length: count }, (_, i) => ({
      rank: i + 1,
      title: titleOf(i + 1),
      rationale: "r",
      impact: "medium",
      confidence: "high",
      effort: "low",
      dependsOn: [],
      evidenceRefs: [],
      decision: "promoted" as const,
      blockedBy: [],
      qaWarnings: [],
    })),
    blocked: [],
    unattributedBlockingSignals: [],
    qaSummary: null,
  };
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion,
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: [{ wordpressPageId: 2091, stagingUrl: STAGING_URL }],
    now: NOW,
  });
}

/** Marca los `count` primeros elementos como YA aplicados en staging y esperando decision. */
function withStagedItems(summary: DepartmentApplySummary, count: number): DepartmentApplySummary {
  return {
    ...summary,
    externalWritesPerformed: true,
    items: summary.items.map((item, i) =>
      i < count
        ? ({
            ...item,
            applyStatus: "awaiting_approval",
            validationStatus: "passed",
            traceability: { ...item.traceability, stagingUrl: STAGING_URL, changeId: `${RUN_ID}#chg-${i + 1}` },
          } as DepartmentApplyItem)
        : item
    ),
  };
}

/** Pasada NORMAL de referencia: un cambio ya en staging esperando decision. */
function normalInput() {
  return { brief: brief(), apply: withStagedItems(applySummary(), 1), cost: null, runUrl: "" };
}

export function runHumanBriefEmailTests(): TestCase[] {
  return [
    // --- Longitud: tiene que leerse en menos de un minuto ---
    {
      name: "El cuerpo normal tiene entre 150 y 250 palabras: un resumen, no un informe",
      fn: () => {
        const email = buildHumanDailyBriefEmail(normalInput());
        const words = countWords(email.text);
        assert.ok(
          words >= HUMAN_EMAIL_MIN_WORDS && words <= HUMAN_EMAIL_MAX_WORDS,
          `el cuerpo normal tiene ${words} palabras y el rango pedido es ${HUMAN_EMAIL_MIN_WORDS}-${HUMAN_EMAIL_MAX_WORDS}`
        );
      },
    },
    {
      name: "Un dia con veinte propuestas NO alarga el email: sigue por debajo de 250 palabras",
      fn: () => {
        const many = withStagedItems(
          applySummary(20, (rank) => `Reescribir por completo el titulo y la meta descripcion de la pagina de taquillas de melamina numero ${rank} para vestuarios`),
          4
        );
        const email = buildHumanDailyBriefEmail({ brief: brief({ topPriorities: Array.from({ length: 20 }, (_, i) => priority(i + 1)) }), apply: many, cost: null, runUrl: "" });
        const words = countWords(email.text);
        assert.ok(words <= HUMAN_EMAIL_MAX_WORDS, `veinte propuestas producen ${words} palabras`);
        assert.ok(email.text.includes("20 oportunidades importantes"), "el numero total si se dice, aunque no se listen las veinte");
      },
    },

    // --- Las tres variantes ---
    {
      name: "Las tres variantes producen asuntos DISTINTOS: un dia roto no puede llegar igual que un dia normal",
      fn: () => {
        const normal = buildHumanDailyBriefEmail(normalInput()).subject;
        const idle = buildHumanDailyBriefEmail({ brief: brief({ topPriorities: [], approvalsNeeded: [] }), apply: null, cost: null, runUrl: "" }).subject;
        const alert = buildHumanDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "", runFailureReason: "No hemos podido conectar con la web." }).subject;
        assert.equal(new Set([normal, idle, alert]).size, 3, `asuntos repetidos: ${[normal, idle, alert].join(" / ")}`);
        for (const subject of [normal, idle, alert]) assert.ok(subject.includes("2026-08-15"), `el asunto "${subject}" tiene que llevar la fecha`);
        assert.equal(buildHumanDailyBriefSubject("normal", "2026-08-15"), "Zentry AI Department -- Resumen diario -- 2026-08-15");
      },
    },
    {
      name: "El modo se decide de forma determinista: fallo critico -> alerta, nada que contar -> sin trabajo, resto -> normal",
      fn: () => {
        assert.equal(resolveBriefMode(normalInput()), "normal");

        // REGRESION REAL (pasada dept-2026-08-18T025944Z). El analisis
        // entero fue bien -- cinco empleados, dos puertas de QA -- pero
        // la lectura de la web de pruebas fallo por red. Sin inventario
        // ninguna propuesta puede resolver su pagina destino, asi que
        // nada podia aplicarse. El correo decia "Estado: Todo correcto".
        //
        // "Hoy no habia nada que aplicar" y "hoy no se podia aplicar
        // nada" se leen igual y NO son lo mismo: lo segundo es una
        // averia que puede durar dias sin que nadie la note.
        const sinStaging = { ...normalInput(), stagingInventoryUnavailableReason: "Fallo de red leyendo el inventario de staging (fetch failed) tras 3 intentos con espera." };
        assert.equal(resolveBriefMode(sinStaging), "alerta");
        const emailSinStaging = buildHumanDailyBriefEmail(sinStaging);
        assert.ok(!emailSinStaging.text.includes("Todo correcto"), "un dia sin poder tocar la web no puede decir que todo esta correcto");
        assert.ok(
          emailSinStaging.text.includes("web de pruebas"),
          `la alerta tiene que decir que no se pudo conectar con la web de pruebas: ${emailSinStaging.text}`
        );
        // Y sin filtrar jerga: ni dominios, ni "fetch", ni el numero de reintentos.
        for (const leak of ["fetch", "staging.zentrylockers", "inventario", "3 intentos"]) {
          assert.ok(!emailSinStaging.text.toLowerCase().includes(leak.toLowerCase()), `el correo humano no puede filtrar "${leak}"`);
        }

        assert.equal(resolveBriefMode({ brief: brief({ topPriorities: [], approvalsNeeded: [] }), apply: null, cost: null, runUrl: "" }), "sin_trabajo");
        assert.equal(
          resolveBriefMode({ brief: brief({ stageStatuses: [stage("seo-specialist", "executed"), stage("growth-director-v2", "failed"), stage("qa-reviewer", "executed")] }), apply: null, cost: null, runUrl: "" }),
          "alerta"
        );
        // Un motivo declarado por quien ejecuta la pasada manda siempre.
        assert.equal(resolveBriefMode({ ...normalInput(), runFailureReason: "La web no respondia." }), "alerta");
        // Y una etapa NO critica caida no convierte el dia en alerta.
        assert.equal(
          resolveBriefMode({ ...normalInput(), brief: brief({ stageStatuses: [stage("seo-specialist", "failed"), stage("growth-director-v2", "executed"), stage("qa-reviewer", "executed")] }) }),
          "normal"
        );
      },
    },
    {
      name: "La variante SIN TRABAJO dice que no hay nada que justifique intervenir y NO lista recomendaciones",
      fn: () => {
        const email = buildHumanDailyBriefEmail({ brief: brief({ topPriorities: [], approvalsNeeded: [] }), apply: null, cost: null, runUrl: "" });
        assert.ok(email.text.includes("ningun cambio que justifique intervenir"), "tiene que decirlo literalmente");
        assert.ok(email.text.includes("Seguiremos monitorizando"));
        assert.ok(email.text.includes("Estado: Todo correcto"), "un dia sin trabajo es un resultado VALIDO, no un fallo");
        assert.ok(!/Aprobar o rechazar/.test(email.text), "sin trabajo no se pide ninguna decision");
        assert.ok(/Necesito de ti\n- Nada\./.test(email.text), "sin trabajo, no se necesita nada de Pau");
        assert.ok(email.html.includes("ningun cambio que justifique intervenir"));
      },
    },
    {
      name: "La variante ALERTA no parece un brief normal y da un motivo humano, sin jerga",
      fn: () => {
        const email = buildHumanDailyBriefEmail({
          brief: brief({ stageStatuses: [stage("seo-specialist", "executed"), stage("growth-director-v2", "failed"), stage("qa-reviewer", "executed")] }),
          apply: withStagedItems(applySummary(), 1),
          cost: null,
          runUrl: "",
        });
        assert.ok(email.subject.includes("Necesita tu atencion"), "el asunto ya avisa de que algo va mal");
        assert.ok(email.text.includes("Estado: Necesita atencion"));
        assert.ok(email.text.includes("no ha podido completar la revision de hoy"));
        assert.ok(email.text.includes("Motivo:"), "tiene que decir POR QUE");
        // Nada de estructura de resumen normal: ni oportunidades, ni
        // "Hemos hecho", ni cambios aplicados.
        assert.ok(!email.text.includes("Hoy hemos detectado"));
        assert.ok(!email.text.includes("Hemos hecho"));
        assert.ok(!/oportunidades importantes/.test(email.text));
        // Y el motivo no puede ser el volcado tecnico de la etapa.
        assert.ok(!/status=/.test(email.text));
        assert.ok(!/growth-director/.test(email.text), "ningun nombre de agente en el cuerpo");
      },
    },
    {
      name: "El motivo declarado por quien ejecuta la pasada se respeta tal cual en la alerta",
      fn: () => {
        const email = buildHumanDailyBriefEmail({ brief: brief(), apply: null, cost: null, runUrl: "", runFailureReason: "No hemos podido conectar con la web durante la revision." });
        assert.ok(email.text.includes("No hemos podido conectar con la web durante la revision."));
      },
    },

    // --- Nada de jerga interna ---
    {
      name: "El email no contiene NINGUN literal tecnico interno, ni siquiera colado dentro de un titulo",
      fn: () => {
        const dirty = withStagedItems(
          applySummary(2, (rank) => `update_post_meta en page_id=209${rank} (ChangePlan ${RUN_ID}#rec-${rank}, execute_php_fallback, 0.12 USD, plan.json)`),
          1
        );
        for (const input of [normalInput(), { brief: brief(), apply: dirty, cost: null, runUrl: "https://github.com/o/r/actions/runs/42" }]) {
          const email = buildHumanDailyBriefEmail(input);
          const body = `${email.subject}\n${email.text}\n${email.html}`;
          for (const literal of FORBIDDEN_LITERALS) {
            assert.ok(!body.includes(literal), `el email humano contiene el literal tecnico "${literal}"`);
          }
          assert.ok(!body.includes("github.com"), "la URL del run de GitHub no pinta nada en este email");
          assert.ok(!body.includes(RUN_ID), "el id de la pasada no pinta nada en este email");
        }
      },
    },
    {
      name: "Un titulo que es SOLO jerga se sustituye por una frase honesta, no por un trozo de identificador",
      fn: () => {
        const dirty = withStagedItems(applySummary(1, () => "update_post_meta page_id=2091 execute_php_fallback"), 1);
        const email = buildHumanDailyBriefEmail({ brief: brief(), apply: dirty, cost: null, runUrl: "" });
        assert.ok(email.text.includes("Un cambio en una pagina de la web."), "queda la frase generica en vez de la jerga");
      },
    },

    // --- Lo que SI tiene que estar ---
    {
      name: "Un cambio aplicado en staging aparece con su URL revisable: Pau la abre en el movil",
      fn: () => {
        const email = buildHumanDailyBriefEmail(normalInput());
        assert.ok(email.text.includes(STAGING_URL), "la URL de staging tiene que poder abrirse desde el email");
        assert.ok(email.html.includes(`href="${STAGING_URL}"`), "y en HTML tiene que ser un enlace de verdad");
        assert.ok(/cambio aplicado y verificado/.test(email.text));
      },
    },
    {
      name: "Una decision pendiente aparece en 'Necesito de ti' con una frase humana y dice como se aprueba",
      fn: () => {
        const email = buildHumanDailyBriefEmail(normalInput());
        assert.ok(email.text.includes("Necesito de ti"));
        assert.ok(/Aprobar o rechazar: reescribir el titulo de la pagina/.test(email.text), `falta la decision en lenguaje humano:\n${email.text}`);
        assert.ok(/Telegram/.test(email.text), "el email tiene que decir POR DONDE se aprueba");
        assert.ok(email.html.includes("Telegram"));
        assert.ok(email.text.includes("1 requiere tu decision."));
      },
    },
    {
      name: "Sin decisiones pendientes, 'Necesito de ti' dice Nada",
      fn: () => {
        const email = buildHumanDailyBriefEmail({ brief: brief({ approvalsNeeded: [] }), apply: applySummary(), cost: null, runUrl: "" });
        assert.ok(/Necesito de ti\n- Nada\./.test(email.text), `no dice "Nada":\n${email.text}`);
        assert.ok(email.text.includes("Ninguna requiere tu decision."));
        assert.ok(!/Aprobar o rechazar/.test(email.text));
      },
    },
    {
      name: "El cuerpo mantiene las cuatro secciones pedidas, en orden y en las dos versiones",
      fn: () => {
        const email = buildHumanDailyBriefEmail(normalInput());
        const sections = ["Hoy hemos detectado", "Hemos hecho", "Resultado", "Necesito de ti"];
        let cursor = -1;
        for (const section of sections) {
          const at = email.text.indexOf(section);
          assert.ok(at > cursor, `la seccion "${section}" falta o esta desordenada`);
          cursor = at;
          assert.ok(email.html.includes(section), `falta "${section}" en el HTML`);
        }
      },
    },

    // --- Seguridad del render ---
    {
      name: "El HTML escapa el contenido: una accion con etiquetas no puede inyectar markup",
      fn: () => {
        // Dos cargas: una que el limpiador de jerga tira entera (lleva
        // "/" y "=") y otra que SI llega al render, para comprobar que lo
        // que llega se escapa de verdad en vez de confiar en el filtro.
        for (const payload of ['Reescribir <script>alert("x")</script> el titulo', "Reescribir <script> el titulo de melamina"]) {
          const dirty = withStagedItems(applySummary(1, () => payload), 1);
          const email = buildHumanDailyBriefEmail({ brief: brief(), apply: dirty, cost: null, runUrl: "" });
          assert.ok(!email.html.includes("<script>"), "el HTML no puede contener el script sin escapar");
        }
        const reaching = withStagedItems(applySummary(1, () => "Reescribir <script> el titulo de melamina"), 1);
        const email = buildHumanDailyBriefEmail({ brief: brief(), apply: reaching, cost: null, runUrl: "" });
        assert.ok(email.html.includes("&lt;script&gt;"), "el markup que llega al render tiene que salir escapado");
      },
    },
    {
      name: "El email humano no contiene el valor de ninguna variable sensible",
      fn: () => {
        const env = { SMTP_PASS: "clave-super-secreta-1234", SMTP_USER: "usuario@zentry.example" };
        const email = buildHumanDailyBriefEmail(normalInput());
        assert.equal(containsSecretValue(`${email.subject}\n${email.text}\n${email.html}`, env, ["SMTP_PASS", "SMTP_USER"]), null);
        // Y el detector funciona de verdad cuando SI hay una fuga.
        assert.equal(containsSecretValue("texto con clave-super-secreta-1234 dentro", env, ["SMTP_PASS"]), "SMTP_PASS");
      },
    },
  ];
}
