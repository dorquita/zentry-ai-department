# Production Deployment Planner — 2026-08-10

- **departmentRunId:** `growth-department-2026-08-10T125242Z`
- **Generado:** 2026-08-10T12:52:59.054Z

**Recordatorio de seguridad: este informe es PURA PLANIFICACION. Ningun plan de este fichero, este agente ni este pase de `growth:daily` ha escrito nada en WordPress produccion. Produccion sigue intacta.**

- Planes nuevos esta pasada: **0**
- Planes ya existentes (sin cambios): **5**
- Drafts de staging sin QA pass todavia (omitidos, no se les propone plan): **1**
- Omitidos por ya existir un plan sin resolver para el mismo canonicalKey (Fase O27, evita duplicados por Telegram): **0**
- Nuevas solicitudes de aprobacion: **0** (enviadas por Telegram: 0)
- Aprobaciones de PLAN esta pasada: 0 aprobados / 0 rechazados

**Recordatorio de semantica (Fase O13.1/O13.2):** "aprobar el plan" (`plan_approved`) NUNCA autoriza una escritura real -- solo confirma que el DISENO esta bien. La aprobacion de EJECUCION (segunda pregunta, distinta) y cualquier intento de escritura real son responsabilidad de `production-draft-executor.ts` (`npm run production:execute`), no de este agente.

## Todos los planes (6)

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

### [plan_ready_for_review] taquillas melamina (https://zentrylockers.com/taquillas-melamina/) — `prod-deploy-aed5cbe3-3746-4ee7-b6d2-7ae57cb30295`

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

### [plan_ready_for_review] taquillas colegios (https://zentrylockers.com/taquillas-para-colegios/) — `prod-deploy-f2cf576f-1c05-4dfe-8d92-9e173bc74bd5`

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

### [plan_ready_for_review] taquilla para el personal (https://zentrylockers.com/taquillas-para-empresas/) — `prod-deploy-b9b6c9c6-77af-44e5-834a-0609fd973d60`

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

### [plan_ready_for_review] taquillas fenólicas en palencia (https://zentrylockers.com/taquillas-fenolicas/) — `prod-deploy-79755187-8172-41fa-9582-7bdb20fbf2fb`

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
