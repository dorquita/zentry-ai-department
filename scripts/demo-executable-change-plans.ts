import * as fs from "fs";
import * as path from "path";
import { buildChangePlanFromDraft, ResolvedChangePlan, WebEngineerChangePlanDraft } from "../src/department/web-engineer-changeplan";
import { CHANGE_PLAN_STATUS_LABEL, evaluateChangePlanFreshness } from "../src/department/executable-change-plan";
import { StagingInventory, StagingPageSnapshot } from "../src/department/staging-inventory";

/**
 * DEMOSTRACION, SOLO LECTURA: recomendacion aprobada -> ExecutableChangePlan.
 *
 * Coge propuestas REALES de la pasada `dept-2026-08-16T185140Z` y las
 * resuelve contra el inventario REAL de staging que leyo esa misma
 * pasada (copiado tal cual en
 * `test/fixtures/staging-inventory-dept-2026-08-16T185140Z.json`), para
 * poder INSPECCIONAR los planes antes de conectar el executor.
 *
 * ESTE SCRIPT NO ESCRIBE EN NINGUN SITIO. No importa ningun executor, no
 * abre ninguna conexion de red, no toca WordPress (ni staging ni
 * produccion) y no lee ninguna credencial. Lo unico que puede escribir
 * es un fichero JSON local, y solo si se le pasa `--json <ruta>`.
 *
 * Uso:
 *   npm run change-plans:demo
 *   npm run change-plans:demo -- --json reports/executable-change-plans/demo.json
 */

const RUN_ID = "dept-2026-08-16T185140Z";
const PRODUCTION_HOST = "https://zentrylockers.com";
const STAGING_HOST = "https://staging.zentrylockers.com";

interface DemoCase {
  label: string;
  /** De donde sale la propuesta, con su cita literal. */
  source: string;
  draft: WebEngineerChangePlanDraft;
}

/**
 * Cada caso cita una recomendacion REAL de la pasada. El `newValue` es
 * el AFTER que le corresponde aportar a web-engineer (Claude): es lo
 * unico de este fichero que no sale de una lectura -- y es exactamente
 * el reparto que se quiere demostrar.
 */
const CASES: DemoCase[] = [
  {
    label: "CASO A -- quick win SEO sobre pagina existente",
    source:
      'seo-specialist, opportunity o6 ("taquillas para hospital", posicion 17.0, CTR 0.00% con 20 impresiones) -> growth-director-v2 rank 2 "Ejecutar los 6 quick wins on-page ya identificados".',
    draft: {
      recommendationId: `${RUN_ID}#rec-2`,
      // La recomendacion cita la URL de PRODUCCION: el resolvedor la
      // lleva a la pagina equivalente de staging por ruta exacta.
      targetPage: `${PRODUCTION_HOST}/taquillas-para-hospitales/`,
      operation: "update_post_title",
      newValue: "Taquillas para hospitales y centros sanitarios | Zentry Lockers",
      rationale:
        "Quick win de la recomendacion rank 2: la keyword esta en posicion 17.0 con 0% de CTR pese a 20 impresiones. El title actual no nombra el uso sanitario ni la marca.",
    },
  },
  {
    label: "CASO B -- meta description sobre pagina existente",
    source:
      'seo-specialist, opportunity o3 ("taquillas colegios", posicion 25.1, CTR 0.00% con 40 impresiones) -> growth-director-v2 rank 4 "Auditar y reescribir meta titles/descriptions en paginas con CTR sistemico de 0%".',
    draft: {
      recommendationId: `${RUN_ID}#rec-4`,
      targetPage: `${PRODUCTION_HOST}/taquillas-para-colegios/`,
      operation: "update_post_excerpt",
      newValue:
        "Taquillas para colegios resistentes al uso diario, con cierre seguro y medidas adaptadas a aulas y vestuarios escolares. Pide presupuesto sin compromiso.",
      rationale:
        "Quick win de la recomendacion rank 4: 40 impresiones y 0 clics apuntan a un snippet que no invita a entrar. El excerpt actual esta vacio.",
    },
  },
  {
    label: "CASO C -- URL inexistente (fail-closed)",
    source:
      'seo-specialist, finding f1: dos actionItems siguen recomendando on-page sobre /cerraduras/, una pagina que el catalogo de clusters marca en papelera desde O22 con 301 a /cerraduras-para-taquillas/.',
    draft: {
      recommendationId: `${RUN_ID}#rec-1`,
      targetPage: `${PRODUCTION_HOST}/cerraduras/`,
      operation: "update_post_title",
      newValue: "Cerraduras inteligentes para taquillas | Zentry Lockers",
      rationale: "Recomendacion rank 1: corregir el enrutado de acciones SEO mal dirigidas.",
    },
  },
  {
    label: "CASO D -- SEO meta de Yoast sin BEFORE legible (fail-closed)",
    source: "Misma recomendacion rank 4, pero sobre el meta title de Yoast en vez del title del post.",
    draft: {
      recommendationId: `${RUN_ID}#rec-4`,
      targetPage: `${STAGING_HOST}/taquillas-para-colegios/`,
      operation: "update_post_meta",
      metaKey: "_yoast_wpseo_title",
      newValue: "Taquillas para colegios | Zentry Lockers",
      rationale: "Recomendacion rank 4 aplicada al meta title de Yoast.",
    },
  },
  {
    label: "CASO E -- AFTER sin concretar (fail-closed)",
    source: "La misma recomendacion rank 4, redactada como se redactaba antes: una intencion, no un valor.",
    draft: {
      recommendationId: `${RUN_ID}#rec-4`,
      targetPage: `${PRODUCTION_HOST}/taquillas-melamina/`,
      operation: "update_post_title",
      newValue: "Optimizar el meta title para la keyword objetivo",
      rationale: "Recomendacion rank 4, sin el texto final decidido.",
    },
  },
  {
    label: "CASO F -- varias paginas en una sola referencia (fail-closed)",
    source: "Recomendacion rank 4, que menciona 6 paginas como contexto. affectedPages no es executionTarget.",
    draft: {
      recommendationId: `${RUN_ID}#rec-4`,
      targetPage: `${PRODUCTION_HOST}/taquillas-para-colegios/, ${PRODUCTION_HOST}/taquillas-para-hospitales/, ${PRODUCTION_HOST}/taquillas-melamina/`,
      operation: "update_post_title",
      newValue: "Taquillas | Zentry Lockers",
      rationale: "Recomendacion rank 4 sobre todas las paginas con CTR 0% a la vez.",
    },
  },
];

