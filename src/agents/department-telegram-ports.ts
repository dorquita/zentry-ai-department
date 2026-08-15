import { getWordpressPage } from "../adapters/wordpress";
import {
  getProductionPage,
  isProductionDraftsEnabled,
  isProductionExecutionEnabled,
  resolveProductionBackend,
  searchProductionPagesBySlug,
  updateProductionPublishedPageContent,
} from "../adapters/wordpress-production";
import { setApprovalRequestStatus } from "../core/approval-requests";
import { logger } from "../core/logger";
import { getAuthorizedTelegramChatId, getAuthorizedTelegramUserId, sendTelegramMessage } from "../core/telegram-gateway";
import { createRejectReasonPrompt, findActiveRejectReasonPromptForChat, setRejectReasonPromptStatus } from "../core/telegram-reject-prompts";
import { recordVisualReviewFeedback } from "../core/visual-review-feedback";
import { findChangeByTelegramApprovalId } from "../department/apply/change-registry";
import { DepartmentChangeRequest } from "../department/apply/change-types";
import { ProductionApplyGuards } from "../department/apply/guards";
import { applyApprovedChangeToProduction } from "../department/apply/production-executor";
import { registryTransitionPort } from "../department/apply/registry-port";
import { DepartmentTelegramPorts, DepartmentTelegramUpdate } from "../department/apply/telegram-handler";
import { computeVersionHash } from "../department/apply/version";

/**
 * CABLEADO REAL de los puertos del flujo de aprobacion del departamento
 * por Telegram: registro persistente, registro comun de aprobaciones,
 * gateway de Telegram, adaptadores de WordPress staging/produccion.
 *
 * Vive aparte del receiver a proposito: el receiver sigue siendo un
 * cableado fino de Telegram, y toda la logica de decision sigue estando
 * en modulos puros y testeables (telegram-decisions.ts,
 * telegram-handler.ts, production-executor.ts).
 *
 * Nota importante sobre PRODUCCION: este proceso es el servicio
 * permanente del VPS, que es donde el proyecto es persistente y donde
 * viven las credenciales. Publicar aqui es lo que permite responder al
 * momento con el resultado real. Los interruptores de produccion se leen
 * en CADA pulsacion (nunca se cachean): si estan apagados, la aprobacion
 * queda registrada y se responde diciendo exactamente que falta -- nunca
 * se escribe nada ni se finge que se publico.
 */

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

function resolveProductionGuards(): ProductionApplyGuards {
  let backend = "desconocido";
  try {
    backend = resolveProductionBackend();
  } catch {
    backend = "desconocido";
  }
  return {
    departmentProductionApplyEnabled: isEnabled("DEPARTMENT_PRODUCTION_APPLY_ENABLED"),
    productionExecutionEnabled: isProductionExecutionEnabled(),
    productionWritesEnabled: isProductionDraftsEnabled(),
    productionBackend: backend,
  };
}

export function buildDepartmentTelegramPorts(): DepartmentTelegramPorts {
  const changes = registryTransitionPort();

  return {
    authorizedChatId: getAuthorizedTelegramChatId(),
    authorizedUserId: getAuthorizedTelegramUserId(),

    findChangeByApprovalId: (approvalRequestId) => findChangeByTelegramApprovalId(approvalRequestId),

    changes,

    setSharedApprovalStatus: (approvalRequestId, status, detail) => {
      setApprovalRequestStatus(approvalRequestId, status, { answer: status, answeredBy: detail.answeredBy, reason: detail.reason });
    },

    readStagingVersionHash: async (change: DepartmentChangeRequest) => {
      const pageId = change.staging?.wordpressPageId;
      if (typeof pageId !== "number") return null;
      try {
        const page = await getWordpressPage(pageId);
        return computeVersionHash({ status: page.status, title: page.title, metaDescription: page.excerpt, contentHtml: page.contentHtml });
      } catch (err) {
        // Fail-closed: no poder comprobarlo se trata igual que "ha
        // cambiado". Nunca se publica sobre una suposicion.
        logger.error("No se pudo releer staging para comprobar la version aprobada", { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    runProductionApply: async (change: DepartmentChangeRequest) => {
      const result = await applyApprovedChangeToProduction(
        change,
        {
          getStagingPage: async (pageId) => {
            const page = await getWordpressPage(pageId);
            return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt, link: page.link, slug: page.slug };
          },
          findProductionPagesBySlug: async (slug) => {
            const results = await searchProductionPagesBySlug(slug);
            return results.map((r) => ({ id: r.id, slug: r.slug, status: r.status }));
          },
          getProductionPage: async (pageId) => {
            const page = await getProductionPage(pageId);
            return {
              id: page.id,
              status: page.status,
              title: page.title,
              contentHtml: page.contentHtml,
              excerpt: page.excerpt,
              slug: page.slug,
              link: page.link,
            };
          },
          updateProductionPublishedPage: async (input) => {
            await updateProductionPublishedPageContent({
              pageId: input.pageId,
              title: input.title,
              contentHtml: input.contentHtml,
              excerpt: input.excerpt,
            });
          },
        },
        resolveProductionGuards(),
        changes
      );
      return { change: result.change, message: result.message };
    },

    reply: async (text: string) => {
      // Texto plano: los titles/metas reales llevan comillas y `<`/`&`, y
      // el parser HTML de Telegram ya ha roto envios de este proyecto.
      await sendTelegramMessage(text, { plainText: true });
    },

    openRejectionPrompt: (approvalRequestId, chatId) => {
      createRejectReasonPrompt(approvalRequestId, chatId);
    },

    findActiveRejectionPrompt: (chatId) => {
      const prompt = findActiveRejectReasonPromptForChat(chatId);
      return prompt ? { promptId: prompt.promptId, approvalRequestId: prompt.approvalRequestId } : undefined;
    },

    closeRejectionPrompt: (promptId) => {
      setRejectReasonPromptStatus(promptId, "answered");
    },

    recordFeedback: (input) => {
      // Se reutiliza el registro de feedback humano YA existente: es el
      // sitio donde los agentes pueden leer que se rechazo y por que.
      recordVisualReviewFeedback({ approvalRequestId: input.approvalRequestId, feedback: input.feedback, source: "telegram" });
    },

    actorLabel: (update: DepartmentTelegramUpdate) => (update.fromUserId ? `telegram:${update.fromUserId}` : `telegram:chat:${update.chatId}`),
  };
}
