# WordPress MCP Adapter (Fase O10.5 — diagnostico + arquitectura, sin implementar)

## Resumen

Esta fase NO activa nada nuevo. `WORDPRESS_DRAFTS_ENABLED` sigue en
`false` y ahora hay una segunda variable, `WORDPRESS_BACKEND`, que por
defecto es `local_preview` — con esos dos valores por defecto, el
WordPress Draft Agent se comporta exactamente igual que al cerrar la Fase
O10: solo previews locales, cero llamadas a WordPress.

Lo que anade esta fase es la arquitectura para que, el dia que se decida
activar una escritura real, el agente pueda elegir entre dos
implementaciones (`rest` o `mcp`) sin cambiar su propio codigo — y deja
constancia explicita de por que la opcion `mcp` no esta implementada
todavia.

## 1. ¿Existe un servidor MCP "Novamira" en el VPS?

**No.** Se comprobo directamente en `/opt/zentry-ai-department`
(72.61.98.103):

- Ningun proceso con "novamira" o "mcp" en el nombre (`ps aux`).
- Ningun puerto en escucha relacionado (`ss -tlnp` solo muestra ssh,
  caddy, y el docker-proxy de n8n en 127.0.0.1:5678).
- Ningun directorio `*novamira*` en `/opt` ni en el resto del sistema.
- `/opt` solo contiene `n8n`, `qdrant`, `zentry-ai-department` y
  `backups`/`containerd` — nada de Novamira ni de MCP.
- Ningun servicio systemd relacionado.

## 2. ¿Que es entonces "Novamira"?

Es un servidor MCP **ya conectado a esta sesion de Claude Code**
(namespace `novamira-zentrylockers-co`), que resulta ser el plugin
**Novamira v1.8.0**, activo en el **WordPress de produccion real**
(`zentrylockers.com`, WordPress 7.0.2, PHP 8.2.30). No tiene ninguna
relacion con el proyecto `zentry-ai-department` ni con el VPS de
Hostinger — es una integracion completamente distinta, a nivel de esta
conversacion con el asistente, no del backend Node.js que corre el
`growth:daily` diario.

Sus propias instrucciones (devueltas por
`mcp-adapter-discover-abilities`, una llamada de solo lectura, no se
ejecuto ninguna ability de escritura durante este diagnostico) dicen
literalmente:

> "Novamira gives you unrestricted control over this WordPress
> installation."

## 3. ¿Que abilities expone? ¿Hay alguna lo bastante estrecha para "crear un borrador"?

**No.** Se inspecciono la lista completa de abilities (37 en total) mas
el detalle de las dos mas relevantes. No existe ninguna ability del tipo
"crear una pagina/post en borrador y nada mas". Las unicas vias
disponibles para crear contenido son:

| Ability | Que hace | Por que no sirve para esto |
|---|---|---|
| `novamira/execute-php` | Ejecuta PHP arbitrario en el servidor con el entorno completo de WordPress (`$wpdb`, todas las funciones, todos los plugins). Marcada `destructive: true`. | Con esto se podria crear un borrador, pero tambien borrar la base de datos, modificar WooCommerce, cambiar precios, tocar el checkout — no hay forma de restringir el codigo que se ejecuta. |
| `novamira/run-wp-cli` | Ejecuta cualquier comando `wp` (WP-CLI) arbitrario, sin lista blanca de subcomandos. Tambien `destructive: true`. | Mismo problema: `wp post create --post_status=draft` funcionaria, pero tambien `wp db query "DROP TABLE ..."` o `wp plugin deactivate woocommerce`. |
| `novamira/gutenberg-write-content` + flujo de "pending batches" | Escribe/edita el `post_content` de un target que **ya existe**. Solo acepta bloques "Novamira-owned dynamic-only" (no bloques nativos/de terceros sin pasar por finalizacion en navegador). | Pensado para editar contenido existente, no para crear paginas nuevas. Ademas requiere que la pagina objetivo ya exista. |
| `novamira/delete-file`, `novamira/write-file`, `novamira/create-admin-access-link` | Filesystem bajo `ABSPATH` (protegido solo en la raiz/`wp-admin`/`wp-includes`) y generacion de enlaces de acceso admin de un solo uso. | Ninguna relacion directa con "crear un borrador", pero confirman el alcance: control total del servidor, no solo de contenido. |

No hay ninguna ability equivalente a `POST /wp-json/wp/v2/pages` con
`status: draft` y nada mas — que es exactamente lo unico que hace
`src/adapters/wordpress.ts` (backend `rest`, Fase O10).

## 4. Por que esto es incompatible con la politica de seguridad de O10

`docs/wordpress-safety-policy.md` garantiza que el WordPress Draft Agent
tiene una superficie de escritura **minima y enumerable**: una sola
funcion (`createWordpressDraftPage`), un solo endpoint, un solo campo de
estado forzado (`status: draft`), sin acceso a ejecucion de codigo,
comandos de shell, ni al sistema de ficheros del servidor.

