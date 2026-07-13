import React from 'react'
import type { AppConfig } from '@shared/types'
import { api, unwrap } from '../api'

/**
 * Manage the trending geo scope. ReverbNation Charts supports four scopes
 * (Global / National / Regional / Local) relative to your account's region;
 * choose the active one, mark favorites, and pick which to cycle through.
 */
export function LocationsPanel({
  config,
  onChange,
  notify
}: {
  config: AppConfig
  onChange: (c: AppConfig) => void
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
  const call = async (p: Promise<{ ok: boolean; data?: AppConfig; error?: string }>, msg: string) => {
    try {
      onChange(await unwrap(p))
      notify(msg)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const cycleIds = config.cycleLocationIds
  const inCycle = (id: string) => cycleIds.includes(id)
  const toggleCycle = (id: string) => {
    const next = inCycle(id) ? cycleIds.filter((x) => x !== id) : [...cycleIds, id]
    call(api.locations.setCycle(next), 'Updated cycle')
  }
  const cycleOrder = cycleIds
    .map((id) => config.locations.find((l) => l.id === id)?.label)
    .filter(Boolean)
    .join(' → ')

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card">
        <div className="muted">
          ReverbNation's Charts rank artists by geo <strong>scope</strong> relative to your account's
          region — not arbitrary cities. Pick the scope to pull trending artists from.
        </div>
      </div>

      {config.automation.cycleLocations && (
        <div className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            Location Cycling — On
          </div>
          <div className="muted">
            Each run visits these scopes in order, splitting the total of{' '}
            <strong>{config.automation.artistsToSave}</strong> artists evenly across them:
          </div>
          <div style={{ marginTop: 8, fontWeight: 600 }}>
            {cycleOrder || 'No scopes selected — favorites (or all) will be used.'}
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Geo Scopes
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Active</th>
                <th>Scope</th>
                <th>Favorite</th>
                <th>In cycle</th>
              </tr>
            </thead>
            <tbody>
              {config.locations.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="radio"
                      checked={config.activeLocationId === l.id}
                      onChange={() => call(api.locations.setActive(l.id), `Active scope: ${l.label}`)}
                    />
                  </td>
                  <td>
                    <strong>{l.label}</strong>
                  </td>
                  <td>
                    <button className="btn" onClick={() => call(api.locations.toggleFavorite(l.id), 'Updated favorite')}>
                      {l.favorite ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <input type="checkbox" checked={inCycle(l.id)} onChange={() => toggleCycle(l.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
