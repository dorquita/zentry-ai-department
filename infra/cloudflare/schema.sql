-- ---------------------------------------------------------------------------
-- Schema de D1 (SQLite) para el sistema de aprobaciones del departamento IA.
--
-- Sustituye al registro en fichero de la fase anterior
-- (`department-changes.jsonl` en el `data/` del cliente activo, atado al
-- filesystem del VPS).
--
-- Tres tablas y ninguna mas:
--
--   approvals          el registro completo de cada cambio + su estado
--   processed_updates  idempotencia del webhook de Telegram
--   rejection_prompts  la pregunta abierta "por que lo rechazas?"
--
-- ESTE FICHERO ES LO QUE SE APLICA DE VERDAD, pero NO es la fuente de
-- verdad del contrato. Tiene que ser EQUIVALENTE a
-- `D1_SCHEMA_STATEMENTS` en src/worker/d1-store.ts, que es el unico
-- codigo que consulta esta base de datos: mismas tablas, mismas
-- columnas, mismos nombres de indice y mismas columnas indexadas. Si los
-- dos se separan, los tests (que usan un doble en memoria construido a
-- partir de ese array) pasarian y produccion fallaria.
--
-- El modelo de dominio vive en TypeScript:
--   src/department/apply/change-types.ts   (DepartmentChangeRequest)
--   src/department/apply/state-machine.ts  (DepartmentChangeStatus)
--   src/approvals/store.ts                 (ApprovalStore)
--
-- Aplicar con:
--   npx wrangler d1 execute zentry-approvals --remote --file=./schema.sql
--
-- Todo es CREATE ... IF NOT EXISTS: el fichero es idempotente y se puede
-- volver a ejecutar sin romper nada ni perder datos. Lo que NO hace es
-- migrar tablas ya creadas; cambiar una columna es una migracion aparte.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- approvals
--
-- Una fila = una version concreta de una recomendacion (un `changeId`),
-- que es exactamente lo que el resto del sistema llama `approvalId`.
--
-- Diseño deliberado: el registro COMPLETO se guarda como un unico JSON
-- (`record`) y solo se sacan a columnas los campos por los que se
-- consulta o se decide. Motivos:
--
--   1. El modelo de dominio (DepartmentChangeRequest) es profundo y
--      anidado (staging, telegram, humanDecision, production,
--      auditTrail...). Desmontarlo en columnas obligaria a migrar la
--      tabla cada vez que el contrato crezca y a reconstruir el objeto a
--      mano en cada lectura: dos sitios donde perder un campo en
--      silencio.
--   2. `status` SI es columna propia porque es la primitiva de
--      seguridad: la transicion condicional y atomica se resuelve con
--      `UPDATE ... WHERE approval_id = ? AND status IN (...)` mirando
--      cuantas filas cambiaron. Eso no se puede hacer de forma fiable
--      contra un campo escondido dentro del blob JSON.
--
-- El blob se parchea DENTRO de esa misma sentencia con las funciones
-- JSON de SQLite (`json_patch` / `json_set`), justamente para no tener
-- que leerlo antes: un read-then-write reintroduciria la carrera que
-- todo esto existe para eliminar.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS approvals (
  -- `changeId` del cambio. Es determinista
  -- (`<departmentRunId>#change-<rank>-v<version>`), asi que la PK da
  -- gratis la idempotencia de `create()`: el INSERT lleva
  -- `ON CONFLICT(approval_id) DO NOTHING`, de modo que reintentar la
  -- creacion de la MISMA version no duplica ni pisa nada.
  approval_id       TEXT PRIMARY KEY,

  -- Recomendacion a la que pertenece. Varias versiones (v1, v2, ...)
  -- comparten recommendation_id y tienen approval_id distinto.
  recommendation_id TEXT NOT NULL,

  -- Pasada coordinada que la genero.
  department_run_id TEXT NOT NULL,

  -- Estado de la maquina de estados
  -- (src/department/apply/state-machine.ts). Sin CHECK de valores a
  -- proposito: ver la nota al final del fichero.
  status            TEXT NOT NULL,

  -- Numero de version de la propuesta (1, 2, 3...). En columna propia
  -- solo para poder ordenar el historico de una recomendacion sin
  -- deserializar el JSON de todas las filas.
  version           INTEGER NOT NULL,

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,

  -- El DepartmentChangeRequest entero, serializado. Incluye auditTrail,
  -- snapshots, hashes de version y la decision humana.
  record            TEXT NOT NULL
);

