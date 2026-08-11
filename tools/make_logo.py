"""Generate the Clavis logo SVGs into icons/.

The mark is the letter C on ruled notebook paper. The C is the real glyph
outline from Anthropic Serif Text Regular, extracted once with fontTools and
inlined below as a path — so rendering needs no font installed and is identical
everywhere. See ANTHROPIC_SERIF_NOTE for provenance and the licensing caveat.

Outputs:
  icons/logo-source.svg       paper ground, for app icons and light contexts
  icons/logo-source-dark.svg  ink ground, for dark contexts

Run tools/render_icons.py afterwards to rasterise every size the bundle needs.

Usage: python tools/make_logo.py
"""
import math

ANTHROPIC_SERIF_NOTE = """
The C outline was extracted from AnthropicSerif-Text-Regular-Static.otf
(Copyright 2025 Anthropic PBC, foundry BSPK LLC) at 2000 upem, scaled so the
cap height is CAP_HEIGHT px on a 512 canvas, then centred on its ink bounding
box. To regenerate for a different letter or size, see tools/extract_glyph.py.

Licensing: this is Anthropic's proprietary brand typeface, not an open font.
Using it in a third-party product's logo may not be permitted and may imply
affiliation. Confirm before shipping.
"""

SIZE = 512

# --- The C, pre-transformed to the 512 canvas -------------------------------
# Absolute M/L/C/Z commands only: Figma's vectorPaths rejects H/V shorthand,
# and keeping one form means the Figma file and these SVGs stay in sync.
C_PATH = (
    "M 347.3 206.8 L 359.9 206.8 L 359.9 151.9 "
    "C 338.0 138.4 306.5 131.0 273.4 131.0 "
    "C 198.4 131.0 144.8 184.7 144.8 260.0 "
    "C 144.8 331.3 197.9 381.0 274.0 381.0 "
    "C 303.5 381.0 337.2 372.4 356.2 359.9 "
    "L 367.2 298.5 L 353.7 298.5 "
    "C 333.3 345.5 311.8 364.2 277.4 364.2 "
    "C 222.0 364.2 183.7 319.8 183.7 255.0 "
    "C 183.7 187.6 216.6 147.5 271.8 147.5 "
    "C 315.1 147.5 338.7 166.0 347.3 206.8 Z"
)

# --- Ruled paper ------------------------------------------------------------
# Wide-spaced rules: dense ruling turns into a grey smear at 32px and competes
# with the letter. 64px apart on 512 survives downscaling and still reads as
# notebook paper.
RULE_GAP = 64.0
RULE_FIRST = 96.0
RULE_LAST = 470.0
RULE_WEIGHT = 3.0

PAPER_TOP, PAPER_BOT = "#FDFCF9", "#F3F0E9"
PAPER_RULE = "#BFD0E8"
PAPER_INK = "#191917"

DARK_TOP, DARK_BOT = "#26252B", "#141318"
DARK_RULE = "#6B7894"
DARK_INK = "#F7F6F2"

SQUIRCLE_N = 4.6  # superellipse exponent; ~4.6 matches the macOS app shape


def squircle(size, inset=0.0, steps=64):
    """Superellipse as a closed Catmull-Rom path."""
    a = size / 2 - inset
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        pts.append((size / 2 + a * math.copysign(abs(ct) ** (2 / SQUIRCLE_N), ct),
                    size / 2 + a * math.copysign(abs(st) ** (2 / SQUIRCLE_N), st)))
    ring = [pts[-1]] + pts + [pts[0], pts[1]]
    d = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"
    for j in range(len(pts)):
        p0, p1, p2, p3 = ring[j], ring[j + 1], ring[j + 2], ring[j + 3]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C {c1[0]:.2f} {c1[1]:.2f}, {c2[0]:.2f} {c2[1]:.2f}, {p2[0]:.2f} {p2[1]:.2f}"
    return d + " Z"


def rules(color, opacity):
    out = []
    y = RULE_FIRST
    while y < RULE_LAST:
        out.append(
            f'    <line x1="0" y1="{y:.0f}" x2="{SIZE}" y2="{y:.0f}" '
            f'stroke="{color}" stroke-width="{RULE_WEIGHT}" stroke-opacity="{opacity}"/>'
        )
        y += RULE_GAP
    return "\n".join(out)


def build(dark=False):
    top, bot = (DARK_TOP, DARK_BOT) if dark else (PAPER_TOP, PAPER_BOT)
    rule = DARK_RULE if dark else PAPER_RULE
    ink = DARK_INK if dark else PAPER_INK
    edge = "#FFFFFF" if dark else "#000000"
    edge_op = 0.10 if dark else 0.09
    rule_op = 0.55 if dark else 0.9

    sq = squircle(SIZE)
    ruled = rules(rule, rule_op)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <title>Clavis</title>
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bot}"/>
    </linearGradient>
    <clipPath id="card"><path d="{sq}"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <path d="{sq}" fill="url(#ground)"/>
{ruled}
  </g>
  <path d="{squircle(SIZE, inset=1.0)}" fill="none" stroke="{edge}" stroke-opacity="{edge_op}" stroke-width="2"/>
  <path d="{C_PATH}" fill="{ink}"/>
</svg>
'''


if __name__ == '__main__':
    for path, dark in (('icons/logo-source.svg', False),
                       ('icons/logo-source-dark.svg', True)):
        svg = build(dark=dark)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(svg)
        print(f'wrote {path}: {len(svg)} bytes')
