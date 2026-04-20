/**
 * Custom hook for content generation orchestration
 * Extracts handleGenerateContent logic from App.tsx
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  addMessage,
  setIsLoading,
  setGenerationStatus,
} from '../store/chatSlice';
import { setGeneratedContent } from '../store/contentSlice';
import { streamGenerateContent } from '../api';
import { createErrorMessage, createCancelMessage } from '../utils/messageUtils';
import { parseGeneratedContent, parseEventContent } from '../utils/contentParser';

export function useContentGeneration(
  abortControllerRef: React.MutableRefObject<AbortController | null>
) {
  const dispatch = useAppDispatch();
  const conversationId = useAppSelector(state => state.chat.conversationId);
  const userId = useAppSelector(state => state.app.userId);
  const confirmedBrief = useAppSelector(state => state.content.confirmedBrief);
  const selectedProducts = useAppSelector(state => state.content.selectedProducts);
  const imageGenerationEnabled = useAppSelector(state => state.app.imageGenerationEnabled);

  const handleGenerateContent = useCallback(async () => {
    if (!confirmedBrief) return;

    dispatch(setIsLoading(true));
    dispatch(setGenerationStatus('Starting content generation...'));

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      for await (const event of streamGenerateContent({
        conversation_id: conversationId,
        user_id: userId,
        brief: confirmedBrief,
        products: selectedProducts,
        generate_images: imageGenerationEnabled,
      }, signal)) {

        if (event.type === 'heartbeat') {
          const statusMessage = (event.content as string) || 'Generating content...';
          const elapsed = (event as { elapsed?: number }).elapsed || 0;
          dispatch(setGenerationStatus(elapsed > 0 ? `${statusMessage} (${elapsed}s)` : statusMessage));
        } else if (event.type === 'agent_response' && event.is_final) {
          const result = parseEventContent(event.content);
          const generated = parseGeneratedContent(result);
          dispatch(setGeneratedContent(generated));
        } else if (event.type === 'error') {
          throw new Error(event.content || 'Generation failed');
        }
      }

      dispatch(setGenerationStatus(''));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        dispatch(addMessage(createCancelMessage('Content generation stopped.')));
      } else {
        dispatch(addMessage(createErrorMessage('Sorry, there was an error generating content. Please try again.')));
      }
    } finally {
      dispatch(setIsLoading(false));
      dispatch(setGenerationStatus(''));
      abortControllerRef.current = null;
    }
  }, [dispatch, confirmedBrief, selectedProducts, conversationId, userId, imageGenerationEnabled, abortControllerRef]);

  return { handleGenerateContent };
}
