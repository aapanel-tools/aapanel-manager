import {z} from 'zod';
import {DEPLOYMENT_MODES} from '@/lib/version/types';

/** A GitHub owner/repo segment, or empty (feature simply stays "not configured"). */
const ghSegment = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9._-]*$/, 'Letters, digits, dot, dash, underscore only')
  .optional()
  .transform((v) => v ?? '');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

/** Optional http(s) URL → string or null. */
const optionalUrl = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || /^https?:\/\/.+/i.test(v), {message: 'Must be an http(s) URL'});


export const updateSettingsSchema = z.object({
  deploymentMode: z.enum(DEPLOYMENT_MODES),
  githubOwner: ghSegment,
  githubRepo: ghSegment,
  // Blank keeps the stored token; a value replaces it.
  githubToken: z
    .string()
    .max(255)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  // Self-restart: the panel's own aaPanel.
  selfBaseUrl: optionalUrl,
  // Blank keeps the stored api_sk; a value replaces it.
  selfApiKey: z
    .string()
    .max(255)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  // Checked means "self-signed certificate" — the panel's own default — which is
  // pinned on first use. Unchecked means an ordinary certificate to verify.
  selfTlsMode: z.preprocess(
    (v) => (v === true || v === 'true' || v === 'on' || v === '1' ? 'PINNED' : 'VERIFY'),
    z.enum(['PINNED', 'VERIFY']),
  ),
  selfProject: optionalText(64),
  serviceName: optionalText(64),
});

export type UpdateSettingsFormInput = z.infer<typeof updateSettingsSchema>;
