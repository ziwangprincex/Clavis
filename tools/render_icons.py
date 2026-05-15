"""Render the Clavis logo SVG to all PNG sizes Tauri needs.

Usage: python tools/render_icons.py
"""
import resvg_py, os, struct, zlib

SVG = open('icons/logo-source.svg', 'r', encoding='utf-8').read()

def render(size, out_path):
    png_bytes = bytes(resvg_py.svg_to_bytes(svg_string=SVG, width=size, height=size))
    # Strip the iCCP/sRGB/gAMA chunks libpng warns about, then write.
    cleaned = strip_ancillary(png_bytes)
    with open(out_path, 'wb') as f:
        f.write(cleaned)
    print(f'  wrote {out_path}: {size}x{size}, {len(cleaned)} bytes')

def strip_ancillary(data):
    """Remove sRGB / gAMA / iCCP chunks libpng 1.6 warns about for non-conforming
    profiles. The remaining minimal PNG is still valid everywhere."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return data
    out = bytearray(data[:8])
    i = 8
    drop = (b'sRGB', b'gAMA', b'iCCP')
    while i < len(data):
        clen = struct.unpack('>I', data[i:i+4])[0]
        ctype = data[i+4:i+8]
        end = i + 8 + clen + 4
        if ctype not in drop:
            out.extend(data[i:end])
        i = end
    return bytes(out)

os.makedirs('icons', exist_ok=True)

# Tauri/macOS standard sizes
render(32,  'icons/32x32.png')
render(128, 'icons/128x128.png')
render(256, 'icons/128x128@2x.png')
render(512, 'icons/icon.png')

# Favicon for the WebView
render(64,  'ui/favicon.png')

print('done')
