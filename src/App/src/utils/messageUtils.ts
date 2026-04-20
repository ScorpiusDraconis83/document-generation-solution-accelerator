/**
 * Message utility functions for creating ChatMessage objects
 */

import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../types';

export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  agent?: string
): ChatMessage {
  return {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(agent && { agent }),
  };
}

export function createErrorMessage(
  content: string = 'Sorry, there was an error processing your request. Please try again.'
): ChatMessage {
  return createMessage('assistant', content);
}

export function createCancelMessage(
  content: string = 'Generation stopped.'
): ChatMessage {
  return createMessage('assistant', content);
}
