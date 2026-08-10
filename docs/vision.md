# Vision

Zentry/Tukandado quiere construir un "departamento IA": un conjunto de
agentes especializados, organizados por area de negocio, que trabajan de
forma continua auditando, proponiendo y (mas adelante, con aprobacion)
ejecutando mejoras — en lugar de depender de scripts sueltos o de trabajo
manual repetitivo.

## Estructura objetivo

Por encima de todos los departamentos habra un **Agente Director**, que:

- conoce el estado de todos los departamentos y agentes;
- prioriza que se trabaja primero segun impacto/negocio;
- enruta tareas propuestas a los agentes especializados correctos;
- centraliza que necesita aprobacion humana y de quien;
- reporta un resumen ejecutivo (a Slack/Telegram, o donde se decida) en
  lugar de que cada agente notifique por separado.

Debajo del Director, cada **departamento** agrupa agentes con un dominio de
conocimiento comun (ver `department-map.md` para la lista completa: Web &
Growth, Prospeccion, Comercial/Ventas, CRM/RevOps, Producto, Operaciones,
Proveedores/Compras, Logistica/Stock, Soporte, Finanzas, Legal,
BI/Reporting, QA/Safety).

Cada agente dentro de un departamento tiene un scope estrecho y explicito
(ver la spec de cada agente en `departments/<dept>/agents/*.agent.md`), y
opera siempre bajo el mismo contrato de tres modos: `READ`, `PROPOSE`,
`APPLY` (ver `operating-manual.md`).

## Por que empezar por SEO Watcher

El primer agente real es el **SEO Watcher Agent** (departamento Web &
Growth) porque:

1. Es de solo lectura por naturaleza — bajo riesgo para validar la
   arquitectura completa (config, logging, jobs, docs) sin tocar nada
   sensible.
2. Tiene una fuente de datos clara (Google Search Console) y un output
   facil de verificar (tareas de SEO priorizadas).
3. Sirve de plantilla para el resto de agentes: mismo patron de carpetas,
   mismo contrato de modos, mismo sistema de jobs y logs.

## Principio rector

**Ningun agente ejecuta cambios reales sin aprobacion humana explicita**,
hasta que el negocio decida, departamento por departamento y agente por
agente, activar el modo `APPLY` con las salvaguardas correspondientes. La
automatizacion se gana con evidencia, no se asume por defecto.
