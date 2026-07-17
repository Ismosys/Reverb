import { z } from 'zod'

/**
 * Zod schemas mirror the shared TypeScript types and are the runtime source of
 * truth for validating both on-disk config and IPC payloads.
 */

const delayRange = z
  .object({ min: z.number().min(0), max: z.number().min(0) })
  .refine((r) => r.max >= r.min, { message: 'max must be >= min' })

export const automationSchema = z.object({
  artistsToSave: z.number().int().min(1).max(10000),
  receiveUpdates: z.boolean(),
  maxScrollPages: z.number().int().min(1).max(500),
  maxRetries: z.number().int().min(0).max(20),
  scrollSpeed: z.number().int().min(50).max(5000),
  clickDelay: delayRange,
  headless: z.boolean(),
  concurrentWorkers: z.number().int().min(1).max(8),
  randomDelay: delayRange,
  maxExecutionTimeMs: z.number().int().min(0),
  resumePreviousSession: z.boolean(),
  stopAfterFailures: z.number().int().min(0).max(1000),
  cycleLocations: z.boolean(),
  turbo: z.boolean(),
  exportReportOnFinish: z.boolean(),
  reportFormat: z.enum(['csv', 'json', 'xlsx'])
})

export const locationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['global', 'custom']),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  query: z.string().optional(),
  favorite: z.boolean().optional()
})

export const pathsSchema = z.object({
  databasePath: z.string(),
  browserProfilePath: z.string(),
  reportsPath: z.string(),
  logsPath: z.string()
})

export const siteSchema = z.object({
  baseUrl: z.string().url(),
  chartsPath: z.string(),
  loginPath: z.string(),
  loggedInIndicator: z.string(),
  loggedOutIndicator: z.string()
})

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string()
})

export const appConfigSchema = z.object({
  automation: automationSchema,
  activeLocationId: z.string().nullable(),
  locations: z.array(locationSchema),
  cycleLocationIds: z.array(z.string()),
  profiles: z.array(profileSchema).min(1),
  activeProfileId: z.string().min(1),
  paths: pathsSchema,
  site: siteSchema
})

export type ValidatedConfig = z.infer<typeof appConfigSchema>
