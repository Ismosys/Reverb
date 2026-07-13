import type { ReverbApi } from './index'

declare global {
  interface Window {
    reverb: ReverbApi
  }
}

export {}
