import * as assert from "node:assert/strict";
import { resolveApplyCapability } from "../src/department/apply/capability";
import { ApplyEnvironmentGuards, checkApplyEnvironmentGuards, executeApplyItem, StagingPageState, UpdateStagingDraftInput } from "../src/department/apply/executor";
import { DEPARTMENT_APPLY_CONTRACT_VERSION, DepartmentApplyItem } from "../src/department/apply/types";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const OWNED_PAGES = [{ wordpressPageId: 2091, stagingUrl: "https://staging.zentrylockers.com/?page_id=2091" }];

const GUARDS_OK: ApplyEnvironmentGuards = {
  departmentApplyEnabled: true,
  wordpressDraftsEnabled: true,
  wordpressBackend: "rest",
  wordpressEnv: "staging",
};

function approvedItem(overrides: Partial<DepartmentApplyItem> = {}): DepartmentApplyItem {
  return {
    contractVersion: DEPARTMENT_APPLY_CONTRACT_VERSION,
    applyItemId: "dept-2026-08-15T120000Z#apply-1",
    recommendationId: "dept-2026-08-15T120000Z#rec-1",
    recommendationRank: 1,
    departmentRunId: "dept-2026-08-15T120000Z",
    sourceAgents: ["seo-specialist"],
    title: "Reescribir metas de la familia melamina",
    target: "https://staging.zentrylockers.com/?page_id=2091",
    proposedChange: "CTR 0% con 239 impresiones",
    evidenceRefs: ["dept-seo-1"],
    qaStatus: "PASS",
    webEngineerSpecification: null,
    humanApproval: { status: "approved", approvalRequestId: "req-1", answeredBy: "telegram", answeredAt: "2026-08-15T11:00:00.000Z", reason: "aprobado" },
    applyCapability: {
      id: "staging_draft_meta_update",
      supported: true,
      reason: "cambio reversible",
      target: {
        capabilityId: "staging_draft_meta_update",
        wordpressPageId: 2091,
        stagingUrl: "https://staging.zentrylockers.com/?page_id=2091",
        newTitle: "Taquillas de melamina para vestuarios | Zentry",
        newMetaDescription: "Taquillas de melamina resistentes para vestuarios y colegios.",
      },
    },
    applyStatus: "approved",
    validationStatus: "not_run",
    rollbackStatus: "not_needed",
    snapshot: null,
    auditTrail: [],
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

interface FakeWordpress {
  page: StagingPageState;
  writes: UpdateStagingDraftInput[];
  reads: number[];
  /** Si esta puesto, `updateDraft` lanza en la llamada n-esima (1-based). */
  failWriteOn?: number;
  /** Si es true, la escritura "tiene exito" pero no cambia nada (la validacion debe cazarlo). */
  silentlyIgnoreWrites?: boolean;
}

function fakeWordpress(overrides: Partial<FakeWordpress> = {}) {
  const state: FakeWordpress = {
    page: { id: 2091, status: "draft", title: "Titulo antiguo", contentHtml: "<p>cuerpo</p>", excerpt: "Meta antigua" },
    writes: [],
    reads: [],
    ...overrides,
  };
  const deps = {
    getPage: async (pageId: number): Promise<StagingPageState> => {
      state.reads.push(pageId);
      return { ...state.page };
    },
    updateDraft: async (input: UpdateStagingDraftInput): Promise<void> => {
      state.writes.push(input);
      if (state.failWriteOn && state.writes.length === state.failWriteOn) throw new Error("WordPress respondio 500");
      if (state.silentlyIgnoreWrites) return;
      state.page = { ...state.page, title: input.title, contentHtml: input.contentHtml, excerpt: input.excerpt };
    },
  };
  return { state, deps };
}

export function runDepartmentApplyExecutorTests(): TestCase[] {
  return [
    // --- Registro de capacidades ---
    {
      name: "Capacidad SOPORTADA: pagina propia citada sin ambiguedad + TITLE/META en formato maquina",
      fn: () => {
        const capability = resolveApplyCapability({
          hasSpecification: true,
          ownedStagingPages: OWNED_PAGES,
          specificationTexts: ["Actualizar page_id=2091", "TITLE: Nuevo titulo\nMETA: Nueva meta"],
        });
        assert.equal(capability.supported, true);
        assert.equal(capability.id, "staging_draft_meta_update");
        assert.equal(capability.target?.wordpressPageId, 2091);
        assert.equal(capability.target?.newTitle, "Nuevo titulo");
        assert.equal(capability.target?.newMetaDescription, "Nueva meta");
      },
    },
    {
      name: "Capacidad NO soportada -> requires_manual_implementation: sin pagina, pagina ajena, varias paginas, o sin TITLE/META",
      fn: () => {
        const sinPagina = resolveApplyCapability({ hasSpecification: true, ownedStagingPages: OWNED_PAGES, specificationTexts: ["TITLE: X", "META: Y"] });
        assert.equal(sinPagina.supported, false);

        const paginaAjena = resolveApplyCapability({
          hasSpecification: true,
          ownedStagingPages: OWNED_PAGES,
          specificationTexts: ["Actualizar page_id=9999", "TITLE: X"],
        });
        assert.equal(paginaAjena.supported, false, "una pagina que este sistema no controla nunca es un destino valido");

        const variasPaginas = resolveApplyCapability({
          hasSpecification: true,
          ownedStagingPages: [...OWNED_PAGES, { wordpressPageId: 2092, stagingUrl: "https://staging.zentrylockers.com/?page_id=2092" }],
          specificationTexts: ["page_id=2091 y page_id=2092", "TITLE: X"],
        });
        assert.equal(variasPaginas.supported, false, "un elemento de apply solo puede tener UN destino");

        const sinContenido = resolveApplyCapability({
          hasSpecification: true,
          ownedStagingPages: OWNED_PAGES,
          specificationTexts: ["Mejorar el copy de la pagina page_id=2091 para que convierta mejor"],
        });
        assert.equal(sinContenido.supported, false, "una propuesta en prosa no es ejecutable");

        const sinSpec = resolveApplyCapability({ hasSpecification: false, ownedStagingPages: OWNED_PAGES, specificationTexts: [] });
        assert.equal(sinSpec.supported, false);
      },
    },

    // --- Guards de entorno / produccion ---
    {
      name: "El guard de produccion esta intacto: WORDPRESS_ENV=production nunca permite apply",
      fn: () => {
        const check = checkApplyEnvironmentGuards({ ...GUARDS_OK, wordpressEnv: "production" });
        assert.equal(check.allowed, false);
        assert.match(check.reason, /produccion esta bloqueada/i);
      },
    },
    {
      name: "Hacen falta los CUATRO interruptores: apagar cualquiera impide la escritura",
      fn: () => {
        assert.equal(checkApplyEnvironmentGuards(GUARDS_OK).allowed, true);
        assert.equal(checkApplyEnvironmentGuards({ ...GUARDS_OK, departmentApplyEnabled: false }).allowed, false);
        assert.equal(checkApplyEnvironmentGuards({ ...GUARDS_OK, wordpressDraftsEnabled: false }).allowed, false);
        assert.equal(checkApplyEnvironmentGuards({ ...GUARDS_OK, wordpressBackend: "local_preview" }).allowed, false);
      },
    },
    {
      name: "Con los interruptores apagados no se lee ni se escribe NADA (ni siquiera el snapshot)",
      fn: async () => {
        const { state, deps } = fakeWordpress();
        const result = await executeApplyItem(approvedItem(), deps, { ...GUARDS_OK, departmentApplyEnabled: false });
        assert.equal(state.reads.length, 0);
        assert.equal(state.writes.length, 0);
        assert.equal(result.applyStatus, "approved", "el elemento sigue aprobado, simplemente no se intento");
        assert.ok(result.auditTrail.some((e) => e.event === "apply_not_attempted"));
      },
    },

    // --- Camino feliz: snapshot -> apply -> validacion ---
    {
      name: "Camino completo: snapshot ANTES del cambio, apply, validacion correcta -> applied",
      fn: async () => {
        const { state, deps } = fakeWordpress();
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);

        assert.equal(result.applyStatus, "applied");
        assert.equal(result.validationStatus, "passed");
        assert.equal(result.rollbackStatus, "not_needed");
        assert.equal(result.snapshot?.previousTitle, "Titulo antiguo");
        assert.equal(result.snapshot?.previousMetaDescription, "Meta antigua");
        // El snapshot se toma ANTES de escribir: la primera operacion es una lectura.
        const events = result.auditTrail.map((e) => e.event);
        assert.deepEqual(events.slice(0, 2), ["snapshot_taken", "applied"]);
        assert.equal(state.writes.length, 1);
        // El cuerpo de la pagina no se toca: solo title/meta.
        assert.equal(state.writes[0].contentHtml, "<p>cuerpo</p>");
        assert.equal(state.page.title, "Taquillas de melamina para vestuarios | Zentry");
      },
    },
    {
      name: "Nunca se escribe sobre una pagina que no este en draft (aunque este aprobada)",
      fn: async () => {
        const { state, deps } = fakeWordpress({ page: { id: 2091, status: "publish", title: "T", contentHtml: "<p>c</p>", excerpt: "M" } });
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);
        assert.equal(result.applyStatus, "blocked");
        assert.equal(state.writes.length, 0, "no puede haber ni una sola escritura sobre una pagina publicada");
      },
    },
    {
      name: "Si no se puede tomar el snapshot, no se escribe nada (blocked)",
      fn: async () => {
        const deps = {
          getPage: async (): Promise<StagingPageState> => {
            throw new Error("timeout leyendo la pagina");
          },
          updateDraft: async () => {
            throw new Error("no deberia llegar aqui");
          },
        };
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);
        assert.equal(result.applyStatus, "blocked");
        assert.equal(result.snapshot, null);
        assert.ok(result.auditTrail.some((e) => e.event === "snapshot_failed"));
      },
    },

    // --- Validacion fallida -> rollback ---
    {
      name: "Validacion fallida -> rollback verificado al estado del snapshot (rolled_back)",
      fn: async () => {
        const { state, deps } = fakeWordpress({ silentlyIgnoreWrites: true });
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);

        assert.equal(result.validationStatus, "failed");
        assert.equal(result.rollbackStatus, "rolled_back");
        assert.equal(result.applyStatus, "rolled_back");
        assert.equal(state.writes.length, 2, "una escritura de apply y una de rollback");
        assert.equal(state.writes[1].title, "Titulo antiguo", "el rollback restaura el title del snapshot");
        assert.equal(state.writes[1].excerpt, "Meta antigua", "el rollback restaura la meta del snapshot");
      },
    },
    {
      name: "Si la escritura falla, tambien se intenta rollback (la pagina pudo quedar a medias)",
      fn: async () => {
        const { state, deps } = fakeWordpress({ failWriteOn: 1 });
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);
        assert.equal(result.applyStatus, "rolled_back");
        assert.equal(result.rollbackStatus, "rolled_back");
        assert.equal(state.writes.length, 2);
      },
    },
    {
      name: "Rollback fallido -> blocked/critico: el sistema no vuelve a tocar la pagina",
      fn: async () => {
        const { deps } = fakeWordpress({ silentlyIgnoreWrites: true, failWriteOn: 2 });
        const result = await executeApplyItem(approvedItem(), deps, GUARDS_OK);
        assert.equal(result.applyStatus, "blocked");
        assert.equal(result.rollbackStatus, "rollback_failed");
        const critical = result.auditTrail.find((e) => e.event === "rollback_failed");
        assert.ok(critical, "debe quedar registrado como fallo critico");
        assert.match(critical?.detail ?? "", /CRITICO/);
      },
    },

    // --- Precondiciones del propio executor ---
    {
      name: "Un elemento que no esta approved nunca se ejecuta, aunque se le pase al executor",
      fn: async () => {
        for (const applyStatus of ["awaiting_approval", "rejected", "requires_manual_implementation", "blocked"] as const) {
          const { state, deps } = fakeWordpress();
          const result = await executeApplyItem(approvedItem({ applyStatus }), deps, GUARDS_OK);
          assert.equal(state.writes.length, 0, `un elemento "${applyStatus}" no puede escribir`);
          assert.equal(result.applyStatus, applyStatus);
        }
      },
    },
    {
      name: 'Incoherencia "approved sin aprobacion humana" -> blocked antes de escribir (defensa en profundidad)',
      fn: async () => {
        const { state, deps } = fakeWordpress();
        const item = approvedItem({ humanApproval: { status: "pending", approvalRequestId: "req-1", answeredBy: null, answeredAt: null, reason: "sin responder" } });
        const result = await executeApplyItem(item, deps, GUARDS_OK);
        assert.equal(result.applyStatus, "blocked");
        assert.equal(state.writes.length, 0);
      },
    },
  ];
}
