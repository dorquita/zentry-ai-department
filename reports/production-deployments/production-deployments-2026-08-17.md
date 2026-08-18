# Production Deployment Planner — 2026-08-17

- **departmentRunId:** `dept-2026-08-17T234302Z`
- **Generado:** 2026-08-17T23:44:22.295Z

**Recordatorio de seguridad: este informe es PURA PLANIFICACION. Ningun plan de este fichero, este agente ni este pase de `growth:daily` ha escrito nada en WordPress produccion. Produccion sigue intacta.**

- Planes nuevos esta pasada: **0**
- Planes ya existentes (sin cambios): **0**
- Drafts de staging sin QA pass todavia (omitidos, no se les propone plan): **21**
- Omitidos por falta de revision visual humana (Fase O27.3 -- QA tecnico pasado no es lo mismo que listo para producción, ver src/core/visual-qa.ts): **0**
- Omitidos por ya existir un plan sin resolver para el mismo canonicalKey (Fase O27, evita duplicados por Telegram): **0**
- Omitidos por ya existir un plan sin resolver para la misma pagina real (Fase O27.2, otro change pack distinto sobre la misma URL): **0**
- Nuevas solicitudes de aprobacion: **0** (enviadas por Telegram: 0)
- Aprobaciones de PLAN esta pasada: 0 aprobados / 0 rechazados

**Recordatorio de semantica (Fase O13.1/O13.2):** "aprobar el plan" (`plan_approved`) NUNCA autoriza una escritura real -- solo confirma que el DISENO esta bien. La aprobacion de EJECUCION (segunda pregunta, distinta) y cualquier intento de escritura real son responsabilidad de `production-draft-executor.ts` (`npm run production:execute`), no de este agente.

## Todos los planes (22)

### [applied_to_production_draft] taquillas escolares (https://zentrylockers.com/taquillas-para-colegios/) — `prod-deploy-326ef325-d985-47ff-9836-bf556d2007a3`

