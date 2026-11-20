"""Ringside Booker 3D app icon: a stylised wrestling ring, rendered in Blender (Cycles).

Run headless (paths are Windows paths when Blender is the Windows build):

    blender.exe -b -P ring_icon.py -- --variant A --out C:\\path\\ring-A-1024.png
    blender.exe -b -P ring_icon.py -- --variant B --small --size 512 --out ...\\ring-B-small.png

Options (after the `--`):
    --variant A|B|C   A: ring only, "RB" mark on the canvas (3/4 high angle).
                      B: ring with a "RINGSIDE BOOKER" apron (the navy tile is added by
                         build_ring_icons.py, so the render itself stays transparent).
                      C: close, lower angle on one corner post and its ropes, "RB" on the canvas.
    --small           The 16-32 px version: seen straight on from the front and high, two thick
                      ropes, one tall pad per post, no apron text and a bigger "RB" mark.
    --size N          Output size in pixels (square). Default 1024.
    --samples N       Cycles samples. Default 128 (denoised).
    --out PATH        PNG to write (RGBA, transparent background).
    --blend PATH      Also save the scene as a .blend.

Colours are the UNITY-11 design tokens (game/Assets/UI/Design/DsTokens.uss): navy elevations
#080c15..#1f2d4b, line-strong #34476a, text #f1f5f9, action red #d7301a / #ff3b1d. The lettering is
Barlow Condensed ExtraBold (SIL OFL 1.1, game/Assets/UI/Fonts). The design is original to this
game: a skewed red "RB" plate (the sidebar mark) on a pale canvas, a navy apron with a red band.
"""

import math
import os
import sys
import time

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.normpath(
    os.path.join(HERE, "..", "..", "Assets", "UI", "Fonts", "BarlowCondensed-ExtraBold.ttf")
)

# UNITY-11 tokens.
NAVY_0 = "#080c15"
NAVY_2 = "#131d33"
NAVY_3 = "#19253f"
NAVY_4 = "#1f2d4b"
LINE_STRONG = "#34476a"
TEXT = "#f1f5f9"
TEXT_2 = "#b6c2d4"
RED = "#d7301a"
RED_HOT = "#ff3b1d"


# ---------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = {"variant": "A", "small": False, "size": 1024, "samples": 128, "out": None, "blend": None}
    i = 0
    while i < len(argv):
        key = argv[i]
        if key == "--small":
            opts["small"] = True
        elif key in ("--variant", "--size", "--samples", "--out", "--blend"):
            i += 1
            opts[key[2:]] = argv[i]
        else:
            raise SystemExit(f"ring_icon.py: unknown option {key}")
        i += 1
    opts["variant"] = opts["variant"].upper()
    if opts["variant"] not in ("A", "B", "C"):
        raise SystemExit("ring_icon.py: --variant must be A, B or C")
    opts["size"] = int(opts["size"])
    opts["samples"] = int(opts["samples"])
    if not opts["out"]:
        opts["out"] = os.path.join(HERE, f"ring-{opts['variant']}{'-small' if opts['small'] else ''}.png")
    return opts


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------
def srgb_to_linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def rgba(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(srgb_to_linear(int(h[k : k + 2], 16) / 255.0) for k in (0, 2, 4)) + (1.0,)


def material(name, colour, roughness=0.5, metallic=0.0, coat=0.0, emission=0.0, specular=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = rgba(colour)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(name, size, location, mat, bevel=0.0, segments=3):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = location
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "NONE"
        for poly in mesh.polygons:
            poly.use_smooth = True
        mod.harden_normals = True
    return obj


def cylinder(name, start, end, radius, mat, verts=32):
    start, end = Vector(start), Vector(end)
    axis = end - start
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=verts, radius1=radius, radius2=radius, depth=axis.length
    )
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = (start + end) / 2
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    obj.data.materials.append(mat)
    return obj


def polygon(name, points, z, mat, rotation_z=0.0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, y, 0) for x, y in points], [], [list(range(len(points)))])
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = (0, 0, z)
    obj.rotation_euler = (0, 0, rotation_z)
    obj.data.materials.append(mat)
    solid = obj.modifiers.new("Solid", "SOLIDIFY")
    solid.thickness = 0.012
    solid.offset = 1.0
    return obj


_font = None


