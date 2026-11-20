# 3D ring app icon (Blender)

Three candidate app icons for Ringside Booker: a stylised wrestling ring rendered in Blender
(Cycles), in the UNITY-11 navy and red palette, with "RB" and "RINGSIDE BOOKER" lettering in
Barlow Condensed ExtraBold (SIL OFL 1.1, `game/Assets/UI/Fonts`). The design is original to this
game.

| Variant | What it is                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------- |
| A       | The ring on its own (transparent), 3/4 high angle, red "RB" plate on the canvas, "RB" on the apron. |
| B       | The same ring with "RINGSIDE BOOKER" on the apron, on the navy rounded tile of the flat icon.       |
| C       | A closer, lower view over one corner post and its ropes, cropped to the navy tile.                  |

Outputs, per variant `V`:

- `game/branding/ring-V-1024.png`: the finished 1024 px icon.
- `game/branding/ring-V.ico`: 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 px.

Sizes 32 px and below come from a simplified render (`--small`): seen straight on from the front
and high, two thick ropes, one tall pad per post, no apron text and a bigger "RB" plate. A full
3/4 ring turns to mush at those sizes. Sizes 40 px and up are scaled down from the 1024 px render.

## Files

- `ring_icon.py`: the Blender scene (geometry, materials, lights, camera). Runs inside Blender.
- `build_ring_icons.py`: runs Blender for each variant, then builds the PNGs, the `.ico` files and
  an optional comparison sheet with Pillow.
- `.renders/`: raw Blender renders from the last run (gitignored).

## Re-render

Needs Blender 5.3 and Python 3 with Pillow. From WSL:

```sh
python3 -m venv /tmp/rb-icon-venv && /tmp/rb-icon-venv/bin/pip install pillow
/tmp/rb-icon-venv/bin/python game/branding/blender/build_ring_icons.py \
  --compare /mnt/f/source/rb-wt/shots-s13-icon/compare.png
```

Options: `--variants AB` (a subset), `--samples 128`, `--skip-render` (rebuild the PNGs and `.ico`
files from `.renders/` only), `--blender <path>` (or `BLENDER=`; the default is the Windows
Blender 5.3 under `/mnt/c/Program Files`). Paths are converted with `wslpath -w` for the Windows
Blender.

One render on its own (Windows paths for the Windows Blender):

```sh
"/mnt/c/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b \
  -P "$(wslpath -w game/branding/blender/ring_icon.py)" -- \
  --variant C --size 1024 --samples 128 --out 'C:\Temp\ring-C.png' --blend 'C:\Temp\ring-C.blend'
```

`ring_icon.py` options: `--variant A|B|C`, `--small`, `--size N`, `--samples N`, `--out PATH`,
`--blend PATH` (also save the scene to open in Blender).

Render settings: Cycles on the GPU (OptiX, then CUDA or HIP, else CPU), 128 samples with adaptive
sampling and the denoiser, transparent film, Standard view transform at -0.7 EV (AgX and PBR
Neutral wash the brand reds towards pink). A soft key light, a cool fill, and a rim light from
behind. On an RTX 5080 one 1024 px render takes about 5.5 s; the whole run takes about 30 s.

## Use one as the app icon

The game and installer still use the flat icon (`game/branding/app-icon.ico`). Once the owner
picks a variant `V`, the swap is one line: copy its `.ico` over both icon files.

```sh
cp game/branding/ring-V.ico game/installer/RingsideBooker.ico && cp game/branding/ring-V.ico game/branding/app-icon.ico
```

That changes Setup.exe's icon. The game exe's own icon (which the shortcuts and Apps & features
show) comes from the Unity player icon PNGs in `game/Assets/UI/AppIcon/AppIcon-<size>.png`
(`BuildScripts.ApplyIdentity`), so to change those as well, let the build script do all three steps
(it re-renders that variant first, about 10 s):

```sh
/tmp/rb-icon-venv/bin/python game/branding/blender/build_ring_icons.py --install V
```
