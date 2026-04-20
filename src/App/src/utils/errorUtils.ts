/** Content filter detection patterns */
const FILTER_PATTERNS = [
  'content_filter', 'contentfilter', 'content management policy',
  'responsibleai', 'responsible_ai_policy', 'content filtering',
  'filtered', 'safety system', 'self_harm', 'sexual', 'violence', 'hate',
];

/** Check if an error message indicates a content safety filter was triggered */
export function isContentFilterError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return FILTER_PATTERNS.some(pattern => lower.includes(pattern));
}

/** Get a user-friendly title + description for an error */
export function getErrorMessage(errorMessage?: string): { title: string; description: string } {
  if (isContentFilterError(errorMessage)) {
    return {
      title: 'Content Filtered',
      description: 'Your request was blocked by content safety filters. Please try modifying your creative brief.',
    };
  }
  return {
    title: 'Generation Failed',
    description: errorMessage || 'An error occurred. Please try again.',
  };
}

/** Copy text to the clipboard, silently swallowing errors */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {
    // Clipboard write failed — no action needed
  });
}