function loadRealInventory(): StagingInventory {
  const fixturePath = path.join(__dirname, "..", "test", "fixtures", `staging-inventory-${RUN_ID}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as StagingInventory;
}

function truncate(value: string, max: number): string {
  const oneLine = String(value ?? "").replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return "(vacio)";
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function reportRow(demo: DemoCase, resolved: ResolvedChangePlan): string {
  const plan = resolved.executablePlan;
  return [
    demo.label,
    plan ? String(plan.target.pageId) : "—",
    resolved.operation,
    truncate(resolved.beforeValue, 40),
    truncate(resolved.afterValue, 40),
    resolved.executionStatus,
  ].join(" | ");
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf("--json");
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : "";

  const inventory = loadRealInventory();
  console.log(`\nInventario REAL de staging: ${inventory.pages.length} paginas, leido en ${inventory.capturedAt} (pasada ${RUN_ID}).`);
  console.log("Fase de PLANIFICACION: no se escribe nada en WordPress. Escrituras en staging: 0. Escrituras en produccion: 0.\n");

  const results = CASES.map((demo) => ({ demo, resolved: buildChangePlanFromDraft({ draft: demo.draft, inventory }) }));

  for (const { demo, resolved } of results) {
    const plan = resolved.executablePlan;
    console.log(`── ${demo.label}`);
    console.log(`   origen:  ${demo.source}`);
    console.log(`   destino: ${demo.draft.targetPage}`);
    console.log(`   estado:  ${resolved.executionStatus} — ${CHANGE_PLAN_STATUS_LABEL[resolved.executionStatus]}`);
    console.log(`   motivo:  ${resolved.reason}`);
    if (plan) {
      console.log(`   plan:    ${plan.changePlanId}`);
      console.log(`   target:  page_id=${plan.target.pageId} postType=${plan.target.postType} url=${plan.target.url}`);
      console.log(`   BEFORE:  ${truncate(Object.values(plan.before)[0] ?? "", 90)}`);
      console.log(`   AFTER:   ${truncate(Object.values(plan.after)[0] ?? "", 90)}`);
      console.log(`   precond: ${plan.preconditions.map((p) => p.kind).join(", ")}`);
      console.log(`   valida:  ${plan.validation.map((v) => v.kind).join(", ")}`);
      console.log(`   rollback:${JSON.stringify(plan.rollback.values).slice(0, 90)} (estrategia ${plan.rollback.strategy})`);

      // Frescura contra el estado que se leyo: si alguien edita la
      // pagina despues, esto pasa a STALE y el plan deja de ejecutarse.
      const current = inventory.pages.find((p: StagingPageSnapshot) => p.wordpressPageId === plan.target.pageId) ?? null;
      const freshness = evaluateChangePlanFreshness(plan, current);
      console.log(`   frescura:${freshness.status} — ${freshness.reason}`);
    }
    console.log("");
  }

  console.log("RESUMEN");
  console.log("caso | page_id | operacion | BEFORE | AFTER | estado");
  for (const { demo, resolved } of results) console.log(reportRow(demo, resolved));

  const ready = results.filter((r) => r.resolved.executionStatus === "READY_TO_EXECUTE");
  console.log(`\n${ready.length} plan(es) READY_TO_EXECUTE, ${results.length - ready.length} fail-closed con su causa exacta.`);
  console.log("NADA de esto se ha ejecutado: esta fase termina justo antes del executor.\n");

  if (jsonPath) {
    const outPath = path.resolve(jsonPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      `${JSON.stringify(
        {
          departmentRunId: RUN_ID,
          inventoryCapturedAt: inventory.capturedAt,
          externalWritesPerformed: false,
          note: "Artefacto de solo inspeccion. Ningun plan de este fichero se ha ejecutado en WordPress.",
          plans: results.map(({ demo, resolved }) => ({ label: demo.label, source: demo.source, resolved })),
        },
        null,
        2
      )}\n`,
      "utf-8"
    );
    console.log(`Planes guardados para inspeccion en ${outPath}\n`);
  }
}

main();
