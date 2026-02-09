import { z } from "zod";

// --- Registry API response schemas ---

export const RegistrySkillInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  latestVersion: z.string(),
  author: z.string().optional(),
});

export type RegistrySkillInfo = z.infer<typeof RegistrySkillInfoSchema>;

export const RegistrySearchResultSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  latestVersion: z.string().optional(),
  author: z.string().optional(),
});

export type RegistrySearchResult = z.infer<typeof RegistrySearchResultSchema>;

export const RegistrySearchResponseSchema = z.object({
  results: z.array(RegistrySearchResultSchema),
});

export type RegistrySearchResponse = z.infer<typeof RegistrySearchResponseSchema>;

export const RegistryVersionSchema = z.object({
  version: z.string(),
  createdAt: z.string().optional(),
});

export type RegistryVersion = z.infer<typeof RegistryVersionSchema>;

export const RegistryVersionListSchema = z.object({
  versions: z.array(RegistryVersionSchema),
});

export type RegistryVersionList = z.infer<typeof RegistryVersionListSchema>;

// --- Lock file schemas ---

export const LockEntrySchema = z.object({
  slug: z.string(),
  version: z.string(),
  installedAt: z.string(),
  registryUrl: z.string(),
});

export type LockEntry = z.infer<typeof LockEntrySchema>;

export const LockFileSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), LockEntrySchema),
});

export type LockFile = z.infer<typeof LockFileSchema>;
