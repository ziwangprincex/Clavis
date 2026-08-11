"""Extract a glyph outline from an installed font as an SVG/Figma path.

Regenerates the C_PATH constant in tools/make_logo.py. Kept separate because it
needs the font installed, while make_logo.py deliberately does not.

Usage:
  python tools/extract_glyph.py                     # C from Anthropic Serif
  python tools/extract_glyph.py --glyph A --cap 260
  python tools/extract_glyph.py --font /path/to.otf --glyph C
"""
import argparse
import os

from fontTools.misc.transform import Transform
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

DEFAULT_FONT = os.path.expandvars(
    r'%LOCALAPPDATA%\Microsoft\Windows\Fonts\AnthropicSerif-Text-Regular-Static.otf'
)
CANVAS = 512.0
DEFAULT_CAP = 250.0


class FigmaPen(BasePen):
    """Emit absolute M/L/C/Z only.

    Figma's `vectorPaths` rejects H/V/S/Q shorthand with "Invalid command", and
    fontTools' SVGPathPen emits H/V. Using one restricted form keeps the Figma
    file and the generated SVGs byte-identical in geometry."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.cmds = []

    def _moveTo(self, p):
        self.cmds.append(f'M {p[0]:.1f} {p[1]:.1f}')

    def _lineTo(self, p):
        self.cmds.append(f'L {p[0]:.1f} {p[1]:.1f}')

    def _curveToOne(self, p1, p2, p3):
        self.cmds.append(
            f'C {p1[0]:.1f} {p1[1]:.1f} {p2[0]:.1f} {p2[1]:.1f} {p3[0]:.1f} {p3[1]:.1f}'
        )

    def _closePath(self):
        self.cmds.append('Z')


def extract(font_path, glyph_name, cap_height, canvas=CANVAS):
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    if glyph_name not in glyph_set:
        raise SystemExit(f'glyph {glyph_name!r} not in {font_path}')

    bounds = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    gw, gh = x1 - x0, y1 - y0

    scale = cap_height / gh
    # Centre on the ink bounding box, not the advance width: for a round letter
    # the sidebearings are asymmetric and advance-centring looks off-centre.
    tx = (canvas - gw * scale) / 2.0 - x0 * scale
    ty = (canvas + gh * scale) / 2.0 + y0 * scale
    # Negative y scale flips font (y-up) into SVG/Figma (y-down) space.
    transform = Transform(scale, 0, 0, -scale, tx, ty)

    pen = FigmaPen(glyph_set)
    glyph_set[glyph_name].draw(TransformPen(pen, transform))

    check = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(TransformPen(check, transform))
    b = check.bounds

    return ' '.join(pen.cmds), {
        'family': font['name'].getDebugName(4),
        'copyright': font['name'].getDebugName(0),
        'upem': font['head'].unitsPerEm,
        'bounds': [round(v, 1) for v in b],
        'centre': (round((b[0] + b[2]) / 2, 1), round((b[1] + b[3]) / 2, 1)),
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', default=DEFAULT_FONT)
    ap.add_argument('--glyph', default='C')
    ap.add_argument('--cap', type=float, default=DEFAULT_CAP)
    args = ap.parse_args()

    path, meta = extract(args.font, args.glyph, args.cap)
    for k, v in meta.items():
        print(f'{k}: {v}')
    print(f'\nlength: {len(path)} chars')
    print('\n--- paste into make_logo.py as C_PATH ---')
    print(path)
