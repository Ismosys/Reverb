import React, { useState } from 'react'
import type { AppConfig } from '@shared/types'
import { api, unwrap } from '../api'

/**
 * Manage trending locations. "Global" is the worldwide chart; users can search
 * an actual place (city/region/country) which is geocoded and added as a target
 * served by ReverbNation's local charts. Choose the active location, mark
 * favorites, and pick which to cycle through.
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
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  const call = async (p: Promise<{ ok: boolean; data?: AppConfig; error?: string }>, msg: string) => {
    try {
      onChange(await unwrap(p))
      notify(msg)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const search = async () => {
    if (!query.trim()) return notify('Type a location to search', true)
    setSearching(true)
    try {
      const cfg = await unwrap(api.locations.addByName(query.trim()))
      onChange(cfg)
      const added = cfg.locations.find((l) => l.query === query.trim())
      notify(`Added & selected: ${added?.label ?? query}`)
      setQuery('')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setSearching(false)
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
      {/* Location search */}
      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Search a Location
        </div>
        <div className="muted" style={{ marginBottom: 10 }}>
          Enter a city, region, or country to pull trending artists from that place (e.g. “Austin, TX”,
          “London, UK”, “Nashville, TN”).
        </div>
        <div className="row">
          <input
            placeholder="City, region, or country…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            style={{ minWidth: 320 }}
          />
          <button className="btn primary" onClick={search} disabled={searching}>
            {searching ? 'Searching…' : 'Add Location'}
          </button>
        </div>
      </div>

      {config.automation.cycleLocations && (
        <div className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            Location Cycling — On
          </div>
          <div className="muted">
            Each run visits these locations in order, splitting the total of{' '}
            <strong>{config.automation.artistsToSave}</strong> artists evenly across them:
          </div>
          <div style={{ marginTop: 8, fontWeight: 600 }}>
            {cycleOrder || 'No locations selected — favorites (or all) will be used.'}
          </div>
        </div>
      )}

      {/* Locations table */}
      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Locations
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Active</th>
                <th>Location</th>
                <th>Type</th>
                <th>Favorite</th>
                <th>In cycle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.locations.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="radio"
                      checked={config.activeLocationId === l.id}
                      onChange={() => call(api.locations.setActive(l.id), `Active: ${l.label}`)}
                    />
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <strong>{l.label}</strong>
                    {l.type === 'custom' && l.latitude !== undefined && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {l.latitude.toFixed(3)}, {l.longitude?.toFixed(3)}
                      </div>
                    )}
                  </td>
                  <td className="muted">{l.type === 'global' ? 'Global' : 'Custom'}</td>
                  <td>
                    <button className="btn" onClick={() => call(api.locations.toggleFavorite(l.id), 'Updated favorite')}>
                      {l.favorite ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <input type="checkbox" checked={inCycle(l.id)} onChange={() => toggleCycle(l.id)} />
                  </td>
                  <td>
                    {l.type === 'custom' ? (
                      <button className="btn danger" onClick={() => call(api.locations.remove(l.id), `Removed ${l.label}`)}>
                        Remove
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>
                        built-in
                      </span>
                    )}
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
