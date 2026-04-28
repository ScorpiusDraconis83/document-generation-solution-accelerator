/**
 * Shared constants used across components
 */

import type { CreativeBrief } from '../types';

/** Canonical field display order and labels for CreativeBrief */
export const BRIEF_FIELD_CONFIG: { key: keyof CreativeBrief; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'target_audience', label: 'Target Audience' },
  { key: 'key_message', label: 'Key Message' },
  { key: 'tone_and_style', label: 'Tone & Style' },
  { key: 'visual_guidelines', label: 'Visual Guidelines' },
  { key: 'deliverable', label: 'Deliverable' },
  { key: 'timelines', label: 'Timelines' },
  { key: 'cta', label: 'Call to Action' },
];

/** All brief field keys in display order */
export const BRIEF_FIELD_KEYS: (keyof CreativeBrief)[] = BRIEF_FIELD_CONFIG.map(f => f.key);

/** Map from field key to label */
export const BRIEF_FIELD_LABELS: Record<keyof CreativeBrief, string> = Object.fromEntries(
  BRIEF_FIELD_CONFIG.map(f => [f.key, f.label])
) as Record<keyof CreativeBrief, string>;

/** Default product fallback values */
export const PRODUCT_DEFAULTS = {
  fallbackTags: 'soft white, airy, minimal, fresh',
  fallbackPrice: 59.95,
  fallbackAltText: 'Generated marketing image',
} as const;

/** Polling configuration for content generation */
export const POLLING_CONFIG = {
  maxAttempts: 600,
  intervalMs: 1000,
} as const;

/** Standard AI disclaimer shown in multiple components */
export const AI_DISCLAIMER = 'AI-generated content may be incorrect';