Cualquier implementacion de `WORDPRESS_BACKEND=mcp` que usara
`execute-php` o `run-wp-cli` para "solo crear un borrador" seguiria
teniendo, en la practica, capacidad de hacer *cualquier otra cosa* — lo
que contradice directamente las condiciones de esta fase (no tocar
WooCommerce, precios, checkout, home, formularios) aunque el codigo que
se ejecutara hoy fuera efectivamente estrecho. La superficie de ataque/
error no es "lo que el codigo hace hoy", es "lo que la ability permite".

## 5. Como se conectaria (si se implementara)

El backend MCP, si algun dia se implementa, tendria una arquitectura
distinta a la del backend `rest`:

- **`rest` (Fase O10, activo):** el script Node.js del VPS hace una
  llamada HTTP directa a `https://zentrylockers.com/wp-json/wp/v2/pages`
  con Basic Auth (usuario + Application Password). Sin dependencias
  nuevas — usa `fetch` nativo de Node.
- **`mcp` (Fase O10.5, skeleton):** el script Node.js tendria que actuar
  el mismo como **cliente MCP** (protocolo JSON-RPC 2.0 sobre HTTP/SSE o
  stdio segun el transporte del servidor), no como cliente de una API
  REST convencional. Eso implicaria:
  - Anadir una dependencia nueva (el SDK oficial de MCP para Node,
    `@modelcontextprotocol/sdk`, o un cliente HTTP+SSE hecho a mano).
  - Una URL de endpoint del servidor MCP de Novamira (no visible desde
    aqui: la conexion que usa esta sesion de Claude Code esta gestionada
    por la configuracion de MCP del propio Claude Code, no por ninguna
    variable de entorno del proyecto `zentry-ai-department`).
  - Un token de autenticacion propio de Novamira (el listado de
    abilities menciona tokens "bearer" para `create-upload-link` y
    tokens+nonce para `create-admin-access-link` — sugiere que Novamira
    emite sus propias credenciales de API, distintas de
    `WORDPRESS_APP_PASSWORD`).
  - Llamar a una ability concreta con `execute_ability(name, params)` —
    hoy, sin una ability estrecha dedicada, la unica forma de "crear un
    borrador" seria via `execute-php`/`run-wp-cli`, que esta fase
    descarta explicitamente por las razones de la seccion 4.

## 6. REST vs MCP — comparativa

| | `rest` (Fase O10, implementado) | `mcp` (Fase O10.5, skeleton) |
|---|---|---|
| Transporte | HTTP directo a la REST API de WordPress | JSON-RPC sobre el protocolo MCP (servidor Novamira) |
| Autenticacion | Basic Auth con Application Password (`WORDPRESS_USERNAME`/`WORDPRESS_APP_PASSWORD`) | Token propio de Novamira (no definido, no configurado) |
| Superficie de escritura | Una sola funcion, un solo endpoint (`POST /wp-json/wp/v2/pages`, siempre `status: draft`) | Ninguna ability estrecha disponible hoy — solo abilities de control total (`execute-php`, `run-wp-cli`) |
| Dependencias nuevas | Ninguna (`fetch` nativo) | SDK de MCP (no anadido) |
| Estado | Implementado y validado (Fase O10) | Skeleton: `createWordpressDraftPageViaMcp()` siempre lanza un error explicito |
| Seguridad | Alineado con `docs/wordpress-safety-policy.md` | Incompatible mientras Novamira no ofrezca una ability estrecha — ver seccion 4 |

## 7. Config pendiente de decidir (nada de esto se ha tocado en esta fase)

Si en el futuro se decide implementar el backend `mcp` (porque Novamira
anade una ability estrecha, o porque se conecta un servidor MCP distinto
y mas restringido), harian falta variables de entorno nuevas — nombres
propuestos, **no anadidos a `.env.example` todavia** porque no hay
ninguna implementacion real que las use:

```
WORDPRESS_MCP_ENDPOINT_URL=
WORDPRESS_MCP_API_KEY=
```

## 8. Que SI cambia en esta fase

- `src/adapters/wordpress-backend.ts` (nuevo): resuelve
  `WORDPRESS_BACKEND` (`local_preview`/`rest`/`mcp`), por defecto
  `local_preview`.
- `src/adapters/wordpress-mcp.ts` (nuevo): skeleton, mismo contrato de
  tipos que `wordpress.ts`, siempre lanza un error explicito si se
  invoca.
- `src/agents/wordpress-draft-agent.ts`: el bloque de creacion real ahora
  comprueba **dos** variables, no una — `WORDPRESS_DRAFTS_ENABLED=true`
  **Y** `WORDPRESS_BACKEND !== "local_preview"` — antes de intentar nada.
  Con `WORDPRESS_BACKEND=rest` usa el adaptador de la Fase O10 (sin
  cambios de comportamiento); con `WORDPRESS_BACKEND=mcp` llama al
  skeleton, que lanza inmediatamente.
- `.env.example`: nueva variable `WORDPRESS_BACKEND=local_preview`.

## Ver tambien

- `docs/wordpress-draft-agent.md` — como funciona el agente.
- `docs/wordpress-safety-policy.md` — las 3 condiciones para un borrador
  real y todo lo que el sistema nunca hace, backend REST o MCP.
