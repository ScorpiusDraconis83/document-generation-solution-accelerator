import { useCallback, type MutableRefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { ChatMessage, GeneratedContent } from '../types';
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

            // Parse text_content if it's a string (from orchestrator)
            let textContent = rawContent.text_content;
            if (typeof textContent === 'string') {
              try {
                textContent = JSON.parse(textContent);
              } catch {
                // Keep as string if not valid JSON
              }
            }

            // Build image_url: prefer blob URL, fallback to base64 data URL
            let imageUrl: string | undefined;
            if (rawContent.image_url) {
              imageUrl = rawContent.image_url;
            } else if (rawContent.image_base64) {
              imageUrl = `data:image/png;base64,${rawContent.image_base64}`;
            }

            const genContent: GeneratedContent = {
              text_content:
                typeof textContent === 'object'
                  ? {
                      headline: textContent?.headline,
                      body: textContent?.body,
                      cta_text: textContent?.cta,
                      tagline: textContent?.tagline,
                    }
                  : undefined,
              image_content:
                imageUrl || rawContent.image_prompt
                  ? {
                      image_url: imageUrl,
                      prompt_used: rawContent.image_prompt,
                      alt_text:
                        rawContent.image_revised_prompt ||
                        'Generated marketing image',
                    }
                  : undefined,
              violations: rawContent.violations || [],
              requires_modification:
                rawContent.requires_modification || false,
              error: rawContent.error,
              image_error: rawContent.image_error,
              text_error: rawContent.text_error,
            };
            dispatch(setGeneratedContent(genContent));
            dispatch(setGenerationStatus(''));
          } catch (parseError) {
            console.error('Error parsing generated content:', parseError);
          }
        } else if (response.type === 'error') {
          dispatch(setGenerationStatus(''));
          const errorMessage: ChatMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: `Error generating content: ${response.content}`,
            timestamp: new Date().toISOString(),
          };
          dispatch(addMessage(errorMessage));
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.debug('Content generation cancelled by user');
        const cancelMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: 'Content generation stopped.',
          timestamp: new Date().toISOString(),
        };
        dispatch(addMessage(cancelMessage));
      } else {
        console.error('Error generating content:', error);
        const errorMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content:
            'Sorry, there was an error generating content. Please try again.',
          timestamp: new Date().toISOString(),
        };
        dispatch(addMessage(errorMessage));
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
