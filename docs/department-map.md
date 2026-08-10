# Mapa de departamentos

Vision completa del "departamento IA" de Zentry/Tukandado. Solo el primero
esta implementado hoy; el resto son la hoja de ruta.

| Departamento | Estado | Descripcion |
|---|---|---|
| **Direccion IA** | No implementado | Agente Director: coordina departamentos y agentes, prioriza, centraliza aprobaciones y reporta. |
| **Web & Growth** | **Activo** (`departments/web-growth/`) | SEO, SEM, WordPress, GA4, GTM, CRO, diseno web. Primer agente: SEO Watcher. |
| **Prospeccion** | No implementado | Deteccion y cualificacion de leads/prospectos. |
| **Comercial/Ventas** | No implementado | Seguimiento de oportunidades, propuestas, cierre. |
| **CRM/RevOps** | No implementado | Higiene de datos de CRM, automatizacion de procesos de ingresos. |
| **Producto** | No implementado | Roadmap, feedback de clientes, especificaciones. |
| **Operaciones** | No implementado | Gestion de proyectos internos, seguimiento operativo. |
| **Proveedores/Compras** | No implementado | Gestion de proveedores, pedidos, condiciones comerciales. |
| **Logistica/Stock** | No implementado | Inventario, envios, disponibilidad de producto. |
| **Soporte** | No implementado | Atencion al cliente, tickets, FAQs. |
| **Finanzas** | No implementado | Facturacion, cobros, control de gasto. |
| **Legal** | No implementado | Contratos, cumplimiento normativo, RGPD. |
| **BI/Reporting** | No implementado | Cuadros de mando, metricas cruzadas entre departamentos. |
| **QA/Safety** | No implementado | Supervision de que todos los agentes cumplen su politica de riesgo/aprobacion. |

## Orden de implementacion sugerido (no vinculante)

1. Web & Growth (SEO Watcher — hecho)
2. Web & Growth (SEM Watcher, GA4/GTM Auditor)
3. CRM/RevOps (higiene de datos, ya hay automatizaciones en n8n/HubSpot
   para Zentry/Tukandado)
4. Prospeccion / Comercial
5. Agente Director (una vez haya >=2-3 departamentos con agentes reales
   que coordinar)
6. Resto de departamentos, segun prioridad de negocio
