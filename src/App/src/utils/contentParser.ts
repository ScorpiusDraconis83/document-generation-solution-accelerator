/**
 * Content parsing utilities for processing API responses
 */

import type { GeneratedContent } from '../types';
import { PRODUCT_DEFAULTS } from './constants';

/**
 * Convert Azure blob storage URLs to proxy API URLs
 */
export function convertBlobUrl(imageUrl: string): string {
  if (imageUrl && imageUrl.includes('blob.core.windows.net')) {
    const parts = imageUrl.split('/');
    const filename = parts[parts.length - 1];
    const convId = parts[parts.length - 2];
    return `/api/images/${convId}/${filename}`;
  }
  return imageUrl;
}

/**
 * Parse text_content which may be a JSON string or object
 */
export function parseTextContent(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw as Record<string, unknown> | undefined;
}

/**
 * Parse event content string to result object
 */
export function parseEventContent(content: string | unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return (content as Record<string, unknown>) || {};
}

/**
 * Parse the final agent response into a GeneratedContent object
 */
export function parseGeneratedContent(result: Record<string, unknown>): GeneratedContent {
  let imageUrl = result?.image_url as string | undefined;
  if (imageUrl) {
    imageUrl = convertBlobUrl(imageUrl);
  }

  const textContent = parseTextContent(result?.text_content);

  return {
    text_content: textContent ? {
      headline: textContent.headline as string | undefined,
      body: textContent.body as string | undefined,
      cta_text: textContent.cta as string | undefined,
    } : {
      headline: result?.headline as string | undefined,
      body: result?.body as string | undefined,
      cta_text: result?.cta as string | undefined,
    },
    image_content: imageUrl ? {
      image_url: imageUrl,
      prompt_used: result?.image_prompt as string | undefined,
      alt_text: (result?.image_revised_prompt as string) || PRODUCT_DEFAULTS.fallbackAltText,
    } : undefined,
    violations: (result?.violations as unknown as GeneratedContent['violations']) || [],
    requires_modification: (result?.requires_modification as boolean) || false,
  };
}

/**
 * Merge a regeneration result into existing generated content.
 * Keeps existing text/image if not present in the new result.
 */
export function mergeRegenerationResult(
  result: Record<string, unknown>,
  existing: GeneratedContent | null,
): GeneratedContent {
  const parsed = parseGeneratedContent(result);
  return {
    text_content: parsed.text_content?.headline ? parsed.text_content : existing?.text_content,
    image_content: parsed.image_content || existing?.image_content,
    violations: existing?.violations || [],
    requires_modification: existing?.requires_modification || false,
  };
}

/**
 * Restore GeneratedContent from a persisted conversation payload.
 * Handles image_base64, tagline, error fields etc. that aren't in the live generation path.
 */
export function restoreGeneratedContent(gc: Record<string, unknown>): GeneratedContent {
  let textContent = gc.text_content;
  if (typeof textContent === 'string') {
    textContent = parseTextContent(textContent);
  }

  let imageUrl = gc.image_url as string | undefined;
  if (imageUrl) imageUrl = convertBlobUrl(imageUrl);
  if (!imageUrl && gc.image_base64) {
    imageUrl = `data:image/png;base64,${gc.image_base64}`;
  }

  const tc = textContent as Record<string, unknown> | undefined;

  return {
    text_content: tc ? {
      headline: tc.headline as string | undefined,
      body: tc.body as string | undefined,
      cta_text: tc.cta as string | undefined,
      tagline: tc.tagline as string | undefined,
    } : undefined,
    image_content: (imageUrl || gc.image_prompt) ? {
      image_url: imageUrl,
      prompt_used: gc.image_prompt as string | undefined,
      alt_text: (gc.image_revised_prompt as string) || PRODUCT_DEFAULTS.fallbackAltText,
    } : undefined,
    violations: (gc.violations as GeneratedContent['violations']) || [],
    requires_modification: (gc.requires_modification as boolean) || false,
    error: gc.error as string | undefined,
    image_error: gc.image_error as string | undefined,
    text_error: gc.text_error as string | undefined,
  };
}
