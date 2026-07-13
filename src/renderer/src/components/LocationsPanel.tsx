import React, { useState } from 'react'
import type { AppConfig, TrendingLocation } from '@shared/types'
import { api, unwrap } from '../api'

const TYPES: TrendingLocation['type'][] = ['country', 'state', 'city', 'region']

/** Manage trending locations: select active, favorite, add, remove. */
export function LocationsPanel({
  config,
  onChange,
  notify
}: {
  config: AppConfig
  onChange: (c: AppConfig) => void
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<TrendingLocation>({
    id: '',
    label: '',
    type: 'city',
    country: '',
    state: '',
    city: ''
  })

  const call = async (p: Promise<{ ok: boolean; data?: AppConfig; error?: string }>, msg: string) => {
    try {
      onChange(await unwrap(p))
      notify(msg)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const add = async () => {
    if (!draft.label.trim()) return notify('Label is required', true)
    const id = draft.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await call(api.locations.add({ ...draft, id }), `Added ${draft.label}`)
    setDraft({ id: '', label: '', type: 'city', country: '', state: '', city: '' })
  }

  const favorites = config.locations.filter((l) => l.favorite)
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
      {favorites.length > 0 && (
        <div className="card">
          <div className="section-title" style={{ margin: '0 0 12px' }}>
            Favorites
          </div>
          <div className="row">
            {favorites.map((l) => (
              <button
                key={l.id}
                className={`chip ${config.activeLocationId === l.id ? 'active' : ''}`}
                onClick={() => call(api.locations.setActive(l.id), `Active: ${l.label}`)}
              >
                <span className="star">★</span>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          All Locations
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Active</th>
                <th>Label</th>
                <th>Type</th>
                <th>Detail</th>
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
                  <td>{l.label}</td>
                  <td className="muted">{l.type}</td>
                  <td className="muted">
                    {[l.city, l.state, l.country, l.region].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td>
                    <button className="btn" onClick={() => call(api.locations.toggleFavorite(l.id), 'Updated favorite')}>
                      {l.favorite ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <input type="checkbox" checked={inCycle(l.id)} onChange={() => toggleCycle(l.id)} />
                  </td>
                  <td>
                    <button className="btn danger" onClick={() => call(api.locations.remove(l.id), `Removed ${l.label}`)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Add Location
        </div>
        <div className="form-grid">
          <label className="field">
            Label
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Austin, TX" />
          </label>
          <label className="field">
            Type
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as TrendingLocation['type'] })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Country
            <input value={draft.country ?? ''} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
          </label>
          <label className="field">
            State / Region
            <input value={draft.state ?? ''} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
          </label>
          <label className="field">
            City
            <input value={draft.city ?? ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={add}>
            Add Location
          </button>
        </div>
      </div>
    </div>
  )
}
