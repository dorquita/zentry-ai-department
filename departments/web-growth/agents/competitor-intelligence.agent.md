# Competitor Intelligence Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Analiza un numero pequeno y fijo de paginas publicas de competidores
(definidas a mano en `config/competitors.json`) para detectar keywords,
sectores y materiales que la competencia trabaja y que Zentry/Tukandado
todavia no tiene como keyword objetivo.

## 2. Objetivo

Comparar el vocabulario SEO de la competencia (title, meta description,
H1, H2) contra `config/seo-target-keywords.json` y las keywords ya
trackeadas en `data/jobs.jsonl`, para proponer nuevas keywords SEO,
posibles candidatas SEM y landings/contenidos que podrian faltar.

## 3. Competidores (v1)

Definidos en `config/competitors.json`:

- **Marmataquillas** (`marmataquillasmetalicas.es`) — competidor, taquillas metalicas.
- **Taquiblok / Taquillas Blok** (`taquillasblok.com`) — competidor, taquillas fenolicas y metalicas.
- **Setroc** (`setrocmm.com`) — competidor, taquillas metalicas y smart lockers.
- **Ojmar** (`ojmar.com`) — **referencia**, no competidor identico: fabrica
  cerraduras/sistemas de cierre para taquillas, no el mueble. Util para
  vocabulario de cerraduras (Tukandado).

Anadir nuevos competidores es un proceso manual: editar
`config/competitors.json` con nombre, dominio, rol (`competitor` o
`reference`) y hasta `maxUrlsPerDomain` URLs concretas, documentando de
donde sale el dominio. No hay descubrimiento automatico de competidores en
v1 (evita analizar dominios no verificados).

## 4. Reglas (no negociables)

- **Solo lectura de HTML publico.** Ninguna URL fuera de las listadas en
  `config/competitors.json`. Nunca hace login, nunca usa cookies de
  sesion, nunca ejecuta JavaScript de la pagina (solo parsea el HTML tal
  cual llega).
- **Respeta `robots.txt`** si `respectRobotsTxt: true` en la config
  (por defecto si): antes de leer una URL, comprueba las reglas
  `Disallow` del `User-agent: *` del dominio y omite las URLs bloqueadas.
- **Rate limit conservador**: espera `rateLimitMs` (2000 ms por defecto)
  entre cada peticion, sin paralelizar.
- **Tope de URLs por dominio**: `maxUrlsPerDomain` (4 por defecto). Nunca
  recorre el sitio entero ni sigue enlaces (no hay crawling recursivo).
- **No intenta saltarse bloqueos** (ni captchas, ni user-agents falsos de
  navegador, ni proxies). Si una peticion falla o esta bloqueada, se
  registra como warning y se continua con la siguiente URL.
- **No modifica nada externo**: no llama a WordPress, Google Ads, GA4,
  GTM ni n8n propios ni ajenos.
- **Solo propone.** Su unico output es un informe en
  `reports/competitor-intelligence/` y eventos en
  `data/department-events.jsonl`. No crea contenido, no publica nada.
- **No maneja secretos**: no necesita ni usa ninguna credencial.

## 5. Que extrae de cada pagina

- `title`
- `meta description`
- Todos los `<h1>`
- Los primeros `<h2>` (hasta 15)

## 6. Como detecta gaps

1. Combina title + meta description + H1 + H2 de cada pagina, tokeniza y
   genera bigramas/trigramas (2-3 palabras), filtrando stopwords.
2. Cuenta en cuantas paginas distintas aparece cada termino. Descarta los
   que aparecen en menos de 2 paginas (ruido).
3. Descarta los que ya estan cubiertos (substring match) en
   `config/seo-target-keywords.json` o en las keywords ya presentes en
   `data/jobs.jsonl`.
4. Clasifica cada termino restante con el
   [Brand/Intent Router](../../../docs/brand-intent-strategy.md)
   (`src/core/brand-intent-router.ts`). Descarta los clasificados como
   `irrelevant_or_low_fit`.
5. Marca como "candidata a SEM" las que aparecen en >=2 competidores Y
   tienen senal comercial fuerte (categoria `zentry_smart_locker` /
   `tukandado_lock_core`, o mencionan un sector B2B).
6. Por separado, compara terminos de sector (gimnasios, colegios,
   centros deportivos...) y material (melamina, fenolica, metalica...)
   mencionados por la competencia pero ausentes en nuestras keywords
   objetivo, como posibles gaps de landing/contenido.

## 7. Formato de salida

`reports/competitor-intelligence/competitor-intelligence-<fecha>.md`:

- Resumen ejecutivo.
- Tabla de paginas analizadas (competidor, rol, URL, estado).
- Tabla de keywords de la competencia no cubiertas (termino, frecuencia,
  competidores, clasificacion Brand/Intent, si es candidata a SEM).
- Tabla de gaps de sector/material.
- Warnings (URLs bloqueadas por robots.txt, errores HTTP, timeouts).
- Confirmacion de seguridad.

## 8. Eventos que emite

`agent_started`, `warning_detected` (por cada URL bloqueada/fallida),
`competitor_keyword_detected` (por cada gap de keyword), `brand_intent_classified`
(por cada termino clasificado), `agent_finished`.

## 9. Consumido por

SEO Director, Content Planner, CRO/Landing Reviewer y Growth Director
pueden leer su informe y sus eventos (mismo `departmentRunId`) para
incorporar oportunidades de competencia a sus propias propuestas.
