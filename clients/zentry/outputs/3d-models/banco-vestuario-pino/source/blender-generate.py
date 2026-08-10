"""
3D Model Factory -- script de generacion REAL para banco-vestuario-pino
(Fase O24.2). Construye la geometria a partir de:
  - clients/zentry/outputs/3d-models/banco-vestuario-pino/stages/geometry-plan.json (componentes/nodos)
  - clients/zentry/outputs/3d-models/banco-vestuario-pino/stages/inference-manifest.json (medidas verificadas/inferidas)
  - services/3d-model-factory/src/lib/materials.ts (presets de color/roughness/metalness, portados a mano aqui)

Medidas (metros, longitud por defecto 1500mm -- variante configurable en
fases futuras, no en este MVP):
  LENGTH=1.5 (verificado, ficha WooCommerce), SEAT_HEIGHT=0.45 (INFERIDO),
  SEAT_DEPTH=0.30 (INFERIDO), SLAT_THICKNESS=0.025 (VERIFICADO),
  LEG_SECTION=0.03 (VERIFICADO, seccion cuadrada -- ver conflicto
  documentado en stages/product-understanding.json sobre la imagen de
  referencia que muestra patas redondas).

Uso (headless):
  blender -b --python blender-generate.py -- --out banco-vestuario-pino.glb
"""

import bpy
import sys

LENGTH = 1.5
SEAT_HEIGHT = 0.45
SEAT_DEPTH = 0.30
SLAT_THICKNESS = 0.025
SLAT_COUNT = 4
SLAT_GAP = 0.006
LEG_SECTION = 0.03
LEG_INSET = 0.08
REINFORCEMENT_HEIGHT = 0.08
REINFORCEMENT_SECTION = 0.02

MATERIAL_PRESETS = {
	"pino": {"color": "#c9a06a", "roughness": 0.75, "metalness": 0.0},
	"metal": {"color": "#6b7178", "roughness": 0.35, "metalness": 0.75},
}


def srgb_to_linear(c):
	c = c / 255.0
	if c <= 0.04045:
		return c / 12.92
	return ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_color):
	hex_color = hex_color.lstrip("#")
	r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
	return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def make_material(name, preset_key):
	preset = MATERIAL_PRESETS[preset_key]
	mat = bpy.data.materials.new(name=name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(preset["color"])
	bsdf.inputs["Roughness"].default_value = preset["roughness"]
	if "Metallic" in bsdf.inputs:
		bsdf.inputs["Metallic"].default_value = preset["metalness"]
	return mat


def clear_scene():
	bpy.ops.object.select_all(action="SELECT")
	bpy.ops.object.delete(use_global=False)
	for block in list(bpy.data.meshes):
		if block.users == 0:
			bpy.data.meshes.remove(block)


def add_box(name, size_x, size_y, size_z, loc, material=None):
	# primitive_cube_add(size=1) crea un cubo de 1x1x1 (extents -0.5..0.5),
	# NO de 2x2x2 -- la escala final debe ser size_x/size_y/size_z
	# directamente, sin dividir entre 2 otra vez (bug real encontrado en
	# el propio QA: todas las dimensiones salian exactamente a mitad de
	# lo esperado hasta corregir esto).
	bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
	obj = bpy.context.active_object
	obj.name = name
	obj.data.name = name + "_mesh"
	obj.scale = (size_x, size_y, size_z)
	bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
	if material:
		obj.data.materials.append(material)
	return obj


def build_bench():
	mat_pino = make_material("pino", "pino")
	mat_metal = make_material("metal", "metal")

	# Grupo "asiento" -- Empty padre para poder escalar la longitud del
	# conjunto de listones como un unico nodo (igual que seatGroup en el
	# prototipo JS de O23, assets/js/configurator.js).
	bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, SEAT_HEIGHT))
	asiento = bpy.context.active_object
	asiento.name = "asiento"
	asiento.empty_display_size = 0.05

	slat_width = (SEAT_DEPTH - (SLAT_COUNT - 1) * SLAT_GAP) / SLAT_COUNT
	start_y = -SEAT_DEPTH / 2 + slat_width / 2
	for i in range(SLAT_COUNT):
		y = start_y + i * (slat_width + SLAT_GAP)
		slat = add_box(
			f"asiento_liston_{i + 1}",
			LENGTH,
			slat_width,
			SLAT_THICKNESS,
			(0, y, SEAT_HEIGHT - SLAT_THICKNESS / 2),
			material=mat_pino,
		)
		slat.parent = asiento
		slat.matrix_parent_inverse = asiento.matrix_world.inverted()

	leg_x = LENGTH / 2 - LEG_INSET
	leg_height = SEAT_HEIGHT - SLAT_THICKNESS
	add_box("pata_izquierda", LEG_SECTION, LEG_SECTION, leg_height, (-leg_x, 0, leg_height / 2), material=mat_metal)
	add_box("pata_derecha", LEG_SECTION, LEG_SECTION, leg_height, (leg_x, 0, leg_height / 2), material=mat_metal)

	reinforcement_length = LENGTH - 2 * LEG_INSET + LEG_SECTION
	add_box(
		"refuerzo_metalico",
		reinforcement_length,
		REINFORCEMENT_SECTION,
		REINFORCEMENT_SECTION,
		(0, 0, REINFORCEMENT_HEIGHT),
		material=mat_metal,
	)


def export_glb(output_path):
	bpy.ops.object.select_all(action="SELECT")
	bpy.ops.export_scene.gltf(
		filepath=output_path,
		export_format="GLB",
		use_selection=False,
		export_apply=True,
		export_yup=True,
	)


def main():
	argv = sys.argv
	if "--" in argv:
		argv = argv[argv.index("--") + 1 :]
	else:
		argv = []
	out_path = None
	for i, a in enumerate(argv):
		if a == "--out" and i + 1 < len(argv):
			out_path = argv[i + 1]
	if not out_path:
		raise SystemExit("Uso: blender -b --python blender-generate.py -- --out <ruta.glb>")

	clear_scene()
	build_bench()
	export_glb(out_path)
	print(f"GLB exportado: {out_path}")


if __name__ == "__main__":
	main()
