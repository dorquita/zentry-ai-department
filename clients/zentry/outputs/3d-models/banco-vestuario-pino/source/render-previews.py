"""
3D Model Factory -- Agente 10 (Visual QA), generacion de previews reales
para banco-vestuario-pino (Fase O24.2). Importa el .glb ya exportado,
monta 3 camaras (frontal/lateral/perspectiva) apuntando al centro del
modelo via constraint Track To, ilumina con un rig simple (sun + fondo
gris claro) y renderiza con Cycles en CPU (sin GPU en este VPS).

Uso:
  blender -b --python render-previews.py -- --glb banco-vestuario-pino.glb --outdir previews
"""

import bpy
import sys
import os
import mathutils

RESOLUTION = (900, 675)
SAMPLES = 64


def parse_args():
	argv = sys.argv
	argv = argv[argv.index("--") + 1 :] if "--" in argv else []
	args = {}
	for i, a in enumerate(argv):
		if a.startswith("--") and i + 1 < len(argv):
			args[a[2:]] = argv[i + 1]
	return args


def import_glb(glb_path):
	bpy.ops.object.select_all(action="SELECT")
	bpy.ops.object.delete(use_global=False)
	bpy.ops.import_scene.gltf(filepath=glb_path)


def compute_bounds():
	min_co = mathutils.Vector((float("inf"),) * 3)
	max_co = mathutils.Vector((float("-inf"),) * 3)
	for obj in bpy.context.scene.objects:
		if obj.type != "MESH":
			continue
		for corner in obj.bound_box:
			world_co = obj.matrix_world @ mathutils.Vector(corner)
			min_co = mathutils.Vector(min(a, b) for a, b in zip(min_co, world_co))
			max_co = mathutils.Vector(max(a, b) for a, b in zip(max_co, world_co))
	center = (min_co + max_co) / 2
	size = max_co - min_co
	return center, size


def add_target(center):
	bpy.ops.object.empty_add(type="PLAIN_AXES", location=center)
	target = bpy.context.active_object
	target.name = "camera_target"
	return target


def add_camera(name, location, target):
	cam_data = bpy.data.cameras.new(name)
	cam_data.lens = 50
	cam_obj = bpy.data.objects.new(name, cam_data)
	bpy.context.collection.objects.link(cam_obj)
	cam_obj.location = location
	constraint = cam_obj.constraints.new(type="TRACK_TO")
	constraint.target = target
	constraint.track_axis = "TRACK_NEGATIVE_Z"
	constraint.up_axis = "UP_Y"
	return cam_obj


def setup_lighting():
	sun_data = bpy.data.lights.new(name="key_sun", type="SUN")
	sun_data.energy = 3.0
	sun_data.angle = 0.2
	sun_obj = bpy.data.objects.new("key_sun", sun_data)
	bpy.context.collection.objects.link(sun_obj)
	sun_obj.location = (2, -3, 4)
	sun_obj.rotation_euler = (0.9, 0.0, 0.5)

	world = bpy.context.scene.world
	if world is None:
		world = bpy.data.worlds.new("World")
		bpy.context.scene.world = world
	world.use_nodes = True
	bg = world.node_tree.nodes.get("Background")
	if bg:
		bg.inputs[0].default_value = (0.94, 0.94, 0.93, 1.0)
		bg.inputs[1].default_value = 1.0


def setup_render():
	scene = bpy.context.scene
	scene.render.engine = "CYCLES"
	scene.cycles.device = "CPU"
	scene.cycles.samples = SAMPLES
	scene.render.resolution_x = RESOLUTION[0]
	scene.render.resolution_y = RESOLUTION[1]
	scene.render.image_settings.file_format = "PNG"


def render_view(camera, output_path):
	bpy.context.scene.camera = camera
	bpy.context.scene.render.filepath = output_path
	bpy.ops.render.render(write_still=True)


def main():
	args = parse_args()
	glb_path = args.get("glb")
	outdir = args.get("outdir", "previews")
	if not glb_path:
		raise SystemExit("Uso: --glb <ruta.glb> --outdir <carpeta>")
	os.makedirs(outdir, exist_ok=True)

	import_glb(glb_path)
	center, size = compute_bounds()
	target = add_target(center)
	setup_lighting()
	setup_render()

	# Distancia de camara proporcional al tamano del modelo, con margen.
	max_dim = max(size.x, size.y, size.z)
	dist = max_dim * 1.6 + 0.5

	cam_front = add_camera("cam_front", (center.x, center.y - dist, center.z + size.z * 0.15), target)
	cam_side = add_camera("cam_side", (center.x + dist, center.y, center.z + size.z * 0.15), target)
	cam_persp = add_camera(
		"cam_perspective",
		(center.x + dist * 0.75, center.y - dist * 0.75, center.z + dist * 0.55),
		target,
	)

	render_view(cam_front, os.path.join(outdir, "front.png"))
	render_view(cam_side, os.path.join(outdir, "side.png"))
	render_view(cam_persp, os.path.join(outdir, "perspective.png"))

	print(f"Previews generados en {outdir}: front.png, side.png, perspective.png")


if __name__ == "__main__":
	main()