-- Historico de una recomendacion, de la mas antigua a la mas nueva
-- (`listByRecommendation`), y feedback humano heredado
-- (`listHumanFeedback`, que filtra por status = 'rejected' sobre este
-- mismo camino). `version` va DENTRO del indice para que el
-- `ORDER BY version ASC` salga del propio indice y no de una ordenacion
-- en memoria.
CREATE INDEX IF NOT EXISTS idx_approvals_recommendation
  ON approvals (recommendation_id, version);

-- Todas las aprobaciones de una misma pasada (`listByRun`): es la
-- consulta con la que GitHub Actions sabe que quedo pendiente.
-- `created_at` va en el indice por el mismo motivo que `version` arriba:
-- la consulta ordena por el.
CREATE INDEX IF NOT EXISTS idx_approvals_run
  ON approvals (department_run_id, created_at);

-- Busquedas operativas por estado ("que hay en awaiting_approval", "que
-- se quedo en production_queued sin arrancar"). Sin este indice, un
-- listado de pendientes es un scan completo de la tabla.
CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (status);


-- ===========================================================================
-- processed_updates
--
-- LA GARANTIA ANTI-REPLAY DEL WEBHOOK, y no hay otra.
--
-- Telegram reentrega un update mientras no reciba un 200: un timeout, un
-- despliegue a medias o un error transitorio bastan para que el MISMO
-- `update_id` llegue dos o tres veces. Sin esta tabla, cada reentrega
-- volveria a ejecutar el handler -- y una de esas ejecuciones podria
-- encolar un segundo apply en produccion.
--
-- La proteccion NO es un `SELECT` previo seguido de un `INSERT` (eso es
-- un read-then-write con una ventana de carrera en medio): es la PROPIA
-- CLAVE PRIMARIA. El Worker hace
--
--     INSERT INTO processed_updates (update_id, at) VALUES (?, ?)
--       ON CONFLICT(update_id) DO NOTHING;
--
-- y mira cuantas filas se escribieron:
--
--     1 fila  -> primera vez que se ve este update -> procesar
--     0 filas -> replay                            -> responder 200 y NO hacer nada
--
-- Es una sola operacion atomica resuelta por el motor, asi que dos
-- entregas simultaneas del mismo update no pueden ganar las dos. Una
-- colision aqui no es un error: es la deteccion de un reenvio.
--
-- Deliberadamente NO hay indices adicionales: la PK es el unico acceso
-- que existe (lookup por update_id) y cualquier indice extra solo
-- encareceria la escritura, que esta en el camino critico del webhook.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS processed_updates (
  -- `update_id` de Telegram: entero, monotono creciente y unico por bot.
  -- Es la PK, es decir: la unicidad ES la idempotencia.
  update_id INTEGER PRIMARY KEY,

  -- Cuando se proceso (ISO 8601). Sirve para diagnostico y para poder
  -- podar filas viejas algun dia. NO se usa para decidir nada.
  at        TEXT NOT NULL
);


-- ===========================================================================
-- rejection_prompts
--
-- Un rechazo NO esta cerrado hasta que hay motivo. Al pulsar RECHAZAR el
-- bot pregunta "indicame el motivo" y el cambio queda en
-- `awaiting_rejection_reason`. Esta tabla es lo que permite saber, cuando
-- llega el siguiente mensaje de texto, A QUE APROBACION corresponde ese
-- motivo.
--
-- Hay DOS caminos de correlacion, y por eso hay dos indices:
--
--   1. PREFERENTE -- por `reply_to_message_id`: la persona responde
--      directamente al mensaje del bot. Es exacto y no ambiguo, y
--      funciona aunque haya varios rechazos abiertos a la vez.
--   2. DE RESPALDO -- por (chat_id, user_id): la persona escribe el
--      motivo como mensaje suelto, sin responder a nada. Es lo que pasa
--      en la practica desde el movil.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS rejection_prompts (
  -- Un prompt abierto como mucho por aprobacion. Como PK, reabrir el
  -- mismo prompt no duplica filas: el INSERT lleva
  -- `ON CONFLICT(approval_id) DO UPDATE ... closed_at = NULL`, que
  -- reabre la pregunta en vez de crear una segunda.
  approval_id       TEXT PRIMARY KEY,

  -- Chat y usuario a los que se pregunto. Se guardan como TEXT (no
  -- INTEGER) a proposito: los ids de Telegram son enteros de 64 bits y
  -- el resto del proyecto ya los trata como cadenas
  -- (`TelegramApprovalRecord.chatId` es `string | null`). Mezclar los dos
  -- tipos haria que una comparacion fallara en silencio.
  chat_id           TEXT NOT NULL,
  user_id           TEXT NOT NULL,

  -- `message_id` del mensaje del bot que hizo la pregunta. NULL cuando
  -- Telegram no confirmo el envio: en ese caso solo queda la correlacion
  -- de respaldo por chat+usuario.
  prompt_message_id INTEGER,

  created_at        TEXT NOT NULL,

  -- Cierre BLANDO: `closeRejectionPrompt()` no borra la fila, escribe
  -- aqui la fecha. La fila se queda como rastro de que esa pregunta se
  -- hizo y se contesto, y las dos busquedas filtran por
  -- `closed_at IS NULL`. NULL = pregunta todavia abierta.
  closed_at         TEXT
);

-- Camino de RESPALDO: `findOpenRejectionPrompt(chatId, userId)`, que
-- filtra por `closed_at IS NULL` y se queda con el mas reciente.
--
-- NO es UNIQUE a proposito. Si en un mismo dia se rechazan dos cambios
-- desde el mismo chat sin contestar al primero, hay dos prompts abiertos
-- a la vez; un UNIQUE aqui haria fallar el segundo RECHAZAR, que es peor
-- que la ambiguedad. La ambiguedad se resuelve quedandose con el
-- `created_at` mas reciente, y sobre todo empujando a la persona a usar
-- el camino preferente (responder al mensaje).
CREATE INDEX IF NOT EXISTS idx_rejection_prompts_open
  ON rejection_prompts (chat_id, user_id, closed_at);

-- Camino PREFERENTE: `findRejectionPromptByMessageId(chatId, promptMessageId)`.
-- Un `message_id` identifica un unico mensaje dentro de un chat, asi que
-- esta busqueda devuelve como mucho una fila abierta. Tampoco se declara
-- UNIQUE: la unicidad ya la garantiza Telegram, y un indice unico aqui
-- solo añadiria una forma nueva de que una escritura falle en caliente,
-- dentro del webhook, sin ganar ninguna garantia real.
CREATE INDEX IF NOT EXISTS idx_rejection_prompts_message
  ON rejection_prompts (chat_id, prompt_message_id);


-- ===========================================================================
-- NOTA sobre las constraints que NO estan aqui, y por que
--
-- Se han valorado y descartado tres, todas por el mismo motivo: una
-- constraint que falla en caliente dentro del webhook hace que el Worker
-- devuelva un error, que Telegram reintente, y que el reintento vuelva a
-- fallar -- un bucle. La validacion de dominio se hace en TypeScript
-- (fail-closed, con un motivo legible), donde puede convertirse en un
-- mensaje util en vez de en un 500.
--
--   1. CHECK sobre `approvals.status` con la lista de estados validos.
--      Duplicaria DEPARTMENT_CHANGE_STATUSES en el DDL y obligaria a una
--      migracion cada vez que se añada un estado. La legalidad de una
--      transicion la decide `ALLOWED_TRANSITIONS`; la base de datos solo
--      tiene que garantizar que la transicion es ATOMICA, no que sea
--      legal.
--
--   2. CHECK (json_valid(record)). El blob solo se escribe con
--      `json_patch` / `json_set` sobre un JSON ya valido, asi que la
--      constraint no podria dispararse nunca en el flujo real.
--
--   3. FOREIGN KEY rejection_prompts.approval_id -> approvals.approval_id.
--      Es correcta en el dominio (el Worker siempre crea la aprobacion
--      antes que su prompt), pero el doble en memoria que usan los tests
--      no la aplica: quedaria una diferencia entre lo que pasa en los
--      tests y lo que pasa en produccion, que es exactamente el tipo de
--      divergencia que este fichero tiene que evitar.
--
-- Si alguna se añade en el futuro, hay que añadirla TAMBIEN a
-- `D1_SCHEMA_STATEMENTS` en src/worker/d1-store.ts, en la misma tarea.
-- ===========================================================================
