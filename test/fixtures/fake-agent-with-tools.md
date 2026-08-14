---
name: fake-agent-with-tools
description: Fixture usada UNICAMENTE por test/subagent-tool-guard.test.ts para verificar que checkSubagentIsToolless() detecta un frontmatter tools: no vacio como inconsistencia. No es un subagente real, no lo referencies desde ningun runner.
tools: Bash, Read
model: sonnet
---

Fixture de test. Este fichero no define ningun subagente real -- existe
solo para que el guard tenga algo inconsistente que detectar.
