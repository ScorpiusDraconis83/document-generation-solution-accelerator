/**
 * Message utilities — ChatMessage factory and formatting helpers.
 *
 * Replaces duplicated `msg()` helpers in useChatOrchestrator and
 * useConversationActions with a single, tested source of truth.
 */
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../types';

/**
 * Create a `ChatMessage` literal with a fresh UUID and ISO timestamp.
 */
export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  agent?: string,
): ChatMessage {
  return {
    id: uuidv4(),
    role,
    content,
    agent,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Assemble a copyable plain-text string from generated text content.
 *
 * Used by `InlineContentPreview` to copy headline + body + tagline
 * to clipboard.
 */
export function formatContentForClipboard(
  textContent?: { headline?: string; body?: string; tagline?: string },
): string {
  if (!textContent) return '';
  return [
    textContent.headline && `✨ ${textContent.headline} ✨`,
    textContent.body,
    textContent.tagline,
  ]
    .filter(Boolean)
    .join('\n\n');
}
