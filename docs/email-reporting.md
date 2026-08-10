# Informe diario por email

## Que hace

`npm run seo:daily` (`scripts/run-daily-seo-report.ts`) ejecuta el SEO
Watcher Agent exactamente igual que `npm run seo:watch`, y ademas:

1. Obliga a que la fuente de datos sea `SEO_DATA_SOURCE=search_console`
   (falla claro si no lo es — el informe diario nunca debe basarse en
   datos de ejemplo).
2. Detecta el informe markdown mas reciente en `reports/seo/` (no se fia
   solo del valor devuelto en memoria; vuelve a escanear el directorio).
3. Construye un resumen corto (asunto + texto + HTML simple) con el
   `runId`, filas leidas, numero de oportunidades por prioridad, el top 5
   y la ruta local del informe completo.
4. Envia ese resumen por email via SMTP (`src/core/mailer.ts`, usando
   `nodemailer`).
5. Registra la ejecucion en `logs/` (mismo logger que el resto del
   agente, con la misma redaccion de secretos).

No hace nada mas: no publica, no modifica WordPress/Ads/GA4/GTM/n8n, no
ejecuta ninguna accion SEO real. El email es un resumen de solo lectura.

## Variables de entorno requeridas

Ver `.env.example`, seccion "Email resumen diario":

```
REPORT_EMAIL_TO=
REPORT_EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=      # "true" o "false" (string)
SMTP_USER=
SMTP_PASS=
```

Si falta o esta vacia cualquiera de estas, `npm run seo:daily` falla con
un error claro **antes** de intentar conectar a ningun servidor SMTP.
`SMTP_PASS` nunca se imprime en consola ni en logs (el logger la redacta
automaticamente por nombre de campo, y `src/core/mailer.ts` ademas
sanea cualquier mensaje de error de SMTP que pudiera incluirla).

## Probar solo el email (sin re-analizar SEO)

No existe hoy un script separado para "solo reenviar el ultimo informe
por email" — cada ejecucion de `seo:daily` vuelve a analizar Search
Console. Si se necesita en el futuro, seria un script pequeno que reuse
`sendReportEmail()` de `src/core/mailer.ts` con el `reports/seo/*.md`
mas reciente, sin llamar a `runSeoWatcher()`.

## Errores comunes

- **`Falta la variable de entorno SMTP_...`**: revisa `.env` en el
  servidor (`/opt/zentry-ai-department/.env`), nunca `.env.example`.
- **`SMTP_SECURE invalido`**: debe ser exactamente `true` o `false`
  (texto), no `1`/`0` ni vacio.
- **`Envio de email fallo: ...`**: error real del servidor SMTP
  (credenciales, puerto, TLS). El mensaje se muestra saneado (sin la
  contrasena) tanto en consola como en `logs/`.
- **`El informe diario por email requiere SEO_DATA_SOURCE=search_console`**:
  revisa esa variable en `.env` — `seo:daily` rehusa correr contra datos
  mock.
