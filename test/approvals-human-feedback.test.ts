import * as assert from "node:assert/strict";
import {
  MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION,
  renderPreviousHumanFeedback,
  selectPreviousHumanFeedback,
} from "../src/approvals/human-feedback-context";
import { HumanFeedbackEntry } from "../src/approvals/store";

export interface TestCase {
  name: string;
  fn: () => void;
}

function entry(overrides: Partial<HumanFeedbackEntry> = {}): HumanFeedbackEntry {
  return {
    approvalId: "dept-1#change-1-v1",
    recommendationId: "dept-1#rec-1",
    recommendationTitle: "Reescribir metas de la familia melamina",
    version: 1,
    rejectionReason: "No me gusta el H1. Quiero mantener el enfoque en cerraduras electronicas, no en control de acceso.",
    rejectedAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

export function runApprovalsHumanFeedbackTests(): TestCase[] {
  return [
    {
      name: "El motivo viaja LITERAL al prompt: no se resume, no se parafrasea, no se convierte en regla",
      fn: () => {
        const reason = "No me gusta el H1. Quiero mantener el enfoque en cerraduras electronicas, no en control de acceso.";
        const text = renderPreviousHumanFeedback(selectPreviousHumanFeedback([entry({ rejectionReason: reason })]));
        assert.ok(text.includes(`"${reason}"`), "el motivo debe aparecer entrecomillado y completo");
        assert.match(text, /no lo reinterpretes/i);
        assert.match(text, /no lo generalices a una regla/i);
      },
    },
    {
      name: "Se presenta como evidencia de una decision humana, con su version y su fecha",
      fn: () => {
        const text = renderPreviousHumanFeedback(selectPreviousHumanFeedback([entry({ version: 3, rejectedAt: "2026-08-14T09:00:00.000Z" })]));
        assert.ok(text.includes("version 3"));
        assert.ok(text.includes("2026-08-14T09:00:00.000Z"));
        assert.ok(text.includes("Reescribir metas de la familia melamina"));
      },
    },
    {
      name: "Sin feedback no se añade ninguna seccion al prompt (no se gasta contexto en decir que no hay nada)",
      fn: () => {
        assert.equal(renderPreviousHumanFeedback([]), "");
        assert.deepEqual(selectPreviousHumanFeedback([]), []);
      },
    },
    {
      name: "Un rechazo SIN motivo no aporta nada y se descarta",
      fn: () => {
        assert.deepEqual(selectPreviousHumanFeedback([entry({ rejectionReason: "" }), entry({ rejectionReason: "   " })]), []);
      },
    },
    {
      name: "Lo mas reciente manda: se ordena por version descendente y se recorta",
      fn: () => {
        const many = Array.from({ length: 9 }, (_, i) => entry({ version: i + 1, rejectionReason: `motivo v${i + 1}` }));
        const selected = selectPreviousHumanFeedback(many);
        assert.equal(selected.length, MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION);
        assert.equal(selected[0].version, 9, "primero la version mas reciente");
        assert.equal(selected[selected.length - 1].version, 5);
      },
    },
    {
      name: "El motivo se recorta de espacios pero NUNCA se altera su contenido",
      fn: () => {
        const selected = selectPreviousHumanFeedback([entry({ rejectionReason: "  el CTA no destaca  " })]);
        assert.equal(selected[0].rejectionReason, "el CTA no destaca");
      },
    },
    {
      name: "Un motivo con comillas o markup se transporta tal cual (no se escapa ni se reescribe)",
      fn: () => {
        const raw = 'el H1 dice "control de acceso" y <strong>no</strong> es eso';
        const selected = selectPreviousHumanFeedback([entry({ rejectionReason: raw })]);
        assert.equal(selected[0].rejectionReason, raw);
        assert.ok(renderPreviousHumanFeedback(selected).includes(raw));
      },
    },
  ];
}
