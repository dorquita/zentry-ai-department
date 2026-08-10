# Content Work Order Builder

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Amplia las work orders `draft` de categoria contenido con un **brief
operativo** (no el articulo/landing final): tipo de contenido, keyword
principal/secundarias, estructura H2/H3, intencion, marca objetivo, CTA
y enlaces internos. **Nunca escribe en WordPress.**

## 2. Que genera por cada work order de contenido

- Tipo de contenido (articulo, landing nueva, bloque de categoria, FAQ,
  mejora de title/meta, enlace interno).
- Titulo recomendado, keyword principal, keywords secundarias (buscadas
  en el resto del Action Backlog para formar un posible cluster SEO).
- Estructura H2/H3 sugerida.
- Intencion de busqueda y marca objetivo (Zentry / Tukandado / mixta),
  via el Brand/Intent Router.
- CTA recomendado.
- Enlaces internos sugeridos.
- Nota de cluster: que otras keywords del backlog podrian agruparse con
  esta.

## 3. Reglas (no negociables)

- **Solo amplia work orders ya creadas** (status `draft`, categoria
  contenido). No crea work orders nuevas.
- **No escribe contenido final** — es un brief para que una persona (o
  otro proceso) redacte el texto, no el articulo entero.
- **No toca WordPress.** No publica ni crea borradores.
- **No modifica produccion**, en ningun caso.
- **No maneja secretos.**
- Al terminar, pasa el status de `draft` a `ready_for_review`.

## 4. Formato de salida

`reports/content-work-orders/content-work-orders-<fecha>.md`: una
seccion por brief, con todos los campos anteriores.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (por cada brief generado),
`agent_finished`.