- sourceDraftId (staging): `1959` — https://staging.zentrylockers.com/?page_id=1959
- targetPageId (produccion): 1960
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Escolares | Fabricante y venta directa - Zentry" | metaDescription="Taquillas Escolares: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: 1962
- approvalRequestId: 79b2732a-22b7-4613-a56b-3b6cbaa9fff5

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=1959
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Confirmar que las imagenes incluidas estan en formato WebP y con peso razonable (ver Visual QA, Fase O12.9).
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar explicitamente este plan (Telegram/chat) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `1959` (https://staging.zentrylockers.com/?page_id=1959), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [plan_ready_for_review] taquillas melamina (https://zentrylockers.com/taquillas-melamina-fenolico/) — `prod-deploy-12e7020e-ba7d-479e-af50-590ee316071b`

- sourceDraftId (staging): `2092` — https://staging.zentrylockers.com/?page_id=2092
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Melamina | Fabricante y venta directa - Zentry" | metaDescription="Taquillas Melamina: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2092
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2092` (https://staging.zentrylockers.com/?page_id=2092), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [plan_ready_for_review] cerraduras inteligentes para taquillas (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — `prod-deploy-5b43441f-902b-4c52-9ade-6e9a3820c603`

- sourceDraftId (staging): `2096` — https://staging.zentrylockers.com/?page_id=2096
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Cerraduras Inteligentes Para Taquillas: taquilla + cerradur…" | metaDescription="Cerraduras Inteligentes Para Taquillas con cerradura inteligente integrada. Solucion completa Zentry + Tukandado: mueble y tecnologia de apertura en un solo pr…"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2096
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2096` (https://staging.zentrylockers.com/?page_id=2096), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas melamina (https://zentrylockers.com/taquillas-melamina/) — `prod-deploy-4d5d1ffa-6cf5-4334-ae9f-68611e493023`

- sourceDraftId (staging): `2097` — https://staging.zentrylockers.com/?page_id=2097
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Melamina" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2097
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2097` (https://staging.zentrylockers.com/?page_id=2097), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas colegios (https://zentrylockers.com/taquillas-para-colegios/) — `prod-deploy-fde8bb5d-6570-4777-ac19-e4786130ecfc`

- sourceDraftId (staging): `2098` — https://staging.zentrylockers.com/?page_id=2098
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Colegios" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2098
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2098` (https://staging.zentrylockers.com/?page_id=2098), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquilla para el personal (https://zentrylockers.com/taquillas-para-empresas/) — `prod-deploy-423e12fb-0bba-436c-8f84-9b63364fd4bd`

- sourceDraftId (staging): `2099` — https://staging.zentrylockers.com/?page_id=2099
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquilla Para El Personal" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2099
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2099` (https://staging.zentrylockers.com/?page_id=2099), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas fenólicas en palencia (https://zentrylockers.com/taquillas-fenolicas/) — `prod-deploy-f0ca8c6c-9975-4b7b-8b58-5896e5f12d79`

- sourceDraftId (staging): `2100` — https://staging.zentrylockers.com/?page_id=2100
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Fenólicas En Palencia" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2100
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2100` (https://staging.zentrylockers.com/?page_id=2100), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] comprar taquillas — `prod-deploy-586680a1-ce7f-4cd1-b8c1-03c6c042ee4e`

- sourceDraftId (staging): `2101` — https://staging.zentrylockers.com/?page_id=2101
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Comprar Taquillas" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2101
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2101` (https://staging.zentrylockers.com/?page_id=2101), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] soluciones de taquillas — `prod-deploy-7287a503-d389-4357-990f-49498343c1a5`

- sourceDraftId (staging): `2102` — https://staging.zentrylockers.com/?page_id=2102
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Soluciones De Taquillas" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2102
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2102` (https://staging.zentrylockers.com/?page_id=2102), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] taquillas inteligentes — `prod-deploy-bbae0739-4234-47d5-924b-225dfb0e3452`

- sourceDraftId (staging): `2103` — https://staging.zentrylockers.com/?page_id=2103
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Inteligentes" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2103
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2103` (https://staging.zentrylockers.com/?page_id=2103), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] taquillas para vestuarios — `prod-deploy-8715c7d9-5574-438d-830b-2edb38f9a9a6`

- sourceDraftId (staging): `2104` — https://staging.zentrylockers.com/?page_id=2104
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Para Vestuarios" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2104
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2104` (https://staging.zentrylockers.com/?page_id=2104), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] metalicas taquillas — `prod-deploy-e7f369bc-3a00-43c8-a6fe-1d79d2091bd1`

- sourceDraftId (staging): `2105` — https://staging.zentrylockers.com/?page_id=2105
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Metalicas Taquillas" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2105
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2105` (https://staging.zentrylockers.com/?page_id=2105), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] fenolicas con perfil — `prod-deploy-59dd8f78-a82e-4aab-8834-7126039d90ea`

- sourceDraftId (staging): `2106` — https://staging.zentrylockers.com/?page_id=2106
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Fenolicas Con Perfil" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2106
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2106` (https://staging.zentrylockers.com/?page_id=2106), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] industrial — `prod-deploy-9502dbf9-faa4-49d4-ba05-609ca2ab1ed5`

- sourceDraftId (staging): `2107` — https://staging.zentrylockers.com/?page_id=2107
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Industrial" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2107
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2107` (https://staging.zentrylockers.com/?page_id=2107), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] oficina — `prod-deploy-edbc1b72-96c7-4b3c-9b98-356ee4a77e70`

- sourceDraftId (staging): `2108` — https://staging.zentrylockers.com/?page_id=2108
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Oficina" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2108
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2108` (https://staging.zentrylockers.com/?page_id=2108), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] colegio — `prod-deploy-8b85d024-bc40-4259-9211-8c068edcb35b`

- sourceDraftId (staging): `2109` — https://staging.zentrylockers.com/?page_id=2109
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Colegio" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2109
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2109` (https://staging.zentrylockers.com/?page_id=2109), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] universidad — `prod-deploy-eb11d4ba-0205-4ecb-8261-b5484d3e452d`

- sourceDraftId (staging): `2110` — https://staging.zentrylockers.com/?page_id=2110
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Universidad" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2110
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2110` (https://staging.zentrylockers.com/?page_id=2110), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [needs_revalidation] hotel — `prod-deploy-4651a9fc-7922-48c9-ac35-e7fff4345660`

- sourceDraftId (staging): `2111` — https://staging.zentrylockers.com/?page_id=2111
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Hotel" | metaDescription="(no generada por Content Planner — redactar manualmente antes de publicar)"
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2111
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2111` (https://staging.zentrylockers.com/?page_id=2111), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas melamina (https://zentrylockers.com/taquillas-melamina/) — `prod-deploy-aed5cbe3-3746-4ee7-b6d2-7ae57cb30295`

- sourceDraftId (staging): `2091` — https://staging.zentrylockers.com/?page_id=2091
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Melamina | Fabricante y venta directa - Zentry" | metaDescription="Taquillas Melamina: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2091
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2091` (https://staging.zentrylockers.com/?page_id=2091), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas colegios (https://zentrylockers.com/taquillas-para-colegios/) — `prod-deploy-f2cf576f-1c05-4dfe-8d92-9e173bc74bd5`

- sourceDraftId (staging): `2093` — https://staging.zentrylockers.com/?page_id=2093
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Colegios | Fabricante y venta directa - Zentry" | metaDescription="Taquillas Colegios: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2093
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2093` (https://staging.zentrylockers.com/?page_id=2093), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquilla para el personal (https://zentrylockers.com/taquillas-para-empresas/) — `prod-deploy-b9b6c9c6-77af-44e5-834a-0609fd973d60`

- sourceDraftId (staging): `2094` — https://staging.zentrylockers.com/?page_id=2094
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquilla Para El Personal | Fabricante y venta directa - Ze…" | metaDescription="Taquilla Para El Personal: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2094
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2094` (https://staging.zentrylockers.com/?page_id=2094), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

### [cancelled] taquillas fenólicas en palencia (https://zentrylockers.com/taquillas-fenolicas/) — `prod-deploy-79755187-8172-41fa-9582-7bdb20fbf2fb`

- sourceDraftId (staging): `2095` — https://staging.zentrylockers.com/?page_id=2095
- targetPageId (produccion): (ninguno todavia -- pagina nueva)
- deploymentType propuesto: `create_draft` (a confirmar manualmente, ver checklist)
- seoMeta: title="Taquillas Fenólicas En Palencia | Fabricante y venta direct…" | metaDescription="Taquillas Fenólicas En Palencia: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry."
- media incluida: (ninguna)
- approvalRequestId: (pendiente de crear)

**Checklist antes de produccion:**
- [ ] Revisar visualmente el draft en staging antes de nada: https://staging.zentrylockers.com/?page_id=2095
- [ ] Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.
- [ ] Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.
- [ ] Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.
- [ ] Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.
- [ ] Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.
- [ ] Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).
- [ ] Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.
- [ ] Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.
- [ ] Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.
- [ ] Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).
- [ ] Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.

**Riesgos:**
- Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).
- Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.
- El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.
- Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.
- El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.

**Plan de rollback:**
- Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.
- Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.
- Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.
- Snapshot de origen disponible: draft de staging `2095` (https://staging.zentrylockers.com/?page_id=2095), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.

## Confirmacion de seguridad

- Este agente es 100% planificacion: no existe ninguna llamada de escritura a WordPress produccion en todo el fichero.
- Tampoco escribe en staging -- solo lee ejecuciones ya aplicadas y resultados de QA ya generados/recalculados en memoria.
- Ni "plan_approved" NI "execution_approved" ejecutan nada por si solos -- no existe todavia ningun codigo en este proyecto que aplique un plan a produccion.
- Produccion no se ha tocado: este agente no conoce ninguna variable de produccion de WordPress ni le hace ninguna peticion.
