import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';

interface NavItem {
  label: string;
  to?: string;
  end?: boolean;
  icon: ReactNode;
}

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
    {path}
  </svg>
);

const ITEMS: NavItem[] = [
  {
    label: 'Map',
    to: '/game',
    end: true,
    icon: icon(
      <path
        d="M2 5 7 3l6 2 5-2v12l-5 2-6-2-5 2z M7 3v12 M13 5v12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />,
    ),
  },
  {
    label: 'Base',
    to: '/game/base',
    icon: icon(
      <path
        d="M3 17V8l7-5 7 5v9 M8 17v-5h4v5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />,
    ),
  },
  {
    label: 'Missions',
    to: '/game/missions',
    icon: icon(
      <>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M10 5.5V10l3 2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>,
    ),
  },
  {
    label: 'The Bar',
    to: '/game/bar',
    icon: icon(
      <>
        <circle cx="10" cy="6" r="3" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.3" />
      </>,
    ),
  },
  {
    label: 'Research',
    to: '/game/research',
    icon: icon(
      <>
        <path
          d="M4 3h9l3 3v11H4z M13 3v3h3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>,
    ),
  },
  {
    label: 'Market',
    icon: icon(
      <path
        d="M3 6h14l-1.5 8H4.5z M3 6 2 3 M7 17h.01M14 17h.01"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />,
    ),
  },
];

/** Fixed-width primary navigation for the game shell. */
export function LeftNav() {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-neon-cyan/20 bg-night-raised p-3">
      {ITEMS.map((item) =>
        item.to ? (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 border px-3 py-2.5 font-display text-xs uppercase tracking-[0.2em] transition-colors',
                isActive
                  ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                  : 'border-transparent text-steel-400 hover:border-steel-700 hover:text-steel-200',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ) : (
          <span
            key={item.label}
            aria-disabled="true"
            title="Coming soon"
            className="flex cursor-not-allowed items-center gap-3 border border-transparent px-3 py-2.5 font-display text-xs uppercase tracking-[0.2em] text-steel-600"
          >
            {item.icon}
            {item.label}
            <span className="ml-auto text-[8px] tracking-[0.15em] text-steel-700">SOON</span>
          </span>
        ),
      )}
    </nav>
  );
}
