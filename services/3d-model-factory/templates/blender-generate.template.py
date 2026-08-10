"""
3D Model Factory -- PLANTILLA de script de generacion Blender (Agente 6).

ESTADO: plantilla/documentacion, NO funcional todavia. Blender no esta
instalado en el VPS de automatizacion en la Fase O24.1 (ver
docs/blender-setup.md) -- este fichero muestra la ESTRUCTURA prevista para
cuando la Fase O24.2 implemente la generacion real, no se debe ejecutar tal
cual.

Cuando exista de verdad, un script como este se generaria automaticamente
(no se escribiria a mano por producto) a partir de:
  - clients/<client_id>/outputs/3d-models/<slug>/stages/geometry-plan.json
  - clients/<client_id>/outputs/3d-models/<slug>/stages/inference-manifest.json
  - la resolucion de materiales de src/lib/materials.ts (via un pequeno
    puente Node->Python, ej. volcando los presets resueltos a un JSON que
    este script lee)

Uso previsto (O24.2+), headless, sin interfaz:
  blender --background --python blender-generate.py -- --plan geometry-plan.json --out salida.glb
"""

import bpy
import json
import sys


def load_geometry_plan(path):
	"""Carga el plan de componentes generado por el Geometry Planner Agent (Agente 4)."""
	with open(path, "r", encoding="utf-8") as f:
		return json.load(f)


def clear_scene():
	"""Empieza de una escena vacia -- nunca reutiliza objetos de una ejecucion anterior."""
	bpy.ops.object.select_all(action="SELECT")
	bpy.ops.object.delete(use_global=False)


def build_component(component, dimensions):
	"""
	PLACEHOLDER -- aqui iria la logica real de construccion parametrica por
	tipo de componente (asiento, pata, perchero, zapatero, puerta,
	cerradura...). Cada tipo tendria su propia funcion de construccion,
	analoga a buildLegGroup()/buildBenchGroup() ya escritas en JS para el
	prototipo de O23 (assets/js/configurator.js del plugin
	zentry-3d-configurator) -- la idea es portar esa MISMA logica de
	proporciones a bpy, no reinventarla.
	"""
	name = component.get("name", "componente_sin_nombre")
	# bpy.ops.mesh.primitive_cube_add(...) / primitive_cylinder_add(...) etc,
	# segun el tipo de pieza -- pendiente de implementar en O24.2.
	raise NotImplementedError(f"build_component() todavia no implementado para '{name}' -- plantilla, Fase O24.2.")


def assign_materials(obj, material_name, material_presets):
	"""Aplica un material Principled BSDF usando los valores resueltos por src/lib/materials.ts (color base + roughness/metalness)."""
	preset = material_presets.get(material_name)
	if preset is None:
		print(f"AVISO: material '{material_name}' sin preset conocido -- se dejaria un material neutro marcado como supuesto en el manifest.")
		return
	# mat = bpy.data.materials.new(name=material_name)
	# mat.use_nodes = True
	# principled = mat.node_tree.nodes["Principled BSDF"]
	# principled.inputs["Base Color"].default_value = hex_to_rgba(preset["baseColorHex"])
	# principled.inputs["Roughness"].default_value = preset["roughness"]
	# principled.inputs["Metallic"].default_value = preset["metalness"]
	# obj.data.materials.append(mat)
	raise NotImplementedError("assign_materials() todavia no implementado -- plantilla, Fase O24.2.")


def export_glb(output_path):
	"""
	Export final -- criterios tecnicos obligatorios (ver docs/architecture.md):
	escala en metros, pivote centrado en la base (Z=0 del objeto = suelo),
	orientacion +Y arriba al exportar a glTF, nodos con nombres legibles
	(heredados directamente de component['name'] del plan de geometria).
	"""
	# bpy.ops.export_scene.gltf(
	#     filepath=output_path,
	#     export_format='GLB',
	#     export_apply=True,
	#     export_yup=True,
	# )
	raise NotImplementedError("export_glb() todavia no implementado -- plantilla, Fase O24.2.")


def main():
	argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
	# parseo real de --plan/--out pendiente, plantilla por ahora.
	print("Plantilla blender-generate.py -- no funcional todavia. Ver docs/blender-setup.md y docs/pipeline.md.")


if __name__ == "__main__":
	main()
