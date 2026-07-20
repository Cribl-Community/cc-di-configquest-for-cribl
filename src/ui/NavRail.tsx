// Collapsed icon rail on the left that expands (on hover, after a short delay) to
// reveal labels — makes Compare and Findings first-class alongside Browse, with
// the theme toggle and Refresh pinned at the bottom. Overlays content when
// expanded (fixed-position) so nothing reflows.

import { useRef, useState } from 'react';
import { Brand } from './logo';

interface NavRailProps {
  theme: 'dark' | 'light';
  refreshing: boolean;
  compareOpen: boolean;
  overviewActive: boolean;
  commitsActive: boolean;
  differencesActive: boolean;
  settingsActive: boolean;
  helpActive: boolean;
  onBrowse: () => void;
  onCompare: () => void;
  onOverview: () => void;
  onCommits: () => void;
  onDifferences: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
}

export function NavRail(props: NavRailProps) {
  const { theme, refreshing, compareOpen, overviewActive, commitsActive, differencesActive, settingsActive, helpActive, onBrowse, onCompare, onOverview, onCommits, onDifferences, onSettings, onHelp, onToggleTheme, onRefresh } = props;
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const open = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setExpanded(true), 320);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setExpanded(false);
  };
  // Selecting an item collapses the rail immediately (don't linger expanded).
  const act = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <nav
      className={`navrail${expanded ? ' navrail-expanded' : ''}`}
      onMouseEnter={open}
      onMouseLeave={close}
      aria-label="Primary"
    >
      <Brand theme={theme} />

      <div className="navrail-group">
        <NavItem icon={<OverviewIcon />} label="Overview" active={overviewActive} onClick={act(onOverview)} />
        <NavItem icon={<BrowseIcon />} label="Browse" active={!compareOpen && !overviewActive && !commitsActive && !differencesActive && !settingsActive && !helpActive} onClick={act(onBrowse)} />
        <NavItem icon={<CompareIcon />} label="Compare" active={compareOpen} onClick={act(onCompare)} />
        <NavItem icon={<CommitsIcon />} label="Commits" active={commitsActive} onClick={act(onCommits)} />
        <NavItem icon={<DifferencesIcon />} label="Differences" active={differencesActive} onClick={act(onDifferences)} />
      </div>

      <div className="navrail-spacer" />

      <div className="navrail-group">
        <NavItem icon={<SettingsIcon />} label="Settings" active={settingsActive} onClick={act(onSettings)} />
        <NavItem icon={<HelpIcon />} label="Help" active={helpActive} onClick={act(onHelp)} />
        <NavItem
          icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={act(onToggleTheme)}
        />
        <NavItem icon={<RefreshIcon />} label={refreshing ? 'Refreshing…' : 'Refresh'} onClick={act(onRefresh)} disabled={refreshing} />
      </div>
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`navitem${active ? ' navitem-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="navitem-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="navrail-label">{label}</span>
    </button>
  );
}

// --- icons (Feather-style, currentColor stroke) ---

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function BrowseIcon() {
  return (
    <svg {...svgProps}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="7" height="16" rx="1" />
      <rect x="14" y="4" width="7" height="16" rx="1" />
    </svg>
  );
}

// A git-commit glyph: a node on a line (the classic commit-on-a-branch mark).
function CommitsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="4" />
      <line x1="1.5" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22.5" y2="12" />
    </svg>
  );
}

// Git-compare glyph: two branch nodes joined — divergence between groups.
function DifferencesIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M11 18H8a2 2 0 0 1-2-2V9" />
    </svg>
  );
}

function OverviewIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20 11a8 8 0 1 0-1.5 5" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
