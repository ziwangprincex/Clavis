// Shared, DOM-free color math for the editor, chrome and theme samples.
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(h)) return null;
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function withAlpha(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : hex;
}

export function mix(hex: string, toward: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  if (!a || !b) return hex;
  const t = Math.max(0, Math.min(1, amount));
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const linear = (value: number) => {
    const n = value / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return linear(c.r) * 0.2126 + linear(c.g) * 0.7152 + linear(c.b) * 0.0722;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Filled controls need dark ink on a pale accent, not white in every theme. */
export function onAccent(accent: string): string {
  const ink = contrast(accent, '#17191c') >= 4.5 ? '#17191c' : '#000000';
  return contrast(accent, '#ffffff') >= contrast(accent, ink) ? '#ffffff' : ink;
}

/** Keep secondary copy readable without making it as loud as body text. */
export function readableMix(bg: string, fg: string, amount: number, minimum = 4.5): string {
  for (let t = amount; t < 1; t += 0.025) {
    const color = mix(bg, fg, t);
    if (contrast(bg, color) >= minimum) return color;
  }
  return fg;
}
