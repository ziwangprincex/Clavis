"""Rasterise the Clavis logo SVG into every icon the bundle needs.

Reads icons/logo-source.svg (regenerate it with tools/make_logo.py) and writes
the Tauri PNG set, the Windows Store logos, icon.ico, and icon.icns.

Usage: python tools/render_icons.py
"""
import io
import os
import struct

import resvg_py
from PIL import Image

SVG_PATH = 'icons/logo-source.svg'
SMALL_SVG_PATH = 'icons/logo-source-small.svg'
SVG = open(SVG_PATH, 'r', encoding='utf-8').read()
SMALL_SVG = open(SMALL_SVG_PATH, 'r', encoding='utf-8').read()
SMALL_MAX_SIZE = 48

# Tauri's PNG set.
PNG_TARGETS = {
    'icons/32x32.png': 32,
    'icons/128x128.png': 128,
    'icons/128x128@2x.png': 256,
    'icons/icon.png': 512,
}

# Windows Store / MSIX logos, named by their nominal edge length.
SQUARE_TARGETS = {
    'icons/Square30x30Logo.png': 30,
    'icons/Square44x44Logo.png': 44,
    'icons/Square71x71Logo.png': 71,
    'icons/Square89x89Logo.png': 89,
    'icons/Square107x107Logo.png': 107,
    'icons/Square142x142Logo.png': 142,
    'icons/Square150x150Logo.png': 150,
    'icons/Square284x284Logo.png': 284,
    'icons/Square310x310Logo.png': 310,
    'icons/StoreLogo.png': 50,
}

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
FAVICON_SIZES = (16, 32, 48)

# (icns type code, pixel size). The `ic..` codes are the retina/modern variants
# macOS actually picks up; the older `is32`/`il32` masks are not needed once the
# modern ones are present. Note the @2x codes take double their nominal size:
# ic11 is 16pt@2x, ic12 is 32pt@2x, ic13 128pt@2x, ic14 256pt@2x, ic10 512pt@2x.
ICNS_ENTRIES = (
    (b'icp4', 16), (b'icp5', 32), (b'icp6', 64),
    (b'ic07', 128), (b'ic08', 256), (b'ic09', 512),
    (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512),
    (b'ic10', 1024),
)


def render(size):
    """Rasterise the size-appropriate SVG directly at the target dimensions."""
    source = SMALL_SVG if size <= SMALL_MAX_SIZE else SVG
    png = bytes(resvg_py.svg_to_bytes(svg_string=source, width=size, height=size))
    return strip_ancillary(png)


def strip_ancillary(data):
    """Drop sRGB / gAMA / iCCP chunks, which libpng 1.6 warns about for
    non-conforming profiles. The remaining minimal PNG is valid everywhere."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return data
    out = bytearray(data[:8])
    i = 8
    drop = (b'sRGB', b'gAMA', b'iCCP')
    while i < len(data):
        length = struct.unpack('>I', data[i:i + 4])[0]
        ctype = data[i + 4:i + 8]
        end = i + 8 + length + 4
        if ctype not in drop:
            out.extend(data[i:end])
        i = end
    return bytes(out)


def write_png(path, size):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    data = render(size)
    with open(path, 'wb') as f:
        f.write(data)
    print(f'  {path}: {size}x{size}, {len(data)} bytes')


def write_ico(path, sizes):
    """Assemble an ICO whose PNG layers are rendered independently.

    Pillow's convenience writer downsamples every layer from one bitmap. That
    defeats the optical-size SVG and adds an unnecessary raster resample.
    """
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    payloads = [(size, render(size)) for size in sizes]
    header_size = 6 + 16 * len(payloads)
    entries = bytearray()
    data = bytearray()
    offset = header_size
    for size, png in payloads:
        edge = 0 if size == 256 else size
        entries += struct.pack(
            '<BBBBHHII', edge, edge, 0, 0, 1, 32, len(png), offset
        )
        data += png
        offset += len(png)
    blob = struct.pack('<HHH', 0, 1, len(payloads)) + entries + data
    with open(path, 'wb') as f:
        f.write(blob)
    print(f'  {path}: {sorted(sizes)}, {len(blob)} bytes')


def write_icns(path):
    """Assemble the .icns by hand.

    Pillow's ICNS writer depends on macOS tooling, so on other platforms we
    build the container directly: an 8-byte header followed by one
    type+length+payload record per size, each payload a plain PNG."""
    records = bytearray()
    for code, size in ICNS_ENTRIES:
        png = render(size)
        records += code + struct.pack('>I', len(png) + 8) + png
    blob = b'icns' + struct.pack('>I', len(records) + 8) + bytes(records)
    with open(path, 'wb') as f:
        f.write(blob)
    print(f'  {path}: {len(ICNS_ENTRIES)} entries, {len(blob)} bytes')


if __name__ == '__main__':
    print(f'sources: {SVG_PATH}; <= {SMALL_MAX_SIZE}px: {SMALL_SVG_PATH}')
    print('PNGs:')
    for path, size in PNG_TARGETS.items():
        write_png(path, size)
    print('Windows Store logos:')
    for path, size in SQUARE_TARGETS.items():
        write_png(path, size)
    print('containers:')
    write_ico('icons/icon.ico', ICO_SIZES)
    # The WebView requests /favicon.ico by default, so keep it an ICO.
    write_ico('web/public/favicon.ico', FAVICON_SIZES)
    write_icns('icons/icon.icns')
    print('done')