def text(name, body, size, mat, location, rotation, shear=0.0, extrude=0.004, spacing=1.0):
    global _font
    if _font is None:
        _font = bpy.data.fonts.load(FONT)
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.font = _font
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = extrude
    curve.shear = shear
    curve.space_character = spacing
    curve.resolution_u = 24
    obj = link(bpy.data.objects.new(name, curve))
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area_light(name, location, target, power, size, colour="#ffffff"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.size = size
    data.color = rgba(colour)[:3]
    obj = link(bpy.data.objects.new(name, data))
    obj.location = location
    look_at(obj, target)
    return obj


# ---------------------------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------------------------
RING = 2.0  # post centres at (+-RING, +-RING)
DECK = 2.3  # half-width of the ring deck (canvas + apron)
APRON_DROP = 0.85


def build_ring(variant, small, view):
    mats = {
        "canvas": material("Canvas", "#e6eaf1", roughness=0.9, specular=0.2),
        "canvas_edge": material("CanvasEdge", NAVY_3, roughness=0.6),
        "apron": material("Apron", NAVY_4, roughness=0.65),
        "band": material("Band", RED, roughness=0.45, coat=0.2),
        "post": material("Post", LINE_STRONG, roughness=0.3, metallic=0.85),
        "pad": material("Pad", RED, roughness=0.35, coat=0.35),
        "rope": material("Rope", TEXT, roughness=0.45),
        "rope_red": material("RopeRed", RED_HOT, roughness=0.4),
        "plate": material("Plate", RED, roughness=0.7, specular=0.15),
        "plate_edge": material("PlateEdge", RED_HOT, roughness=0.6, specular=0.2),
        "letters": material("Letters", "#ffffff", roughness=0.5),
        "apron_text": material("ApronText", TEXT, roughness=0.5, emission=0.1),
    }

    # Deck: navy apron block, red band under the canvas, the canvas slab on top.
    drop = APRON_DROP * (0.75 if small else 1.0)
    box("Apron", (DECK * 2, DECK * 2, drop), (0, 0, -drop / 2 - 0.02), mats["apron"], bevel=0.03)
    band_h = 0.16 if small else 0.11
    box("Band", (DECK * 2 + 0.03, DECK * 2 + 0.03, band_h), (0, 0, -0.02 - band_h / 2 - 0.03), mats["band"], bevel=0.015)
    box("Canvas", (DECK * 2 + 0.06, DECK * 2 + 0.06, 0.08), (0, 0, -0.01), mats["canvas"], bevel=0.035)
    # A navy line round the canvas, inside the ropes, so the mat reads as a ring and not a table.
    inset = RING - 0.12
    edge_w = 0.09 if small else 0.05
    for sx, sy, w, d in (
        (0, inset, inset * 2 + edge_w, edge_w),
        (0, -inset, inset * 2 + edge_w, edge_w),
        (inset, 0, edge_w, inset * 2 + edge_w),
        (-inset, 0, edge_w, inset * 2 + edge_w),
    ):
        box("CanvasLine", (w, d, 0.004), (sx, sy, 0.032), mats["canvas_edge"])

    # Posts, pads, ropes.
    post_r = 0.15 if small else 0.1
    post_top = 1.5
    rope_z = (0.55, 1.15) if small else (0.45, 0.85, 1.25)
    rope_r = 0.085 if small else 0.038
    corners = [(RING, RING), (-RING, RING), (-RING, -RING), (RING, -RING)]
    for i, (cx, cy) in enumerate(corners):
        cylinder(f"Post{i}", (cx, cy, -0.25), (cx, cy, post_top), post_r, mats["post"])
        cylinder(f"PostCap{i}", (cx, cy, post_top), (cx, cy, post_top + 0.04), post_r * 1.15, mats["post"])
        angle = math.atan2(cy, cx)
        if small:
            pad = box(f"Pad{i}", (0.36, 0.36, 0.95), (cx, cy, 0.85), mats["pad"], bevel=0.1)
            pad.rotation_euler = (0, 0, angle + math.pi / 4)
        else:
            for k, z in enumerate(rope_z):
                pad = box(f"Pad{i}_{k}", (0.24, 0.24, 0.25), (cx, cy, z), mats["pad"], bevel=0.07)
                pad.rotation_euler = (0, 0, angle + math.pi / 4)
    for i in range(4):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
        for k, z in enumerate(rope_z):
            top = k == len(rope_z) - 1
            mat = mats["rope_red"] if (top and not small) else mats["rope"]
            cylinder(f"Rope{i}_{k}", (ax, ay, z), (bx, by, z), rope_r, mat)

    # Canvas mark: the skewed red plate with "RB", turned to face the camera so the letters read
    # upright.
    face = math.radians(view["azimuth"] + 90)
    plate_w, plate_h = (3.4, 2.15) if small else (2.5, 1.5)
    if variant == "C" and not small:
        plate_w, plate_h = plate_w * 1.3, plate_h * 1.3
    skew = plate_h * 0.22
    # Counter-clockwise, so the solidified plate grows up out of the canvas (no z-fighting).
    points = [
        (-plate_w / 2 - skew, -plate_h / 2),
        (plate_w / 2 - skew, -plate_h / 2),
        (plate_w / 2 + skew, plate_h / 2),
        (-plate_w / 2 + skew, plate_h / 2),
    ]
    # C looks over the near post, so its mark sits further back to clear the post top.
    back = 0.85 if (variant == "C" and not small) else 0.0
    plate = polygon("Plate", points, 0.034, mats["plate"], rotation_z=face)
    lit = [points[0], (points[0][0] + 0.16, points[0][1]), (points[3][0] + 0.16, points[3][1]), points[3]]
    edge = polygon("PlateEdge", lit, 0.04, mats["plate_edge"], rotation_z=face)
    for obj in (plate, edge):
        obj.location.x -= back
        obj.location.y += back
    text(
        "RB",
        "RB",
        plate_h * 1.02,
        mats["letters"],
        (-back, back, 0.05),
        (0, 0, face),
        shear=0.3,
        extrude=0.006,
        spacing=1.02,
    )

    # Apron branding (variant B, large only): on the two apron faces the camera sees.
    if variant == "B" and not small:
        z = -APRON_DROP / 2 - 0.08
        size = 0.62
        text("ApronFront", "RINGSIDE BOOKER", size, mats["apron_text"], (0, -DECK - 0.012, z), (math.pi / 2, 0, 0), spacing=1.05)
        text("ApronSide", "RINGSIDE BOOKER", size, mats["apron_text"], (DECK + 0.012, 0, z), (math.pi / 2, 0, math.pi / 2), spacing=1.05)
    elif variant == "A" and not small:
        # Variant A: a plain "RB" on each visible apron face, branded without busy text.
        z = -APRON_DROP / 2 - 0.08
        for name, loc, rot in (
            ("ApronMarkFront", (0, -DECK - 0.012, z), (math.pi / 2, 0, 0)),
            ("ApronMarkSide", (DECK + 0.012, 0, z), (math.pi / 2, 0, math.pi / 2)),
        ):
            text(name, "RB", 0.62, mats["apron_text"], loc, rot, shear=0.3)


def setup_render(opts):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = opts["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.render.film_transparent = True
    scene.render.resolution_x = opts["size"]
    scene.render.resolution_y = opts["size"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.filter_size = 1.2
    # Standard keeps the brand reds saturated (AgX and PBR Neutral wash them towards pink).
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.7

    # GPU if there is one (OptiX, then CUDA, then HIP), else CPU.
    device = "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                device = kind
                break
        except TypeError:
            continue
    scene.cycles.device = "GPU" if device != "CPU" else "CPU"
    print(f"ring_icon.py: Cycles on {device}, {opts['samples']} samples, {opts['size']} px")

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = rgba("#2a3550")
    bg.inputs["Strength"].default_value = 0.35
    scene.world = world


def view_for(variant, small):
    """Camera for a variant. Azimuth is measured from +x; -45 looks down the +x/-y diagonal."""
    if small:
        # 16-32 px: straight on from the front and high, so the ring fills the square like the flat
        # icon does; C keeps its crop by framing tighter inside the tile.
        return {"type": "ORTHO", "azimuth": -90, "elevation": 58, "margin": 0.94 if variant == "C" else 1.02}
    if variant == "C":
        # Close and lower, down the diagonal: the near corner post stands in front, its ropes open
        # in a V, and the canvas mark shows above the post top.
        return {"type": "PERSP", "azimuth": -45, "elevation": 34, "lens": 28, "distance": 4.3, "target": (0.75, -0.75, 0.35)}
    # 3/4 high angle down the +x/-y diagonal, orthographic so it reads flat and clean.
    return {"type": "ORTHO", "azimuth": -45, "elevation": 40, "margin": 1.05}


def setup_camera_and_lights(view):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Camera")
    cam = link(bpy.data.objects.new("Camera", cam_data))
    scene.camera = cam

    elevation = math.radians(view["elevation"])
    azimuth = math.radians(view["azimuth"])
    direction = Vector(
        (math.cos(elevation) * math.cos(azimuth), math.cos(elevation) * math.sin(azimuth), math.sin(elevation))
    )
    cam_data.type = view["type"]
    if view["type"] == "PERSP":
        cam_data.lens = view["lens"]
        target = Vector(view["target"])
        cam.location = target + view["distance"] * direction
        look_at(cam, target)
    else:
        target = Vector((0, 0, 0.1))
        cam.location = target + 20 * direction
        look_at(cam, target)
        frame_ortho(cam, margin=view["margin"])

    # Studio lights: big soft key from front-left, cool fill, warm-red tinted rim from behind.
    area_light("Key", (-3.5, -7.5, 9.0), (0, 0, 0), 1100, 7.0)
    area_light("Fill", (8.0, -2.5, 3.0), (0, 0, 0), 300, 6.0, "#cfe0ff")
    area_light("Rim", (-5.0, 6.5, 4.5), (0, 0, 0.6), 2200, 4.0, "#e8efff")
    area_light("RimTop", (4.0, 6.0, 7.0), (0, 0, 0), 500, 4.0)


def frame_ortho(cam, margin):
    """Set the ortho scale and shift so every mesh/text in the scene fits, centred."""
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    xs, ys = [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type not in ("MESH", "FONT"):
            continue
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            p = inv @ (obj.matrix_world @ Vector(corner))
            xs.append(p.x)
            ys.append(p.y)
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    scale = max(width, height) * margin
    cam.data.ortho_scale = scale
    cam.data.shift_x = (max(xs) + min(xs)) / 2 / scale
    cam.data.shift_y = (max(ys) + min(ys)) / 2 / scale


def main():
    opts = parse_args()
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render(opts)
    view = view_for(opts["variant"], opts["small"])
    build_ring(opts["variant"], opts["small"], view)
    setup_camera_and_lights(view)
    out = os.path.abspath(opts["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    if opts["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]))
    print(f"ring_icon.py: wrote {out} in {time.time() - started:.1f} s")


main()
