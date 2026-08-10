# 3D Model Factory — Integración con la estructura multi-cliente

## Convención de carpetas

```
clients/<client_id>/
  input/o24-products/<product_slug>/    -- material de partida aportado para ESE producto
  outputs/3d-models/<product_slug>/     -- todo lo que genera la factory para ESE producto
```

`<client_id>` debe ser un cliente real ya existente en `clients/<client_id>/client.config.json` (el mismo sistema multi-cliente de las Fases O16.x) — la factory no crea clientes nuevos por su cuenta, solo lee/escribe dentro de la carpeta de un cliente que ya existe.

## Estado real de clientes en esta fase (verificado, 2026-08-09)

| client_id | Existe como cliente real | Carpetas O24 creadas en O24.1 |
|---|---|---|
| `zentry` | Sí (`clients/zentry/client.config.json`, marca principal + `Tukandado` como `secondaryBrands`) | Sí — piloto real (`banco-vestuario-pino`) |
| `demo` | Sí (`isSandbox: true`, sin credenciales reales — pensado exactamente para probar estructura sin riesgo) | Sí — carpeta vacía, lista para un producto de prueba futuro |
| `tukandado` | **No existe como `client_id` propio todavía** — hoy Tukandado es una `secondaryBrand` dentro de `clients/zentry/client.config.json`, no un cliente independiente | **No creada en O24.1** — ver nota abajo |
| clientes externos futuros | No existen todavía | No aplicable todavía |

### Nota sobre Tukandado

El encargo de O24 lista Tukandado como uno de los clientes objetivo de la arquitectura, y el árbol de carpetas propuesto en el encargo incluye `clients/tukandado/`. Sin embargo, el sistema multi-cliente real de este departamento (Fase O16) trata Tukandado como una **marca secundaria de Zentry**, no como un `client_id` independiente — no existe `clients/tukandado/client.config.json` en ningún sitio del proyecto.

Crear una carpeta `clients/tukandado/` para O24 sin que exista ese cliente en el resto del sistema generaría una inconsistencia (una carpeta de un "cliente" que no existe en ningún otro sitio del departamento). **No se ha creado en O24.1** — si en el futuro Tukandado pasa a ser su propio `client_id` (decisión de negocio, no técnica, fuera de alcance de O24), la misma convención de carpetas (`clients/tukandado/input/o24-products/`, `clients/tukandado/outputs/3d-models/`) se aplicaría sin cambios en el código de la factory. Mientras tanto, un producto de Tukandado (ej. una cerradura) se modelaría bajo `client_id: "zentry"` con un `project_id` distinto (ej. `"tukandado"`), reflejando la relación real ya existente en `client.config.json`.

## Cómo se relaciona con el resto del departamento

La factory **no lee ni escribe** ningún fichero de configuración multi-cliente existente (`brand-positioning.json`, `wordpress.json`, credenciales, etc.) — su único contrato con el resto del sistema es la convención de carpetas de arriba. Esto es deliberado: permite que este módulo se copie a otro repo/departamento sin arrastrar nada específico de WordPress/Zentry, cumpliendo el requisito de "módulo independiente, no acoplado a WordPress ni solo a zentrylockers.com".

## Añadir un cliente nuevo

1. Confirmar que existe `clients/<client_id>/client.config.json` (fuera de alcance de esta factory, es responsabilidad del sistema multi-cliente general).
2. Crear `clients/<client_id>/input/o24-products/` y `clients/<client_id>/outputs/3d-models/` (pueden crearse vacías, o el propio `run-pipeline.ts` crea `outputs/3d-models/<product_slug>/` automáticamente en su primera ejecución para ese producto).
3. No hace falta ningún registro adicional — la factory no mantiene una lista central de clientes, cada ejecución es independiente y autocontenida por `client_id` + `product_slug`.
