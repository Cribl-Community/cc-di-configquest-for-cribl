// The Settings page: configure how findings are weighted, thresholds, appearance,
// and see build info. Same panel/table primitives as the rest of the app; choices
// persist to the KV store (see useSettings / useTheme).

import { useEffect, useState } from 'react';
import { kvDiagnostics, type KvDiagnostics } from '../kv';
import { FINDING_LABELS, type FindingCategory } from '../data/types';
import { SEVERITIES, SEVERITY_RANK, type Severity } from '../data/severity';
import { MIN_REFRESH_SECONDS, type AppSettings } from './useSettings';
import type { Theme } from './useTheme';
import { cap } from './format';

type Section = 'appearance' | 'hygiene' | 'data' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'hygiene', label: 'Config hygiene' },
  { id: 'data', label: 'Data & indexing' },
  { id: 'about', label: 'About' },
];

interface SettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  version: string;
  onRefresh: () => void;
  refreshing: boolean;
}

export function Settings({ settings, onUpdate, theme, onSetTheme, version, onRefresh, refreshing }: SettingsProps) {
  const [section, setSection] = useState<Section>('hygiene');

  return (
    <div className="settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.id} className={`set-navitem${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="set-body">
        {section === 'appearance' && (
          <SettingsSection title="Appearance" sub="Theme for this browser.">
            <div className="set-group">
              <SetRow label="Theme" desc="Dark or light.">
                <div className="seg" role="group" aria-label="Theme">
                  <button className={theme === 'dark' ? 'on' : ''} onClick={() => onSetTheme('dark')}>
                    Dark
                  </button>
                  <button className={theme === 'light' ? 'on' : ''} onClick={() => onSetTheme('light')}>
                    Light
                  </button>
                </div>
              </SetRow>
            </div>
          </SettingsSection>
        )}

        {section === 'hygiene' && (
          <SettingsSection title="Config hygiene" sub="Choose how each finding is weighted, so the Overview surfaces what matters to your team first.">
            <div className="set-group">
              <div className="set-grouph">Severity</div>
              {(Object.keys(FINDING_LABELS) as FindingCategory[])
                .sort((a, b) => SEVERITY_RANK[settings.severity[a]] - SEVERITY_RANK[settings.severity[b]])
                .map((c) => (
                  <div className="set-row" key={c}>
                    <span className="set-sevname">{FINDING_LABELS[c]}</span>
                    <select
                      className={`sel sel-${settings.severity[c]}`}
                      value={settings.severity[c]}
                      onChange={(e) => onUpdate({ severity: { ...settings.severity, [c]: e.target.value as Severity } })}
                      aria-label={`Severity for ${FINDING_LABELS[c]}`}
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {cap(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>

            <div className="set-group">
              <div className="set-grouph">Thresholds</div>
              <SetRow label="Stale-object age" desc="Flag objects untouched for longer than this (needs versioning access).">
                <div className="numwrap">
                  <input
                    className="numin"
                    type="number"
                    min={1}
                    value={settings.staleDays}
                    onChange={(e) => onUpdate({ staleDays: Number(e.target.value) })}
                    aria-label="Stale-object age in days"
                  />
                  <span className="numunit">days</span>
                </div>
              </SetRow>
            </div>
          </SettingsSection>
        )}

        {section === 'data' && (
          <SettingsSection title="Data & indexing" sub="Re-index cadence and manual refresh.">
            <div className="set-group">
              <div className="set-grouph">Automatic re-indexing</div>
              <SetRow label="Periodic re-index" desc="Re-fetch and rebuild on a fixed interval — useful for an always-on oversight screen.">
                <div className="seg" role="group" aria-label="Automatic re-indexing">
                  <button className={!settings.autoRefresh ? 'on' : ''} onClick={() => onUpdate({ autoRefresh: false })}>
                    Off
                  </button>
                  <button className={settings.autoRefresh ? 'on' : ''} onClick={() => onUpdate({ autoRefresh: true })}>
                    On
                  </button>
                </div>
              </SetRow>
              {settings.autoRefresh && (
                <SetRow label="Interval" desc={`How often to re-index (minimum ${MIN_REFRESH_SECONDS}s).`}>
                  <div className="numwrap">
                    <input
                      className="numin"
                      type="number"
                      min={MIN_REFRESH_SECONDS}
                      value={settings.refreshSeconds}
                      onChange={(e) => onUpdate({ refreshSeconds: Number(e.target.value) })}
                      aria-label="Re-index interval in seconds"
                    />
                    <span className="numunit">seconds</span>
                  </div>
                </SetRow>
              )}
            </div>

            <div className="set-group">
              <SetRow label="Re-index now" desc="Re-fetch every Worker Group and rebuild the index immediately.">
                <button className="btn" onClick={onRefresh} disabled={refreshing}>
                  {refreshing ? 'Re-indexing…' : 'Re-index'}
                </button>
              </SetRow>
            </div>
          </SettingsSection>
        )}

        {section === 'about' && (
          <SettingsSection title="About" sub="">
            <div className="set-group">
              <SetRow label="Config Quest for Cribl" desc="Configuration and knowledge object visibility, search, and hygiene for Cribl.">
                <span className="mono t2">v{version}</span>
              </SetRow>
            </div>
            <StorageDiag />
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

// Live check of the persistence layer: whether the shared, app-scoped KV store is
// reachable (settings persist + are shared across users when it is), plus the resolved
// app id / API base to make a failure diagnosable at a glance.
function StorageDiag() {
  const [diag, setDiag] = useState<KvDiagnostics | null>(null);
  const [testing, setTesting] = useState(false);
  const run = () => {
    setTesting(true);
    void kvDiagnostics().then((d) => {
      setDiag(d);
      setTesting(false);
    });
  };
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="set-group">
      <div className="set-grouph">Storage</div>
      <SetRow label="Shared settings store" desc="Settings save to the app's store on the Leader, shared across every user of the app.">
        {testing || !diag ? (
          <span className="mono t2">Checking…</span>
        ) : (
          <span className={`kv-status ${diag.shared.ok ? 'ok' : 'bad'}`}>{diag.shared.ok ? 'Connected' : 'Unavailable'}</span>
        )}
      </SetRow>
      {/* The connection details are only useful when the check fails, so they stay out of the
          way while storage is healthy rather than sitting on screen permanently. */}
      {diag && !diag.shared.ok && (
        <div className="kv-diag">
          <div>
            <span className="kv-dk">Reason</span> {diag.shared.detail}
          </div>
          <div>
            <span className="kv-dk">App id</span> <span className="mono">{diag.appId}</span> <span className="t3">via {diag.appIdSource}</span>
          </div>
          <div>
            <span className="kv-dk">API base</span> <span className="mono">{diag.apiBase}</span>
          </div>
          <div>
            <span className="kv-dk">Browser fallback</span> {diag.localStorage ? 'available' : 'blocked (sandboxed frame)'}
          </div>
        </div>
      )}
      <SetRow label="Re-test" desc="Run the storage check again.">
        <button className="btn" onClick={run} disabled={testing}>
          {testing ? 'Testing…' : 'Test storage'}
        </button>
      </SetRow>
    </div>
  );
}

function SettingsSection({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="set-section">
      <h2 className="set-head">{title}</h2>
      {sub && <p className="set-sub">{sub}</p>}
      {children}
    </div>
  );
}

function SetRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-rk">
        <div className="set-rk-k">{label}</div>
        <div className="set-rk-d">{desc}</div>
      </div>
      {children}
    </div>
  );
}

