import type { GeocodeResult } from '@shared/types'
import type { Logger } from '../logging/Logger'
import { AppError } from '../utils/errors'
import { isNonEmptyString } from '../utils/validation'

/**
 * Resolves a free-text place (e.g. "Austin, TX") into coordinates using the
 * OpenStreetMap Nominatim service (free, no API key). Runs in the main process,
 * so there is no browser CSP constraint. Results feed ReverbNation's local
 * charts API, which is keyed by latitude/longitude.
 */
export class GeocodingService {
  private readonly endpoint = 'https://nominatim.openstreetmap.org/search'

  constructor(private readonly log: Logger) {}

  /** Geocode `query`; returns the best match or throws if none/unreachable. */
  async geocode(query: string): Promise<GeocodeResult> {
    if (!isNonEmptyString(query)) throw new AppError('Enter a location to search', { code: 'VALIDATION' })
    const url = `${this.endpoint}?format=jsonv2&addressdetails=0&limit=1&q=${encodeURIComponent(query.trim())}`

    let data: Array<{ lat: string; lon: string; display_name: string }>
    try {
      const res = await fetch(url, {
        headers: {
          // Nominatim's usage policy requires an identifying User-Agent.
          'User-Agent': 'Reverb-Automation/1.0 (desktop app)',
          Accept: 'application/json'
        }
      })
      if (!res.ok) throw new AppError(`Geocoding failed (HTTP ${res.status})`, { code: 'GEOCODE' })
      data = (await res.json()) as typeof data
    } catch (err) {
      throw new AppError(`Could not reach the geocoding service: ${err instanceof Error ? err.message : String(err)}`, {
        code: 'GEOCODE',
        cause: err
      })
    }

    const hit = data[0]
    if (!hit) throw new AppError(`No location found for "${query}"`, { code: 'GEOCODE_EMPTY' })

    const latitude = Number(hit.lat)
    const longitude = Number(hit.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new AppError('Geocoding returned invalid coordinates', { code: 'GEOCODE' })
    }

    const result: GeocodeResult = { label: hit.display_name, latitude, longitude }
    this.log.info('geocode', `Resolved "${query}" → ${result.label} (${latitude}, ${longitude})`)
    return result
  }
}
