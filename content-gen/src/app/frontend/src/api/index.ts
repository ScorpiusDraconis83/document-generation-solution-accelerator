/**
 * API service for interacting with the Content Generation backend
 */

import type {
  CreativeBrief,
  Product,
  AgentResponse,
  ParsedBriefResponse,
  AppConfig,
} from '../types';
import httpClient from './httpClient';
import { parseSSEStream, getGenerationStage } from '../utils';

/**
 * Get application configuration including feature flags
 */
export async function getAppConfig(): Promise<AppConfig> {
  return httpClient.get<AppConfig>('/config');
}

/**
 * Parse a free-text creative brief into structured format
 */
export async function parseBrief(
  briefText: string,
  conversationId?: string,
  userId?: string,
  signal?: AbortSignal
): Promise<ParsedBriefResponse> {
  return httpClient.post<ParsedBriefResponse>('/brief/parse', {
    brief_text: briefText,
    conversation_id: conversationId,
    user_id: userId || 'anonymous',
  }, { signal });
}

/**
 * Confirm a parsed creative brief
 */
export async function confirmBrief(
  brief: CreativeBrief,
  conversationId?: string,
  userId?: string
): Promise<{ status: string; conversation_id: string; brief: CreativeBrief }> {
  return httpClient.post('/brief/confirm', {
    brief,
    conversation_id: conversationId,
    user_id: userId || 'anonymous',
  });
}

/**
 * Select or modify products via natural language
 */
export async function selectProducts(
  request: string,
  currentProducts: Product[],
  conversationId?: string,
  userId?: string,
  signal?: AbortSignal
): Promise<{ products: Product[]; action: string; message: string; conversation_id: string }> {
  return httpClient.post('/products/select', {
    request,
    current_products: currentProducts,
    conversation_id: conversationId,
    user_id: userId || 'anonymous',
  }, { signal });
}

/**
 * Stream chat messages from the agent orchestration
 */
export async function* streamChat(
  message: string,
  conversationId?: string,
  userId?: string,
  signal?: AbortSignal
): AsyncGenerator<AgentResponse> {
  const response = await httpClient.raw('/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      user_id: userId || 'anonymous',
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  yield* parseSSEStream(reader);
}

/**
 * Generate content from a confirmed brief
 */
export async function* streamGenerateContent(
  brief: CreativeBrief,
  products?: Product[],
  generateImages: boolean = true,
  conversationId?: string,
  userId?: string,
  signal?: AbortSignal
): AsyncGenerator<AgentResponse> {
  // Use polling-based approach for reliability with long-running tasks
  const startData = await httpClient.post<{ task_id: string }>('/generate/start', {
    brief,
    products: products || [],
    generate_images: generateImages,
    conversation_id: conversationId,
    user_id: userId || 'anonymous',
  }, { signal });
  const taskId = startData.task_id;
  
  // Yield initial status
  yield {
    type: 'status',
    content: 'Generation started...',
    is_final: false,
  } as AgentResponse;
  
  // Poll for completion
  let attempts = 0;
  const maxAttempts = 600; // 10 minutes max with 1-second polling (image generation can take 3-5 min)
  const pollInterval = 1000; // 1 second
  
  while (attempts < maxAttempts) {
    // Check if cancelled before waiting
    if (signal?.aborted) {
      throw new DOMException('Generation cancelled by user', 'AbortError');
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
    
    // Check if cancelled after waiting
    if (signal?.aborted) {
      throw new DOMException('Generation cancelled by user', 'AbortError');
    }
    
    try {
      const statusData = await httpClient.get<{ status: string; result?: unknown; error?: string }>(
        `/generate/status/${taskId}`,
        { signal },
      );
      
      if (statusData.status === 'completed') {
        // Yield the final result
        yield {
          type: 'agent_response',
          content: JSON.stringify(statusData.result),
          is_final: true,
        } as AgentResponse;
        return;
      } else if (statusData.status === 'failed') {
        throw new Error(statusData.error || 'Generation failed');
      } else if (statusData.status === 'running') {
        const elapsedSeconds = attempts;
        const { stage, message: stageMessage } = getGenerationStage(elapsedSeconds);
        
        // Send status update every second for smoother progress
        yield {
          type: 'heartbeat',
          content: stageMessage,
          count: stage,
          elapsed: elapsedSeconds,
          is_final: false,
        } as AgentResponse;
      }
    } catch (error) {
      // Continue polling on transient errors
      if (attempts >= maxAttempts) {
        throw error;
      }
    }
  }
  
  throw new Error('Generation timed out after 10 minutes');
}
/**
 * Regenerate image with a modification request
 * Used when user wants to change the generated image after initial content generation
 */
export async function* streamRegenerateImage(
  modificationRequest: string,
  brief: CreativeBrief,
  products?: Product[],
  previousImagePrompt?: string,
  conversationId?: string,
  userId?: string,
  signal?: AbortSignal
): AsyncGenerator<AgentResponse> {
  const response = await httpClient.raw('/regenerate', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modification_request: modificationRequest,
      brief,
      products: products || [],
      previous_image_prompt: previousImagePrompt,
      conversation_id: conversationId,
      user_id: userId || 'anonymous',
    }),
  });

  if (!response.ok) {
    throw new Error(`Regeneration request failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  yield* parseSSEStream(reader);
}