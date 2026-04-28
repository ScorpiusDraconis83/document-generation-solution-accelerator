/**
 * API service for interacting with the Content Generation backend
 * Uses centralized httpClient for consistent fetch handling
 */

import type {
  AgentResponse,
  AppConfig,
  CreativeBrief,
  MessageRequest,
  MessageResponse,
  Product,
} from '../types';
import { httpClient } from '../utils/httpClient';
import { POLLING_CONFIG } from '../utils/constants';

/**
 * Send a message or action to the /api/chat endpoint
 */
export async function sendMessage(
  request: MessageRequest,
  signal?: AbortSignal
): Promise<MessageResponse> {
  return httpClient.post<MessageResponse>('/chat', request, signal);
}

/**
 * Get application configuration including feature flags
 */
export async function getAppConfig(): Promise<AppConfig> {
  return httpClient.get<AppConfig>('/config');
}

/**
 * Request for content generation
 */
export interface GenerateRequest {
  conversation_id: string;
  user_id: string;
  brief: CreativeBrief;
  products: Product[];
  generate_images: boolean;
}

type StageMessageFn = (elapsedSeconds: number) => string;

/**
 * Shared polling loop for task completion
 */
async function* pollLoop(
  taskId: string,
  signal: AbortSignal | undefined,
  getStageMessage: StageMessageFn,
): AsyncGenerator<AgentResponse> {
  const { maxAttempts, intervalMs } = POLLING_CONFIG;
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled by user', 'AbortError');
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
    attempts++;

    if (signal?.aborted) {
      throw new DOMException('Operation cancelled by user', 'AbortError');
    }

    try {
      const statusData = await httpClient.get<{ status: string; result?: unknown; error?: string }>(
        `/generate/status/${taskId}`, signal
      );

      if (statusData.status === 'completed') {
        yield {
          type: 'agent_response',
          content: JSON.stringify(statusData.result),
          is_final: true,
        } as AgentResponse;
        return;
      }

      if (statusData.status === 'failed') {
        throw new Error(statusData.error || 'Task failed');
      }

      // Running — yield heartbeat
      yield {
        type: 'heartbeat',
        content: getStageMessage(attempts),
        elapsed: attempts,
        is_final: false,
      } as AgentResponse;
    } catch (error) {
      // Continue polling on transient errors until max attempts
      if (attempts >= maxAttempts) throw error;
    }
  }

  throw new Error('Task timed out after 10 minutes');
}

/** Stage messages for full content generation */
function generationStageMessage(elapsed: number): string {
  if (elapsed < 10) return 'Analyzing creative brief...';
  if (elapsed < 25) return 'Generating marketing copy...';
  if (elapsed < 35) return 'Creating image prompt...';
  if (elapsed < 55) return 'Generating image with AI...';
  if (elapsed < 70) return 'Running compliance check...';
  return 'Finalizing content...';
}

/** Stage messages for image regeneration */
function regenerationStageMessage(elapsed: number): string {
  if (elapsed < 10) return 'Starting regeneration...';
  if (elapsed < 30) return 'Generating new image...';
  if (elapsed < 50) return 'Processing image...';
  return 'Finalizing...';
}

/**
 * Generate content from a confirmed brief
 */
export async function* streamGenerateContent(
  request: GenerateRequest,
  signal?: AbortSignal
): AsyncGenerator<AgentResponse> {
  const startData = await httpClient.post<{ task_id: string }>('/generate/start', {
    brief: request.brief,
    products: request.products || [],
    generate_images: request.generate_images,
    conversation_id: request.conversation_id,
    user_id: request.user_id || 'anonymous',
  }, signal);

  yield {
    type: 'status',
    content: 'Generation started...',
    is_final: false,
  } as AgentResponse;

  yield* pollLoop(startData.task_id, signal, generationStageMessage);
}

/**
 * Poll for task completion using task_id
 * Used for both content generation and image regeneration
 */
export async function* pollTaskStatus(
  taskId: string,
  signal?: AbortSignal
): AsyncGenerator<AgentResponse> {
  yield* pollLoop(taskId, signal, regenerationStageMessage);
}