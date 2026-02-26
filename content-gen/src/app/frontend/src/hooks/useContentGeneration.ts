import { useCallback, type MutableRefObject } from 'react';

import { createMessage, buildGeneratedContent } from '../utils';
import {
  useAppDispatch,
  useAppSelector,
  selectConfirmedBrief,
  selectSelectedProducts,
  selectConversationId,
  selectUserId,
  addMessage,
  setIsLoading,
  setGenerationStatus,
  setGeneratedContent,
} from '../store';

/**
 * Handles the full content-generation lifecycle (start → poll → result)
 * and exposes a way to abort the in-flight request.
 *
 * @param abortControllerRef Shared ref so the UI can cancel either
 *        chat-orchestration **or** content-generation with one button.
 */
export function useContentGeneration(
  abortControllerRef: MutableRefObject<AbortController | null>,
) {
  const dispatch = useAppDispatch();
  const confirmedBrief = useAppSelector(selectConfirmedBrief);
  const selectedProducts = useAppSelector(selectSelectedProducts);
  const conversationId = useAppSelector(selectConversationId);
  const userId = useAppSelector(selectUserId);

  /** Kick off polling-based content generation. */
  const generateContent = useCallback(async () => {
    if (!confirmedBrief) return;

    dispatch(setIsLoading(true));
    dispatch(setGenerationStatus('Starting content generation...'));

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const { streamGenerateContent } = await import('../api');

      for await (const response of streamGenerateContent(
        confirmedBrief,
        selectedProducts,
        true,
        conversationId,
        userId,
        signal,
      )) {
        // Heartbeat → update the status bar
        if (response.type === 'heartbeat') {
          const statusMessage = response.content || 'Generating content...';
          const elapsed = (response as { elapsed?: number }).elapsed || 0;
          dispatch(setGenerationStatus(`${statusMessage} (${elapsed}s)`));
          continue;
        }

        if (response.is_final && response.type !== 'error') {
          dispatch(setGenerationStatus('Processing results...'));
          try {
            const rawContent = JSON.parse(response.content);
            const genContent = buildGeneratedContent(rawContent);
            dispatch(setGeneratedContent(genContent));
            dispatch(setGenerationStatus(''));
          } catch (parseError) {
            console.error('Error parsing generated content:', parseError);
          }
        } else if (response.type === 'error') {
          dispatch(setGenerationStatus(''));
          dispatch(addMessage(createMessage(
            'assistant',
            `Error generating content: ${response.content}`,
          )));
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.debug('Content generation cancelled by user');
        dispatch(addMessage(createMessage('assistant', 'Content generation stopped.')));
      } else {
        console.error('Error generating content:', error);
        dispatch(addMessage(createMessage(
          'assistant',
          'Sorry, there was an error generating content. Please try again.',
        )));
      }
    } finally {
      dispatch(setIsLoading(false));
      dispatch(setGenerationStatus(''));
      abortControllerRef.current = null;
    }
  }, [
    confirmedBrief,
    selectedProducts,
    conversationId,
    dispatch,
    userId,
    abortControllerRef,
  ]);

  /** Abort whichever request is currently in-flight. */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, [abortControllerRef]);

  return { generateContent, stopGeneration };
}
