import React, { useEffect, useState } from 'react'
import type { AppConfig, AutomationSettings } from '@shared/types'
import { api, unwrap } from '../api'

/** Numeric/boolean automation settings editor. */
export function SettingsPanel({
  config,
  onChange,
  notify
}: {
  config: AppConfig
  onChange: (c: AppConfig) => void
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
  const [a, setA] = useState<AutomationSettings>(config.automation)
  useEffect(() => setA(config.automation), [config.automation])

  const num =
    (key: keyof AutomationSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>): void =>
      setA({ ...a, [key]: Number(e.target.value) })

  const bool =
    (key: keyof AutomationSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>): void =>
      setA({ ...a, [key]: e.target.checked })

  const save = async (): Promise<void> => {
    try {
      onChange(await unwrap(api.config.save({ ...config, automation: a })))
      notify('Settings saved')
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const reset = async (): Promise<void> => {
    try {
      const c = await unwrap(api.config.reset())
      onChange(c)
      setA(c.automation)
      notify('Settings reset to defaults')
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  return (
    <div className="card">
      <div className="form-grid">
        <Field label="Artists to save">
          <input type="number" min={1} value={a.artistsToSave} onChange={num('artistsToSave')} />
        </Field>
        <Field label="Max pages to scroll">
          <input type="number" min={1} value={a.maxScrollPages} onChange={num('maxScrollPages')} />
        </Field>
        <Field label="Max retries">
          <input type="number" min={0} value={a.maxRetries} onChange={num('maxRetries')} />
        </Field>
        <Field label="Scroll speed (px/step)">
          <input type="number" min={50} value={a.scrollSpeed} onChange={num('scrollSpeed')} />
        </Field>
        <Field label="Concurrent workers">
          <input type="number" min={1} max={8} value={a.concurrentWorkers} onChange={num('concurrentWorkers')} />
        </Field>
        <Field label="Stop after failures (0 = never)">
          <input type="number" min={0} value={a.stopAfterFailures} onChange={num('stopAfterFailures')} />
        </Field>
        <Field label="Click delay min (ms)">
          <input
            type="number"
            min={0}
            value={a.clickDelay.min}
            onChange={(e) => setA({ ...a, clickDelay: { ...a.clickDelay, min: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Click delay max (ms)">
          <input
            type="number"
            min={0}
            value={a.clickDelay.max}
            onChange={(e) => setA({ ...a, clickDelay: { ...a.clickDelay, max: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Random delay min (ms)">
          <input
            type="number"
            min={0}
            value={a.randomDelay.min}
            onChange={(e) => setA({ ...a, randomDelay: { ...a.randomDelay, min: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Random delay max (ms)">
          <input
            type="number"
            min={0}
            value={a.randomDelay.max}
            onChange={(e) => setA({ ...a, randomDelay: { ...a.randomDelay, max: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Max execution time (ms, 0 = ∞)">
          <input type="number" min={0} value={a.maxExecutionTimeMs} onChange={num('maxExecutionTimeMs')} />
        </Field>
        <Field label="Report format">
          <select
            value={a.reportFormat}
            onChange={(e) => setA({ ...a, reportFormat: e.target.value as AutomationSettings['reportFormat'] })}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="xlsx">Excel</option>
          </select>
        </Field>
      </div>

      <div className="section-title">Toggles</div>
      <div className="form-grid">
        <Toggle label="Receive updates automatically" checked={a.receiveUpdates} onChange={bool('receiveUpdates')} />
        <Toggle
          label="Cycle through multiple locations"
          checked={a.cycleLocations}
          onChange={bool('cycleLocations')}
        />
        <Toggle label="Headless mode" checked={a.headless} onChange={bool('headless')} />
        <Toggle label="Resume previous session" checked={a.resumePreviousSession} onChange={bool('resumePreviousSession')} />
        <Toggle label="Export report on finish" checked={a.exportReportOnFinish} onChange={bool('exportReportOnFinish')} />
      </div>

      <div className="btn-row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={save}>
          Save Settings
        </button>
        <button className="btn" onClick={reset}>
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}): React.JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  )
}
