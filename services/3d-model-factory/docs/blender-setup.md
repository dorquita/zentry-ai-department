# 3D Model Factory — Instalación de Blender (EJECUTADA en O24.2)

**Estado: instalado y verificado el 2026-08-09 (Fase O24.2), con aprobación explícita previa.** Este documento originalmente era una propuesta (Fase O24.1); se actualiza aquí con lo que se hizo realmente, incluidas 2 correcciones sobre el plan original.

## Versión instalada

**Blender 5.2.0 LTS** (no 4.5 LTS como se documentó como suposición en O24.1 — al verificar en el momento de instalar, 5.2 ya era la LTS vigente, publicada el 14 de julio de 2026, con soporte hasta julio de 2028; 4.5 LTS sigue mantenida hasta julio de 2027 pero ya no es la recomendada para una instalación nueva).

## Instalación realizada

1. Descargado el tarball oficial `blender-5.2.0-linux-x64.tar.xz` (367 MB) desde `download.blender.org/release/Blender5.2/`.
2. **Checksum SHA256 verificado** contra el manifest oficial `blender-5.2.0.sha256` antes de extraer nada — `OK`.
3. Extraído a `/opt/blender-5.2.0/`, symlink `/usr/local/bin/blender → /opt/blender-5.2.0/blender`.
4. Instaladas vía `apt` las librerías necesarias en tiempo de ejecución.

## Corrección sobre el plan original: hicieron falta más librerías de las previstas

El plan de O24.1 preveía 6 librerías X11. En la práctica, `blender --version` falló dos veces más tras instalar esas 6, señalando dependencias adicionales no previstas:

- `libSM.so.6` (Session Management) → resuelto instalando `libsm6` (que a su vez trae `libice6`, `x11-common`).
- `libGL.so.1` (OpenGL) → resuelto instalando `libgl1`, que en Ubuntu 24.04 arrastra automáticamente el stack Mesa completo de software rendering (`libgl1-mesa-dri`, `libglx-mesa0`, `mesa-libgallium`, etc. — unos 19 paquetes transitivos en total).

**Lista final de paquetes instalados vía apt:** `libxi6 libxrender1 libxrandr2 libxinerama1 libxcursor1 libxxf86vm1 libsm6 libgl1` (+ dependencias transitivas de `libgl1`, todas parte del stack estándar de Mesa/X11 de Ubuntu, ninguna de escritorio completo).

**Efecto secundario positivo:** al traer Mesa DRI software rendering (`llvmpipe`) como dependencia transitiva de `libgl1`, quedó disponible de fábrica el contexto OpenGL por software que en el plan original se preveía como un "plan B" aparte (Xvfb + Mesa) solo si Cycles no bastaba — no hizo falta ese paso adicional.

## Verificado

- `blender --version` → `Blender 5.2.0 LTS`.
- `blender -b --python-expr "import bpy; print(bpy.app.version_string)"` → `5.2.0 LTS`, sale limpio ("Blender quit", sin errores).
- Export real de `.glb` desde script Python (`bpy.ops.export_scene.gltf`) funcionando (ver `clients/zentry/outputs/3d-models/banco-vestuario-pino/`).
- Render real con Cycles-CPU funcionando en background, sin necesidad de Xvfb (ver mismo directorio, `previews/`).

## Recursos reales tras la instalación

- Footprint en disco: 1.2 GB (`/opt/blender-5.2.0/`) + ~20 MB de librerías apt.
- Disco libre tras instalar: 88 GB de 96 GB.
- `docker ps` confirmado sin cambios — n8n y qdrant no se reiniciaron ni se vieron afectados (`apt` difirió sus reinicios de servicio, ninguno de los dos contenedores estaba en esa lista).

## Rollback

```
rm -rf /opt/blender-5.2.0 /usr/local/bin/blender
apt remove libxi6 libxrender1 libxrandr2 libxinerama1 libxcursor1 libxxf86vm1 libsm6 libgl1
```
No afecta a ningún otro servicio del VPS (n8n/qdrant no dependen de ninguna de estas librerías).
