import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export const Icon = {
  overview: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  matches: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <path d="M12 5v14" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M2.5 9.5h2.5v5H2.5M21.5 9.5H19v5h2.5" />
    </svg>
  ),
  players: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.6 3 2.4 3.5 5.2" />
    </svg>
  ),
  scouting: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20.5 20.5-5.2-5.2" />
      <path d="M8 10.5h5M10.5 8v5" />
    </svg>
  ),
  analyse: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  ),
  sparkle: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z" />
    </svg>
  ),
  chat: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
    </svg>
  ),
  close: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  send: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M4 12 20 4l-6 16-2.5-6.5z" />
    </svg>
  ),
  check: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  alert: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4M12 16.8v.2" />
    </svg>
  ),
  x: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  ),
  arrowRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  arrowUp: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  ),
  arrowDown: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  ),
  play: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  ),
  dice: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  video: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
    </svg>
  ),
  plug: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21" />
    </svg>
  ),
  menu: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  ball: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7.5 4 2.9-1.5 4.7h-5L8 10.4z" />
      <path d="M12 7.5V3.2M16 10.4l4-1.6M14.5 15.1l2.5 3.7M9.5 15.1 7 18.8M8 10.4l-4-1.6" />
    </svg>
  ),
  shield: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z" />
    </svg>
  ),
  bolt: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
    </svg>
  ),
  target: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </svg>
  ),
  refresh: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4" />
    </svg>
  ),
};
