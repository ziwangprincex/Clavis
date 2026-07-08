// Minimal SF-Symbols-flavoured stroke icons (16×16 grid, currentColor).
// Kept as plain components — no icon-font or external dependency, so they
// inherit color/size from CSS and stay crisp on retina.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export const IconDoc = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 1.75h5.2L12.5 5v9.25h-8.5z" />
    <path d="M9 1.75V5h3.5" />
  </svg>
);

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M1.75 3.5h4.4l1.4 1.75h6.7v7.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.5V8l2.3 1.6" />
  </svg>
);

export const IconSave = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2v7.5" />
    <path d="M5 7l3 3 3-3" />
    <path d="M2.5 10.5v3h11v-3" />
  </svg>
);

export const IconGear = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.9v1.7M8 12.4v1.7M14.1 8h-1.7M3.6 8H1.9M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2M12.3 12.3l-1.2-1.2M4.9 4.9L3.7 3.7" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <path d="M5 3.2c0-.6.65-.97 1.17-.66l7 4.3a.78.78 0 0 1 0 1.33l-7 4.3A.78.78 0 0 1 5 12.8z" />
  </svg>
);

export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.4" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" />
  </svg>
);

export const IconPin = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 1.9h4M8 1.9v4.4M4.6 9.4c0-1.9 1.5-3.1 3.4-3.1s3.4 1.2 3.4 3.1z" />
    <path d="M8 9.4v4.7" />
  </svg>
);

export const IconExport = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 9.5V1.9" />
    <path d="M5.2 4.4L8 1.7l2.8 2.7" />
    <path d="M3 7.5v6h10v-6" />
  </svg>
);

export const IconSigma = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.4H4.4L9 8l-4.6 4.6H12" />
  </svg>
);

export const IconCommand = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6h4v4H6z" />
    <path d="M6 6H4.5A1.5 1.5 0 1 1 6 4.5zM10 6h1.5A1.5 1.5 0 1 0 10 4.5zM6 10H4.5A1.5 1.5 0 1 0 6 11.5zM10 10h1.5a1.5 1.5 0 1 1-1.5 1.5z" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.4" />
    <path d="M10.4 10.4l3.4 3.4" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6.2L8 10l4-3.8" />
  </svg>
);
