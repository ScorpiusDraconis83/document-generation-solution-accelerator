/**
 * Custom hook for chat message orchestration
 * Extracts handleSendMessage logic from App.tsx
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  addMessage,
  setIsLoading,
  setGenerationStatus,
  incrementHistoryRefresh,
  setConversationTitle,
} from '../store/chatSlice';
import {
  setPendingBrief,
  setConfirmedBrief,
  setSelectedProducts,
  setAvailableProducts,
  setGeneratedContent,
} from '../store/contentSlice';
import { sendMessage, pollTaskStatus } from '../api';
import { createMessage, createErrorMessage, createCancelMessage } from '../utils/messageUtils';
import { parseEventContent, mergeRegenerationResult } from '../utils/contentParser';
import type { CreativeBrief, Product, GeneratedContent } from '../types';

export function useChatOrchestrator(
  abortControllerRef: React.MutableRefObject<AbortController | null>
) {
  const dispatch = useAppDispatch();
  const conversationId = useAppSelector(state => state.chat.conversationId);
  const conversationTitle = useAppSelector(state => state.chat.conversationTitle);
  const userId = useAppSelector(state => state.app.userId);
  const confirmedBrief = useAppSelector(state => state.content.confirmedBrief);
  const selectedProducts = useAppSelector(state => state.content.selectedProducts);
  const availableProducts = useAppSelector(state => state.content.availableProducts);
  const generatedContent = useAppSelector(state => state.content.generatedContent);

  const handleSendMessage = useCallback(async (content: string) => {
    const userMessage = createMessage('user', content);
    dispatch(addMessage(userMessage));
    dispatch(setIsLoading(true));
    dispatch(setGenerationStatus('Processing your request...'));

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      let productsToSend = selectedProducts;
      if (generatedContent && confirmedBrief && availableProducts.length > 0) {
        const contentLower = content.toLowerCase();
        const mentionedProduct = availableProducts.find(p =>
          contentLower.includes(p.product_name.toLowerCase())
        );
        if (mentionedProduct && mentionedProduct.product_name !== selectedProducts[0]?.product_name) {
          productsToSend = [mentionedProduct];
        }
      }

      // Send message with context
      const response = await sendMessage({
        conversation_id: conversationId,
        user_id: userId,
        message: content,
        ...(confirmedBrief && { brief: confirmedBrief }),
        ...(productsToSend.length > 0 && { selected_products: productsToSend }),
        ...(generatedContent && { has_generated_content: true }),
      }, signal);

      // Handle response based on action_type
      switch (response.action_type) {
        case 'brief_parsed': {
          const brief = response.data?.brief as CreativeBrief | undefined;
          const title = response.data?.generated_title as string | undefined;
          if (brief) dispatch(setPendingBrief(brief));
          if (title && !conversationTitle) dispatch(setConversationTitle(title));
          break;
        }

        case 'clarification_needed': {
          const brief = response.data?.brief as CreativeBrief | undefined;
          if (brief) dispatch(setPendingBrief(brief));
          break;
        }

        case 'brief_confirmed': {
          const brief = response.data?.brief as CreativeBrief | undefined;
          const products = response.data?.products as Product[] | undefined;
          if (brief) {
            dispatch(setConfirmedBrief(brief));
            dispatch(setPendingBrief(null));
          }
          if (products) dispatch(setAvailableProducts(products));
          break;
        }

        case 'products_selected': {
          const products = response.data?.products as Product[] | undefined;
          if (products) dispatch(setSelectedProducts(products));
          break;
        }

        case 'content_generated':
        case 'image_regenerated': {
          const gc = response.data?.generated_content as GeneratedContent | undefined;
          if (gc) dispatch(setGeneratedContent(gc));
          break;
        }

        case 'regeneration_started': {
          const taskId = response.data?.task_id as string;
          if (!taskId) throw new Error('No task_id received for regeneration');

          dispatch(setGenerationStatus('Regenerating image...'));

          for await (const event of pollTaskStatus(taskId, signal)) {
            if (event.type === 'heartbeat') {
              const statusMessage = (event.content as string) || 'Regenerating image...';
              const elapsed = (event as { elapsed?: number }).elapsed || 0;
              dispatch(setGenerationStatus(elapsed > 0 ? `${statusMessage} (${elapsed}s)` : statusMessage));
            } else if (event.type === 'agent_response' && event.is_final) {
              const result = parseEventContent(event.content);

              // Update selected products if backend provided new ones
              const newProducts = result?.selected_products as Product[] | undefined;
              if (newProducts && newProducts.length > 0) {
                dispatch(setSelectedProducts(newProducts));
              }

              // Update confirmed brief if backend provided an updated one
              const updatedBrief = result?.updated_brief as CreativeBrief | undefined;
              if (updatedBrief) dispatch(setConfirmedBrief(updatedBrief));

              // Merge regeneration result with existing generated content
              dispatch(setGeneratedContent(mergeRegenerationResult(result, generatedContent)));
            } else if (event.type === 'error') {
              throw new Error(event.content || 'Regeneration failed');
            }
          }

          dispatch(setGenerationStatus(''));
          break;
        }

        case 'start_over': {
          dispatch(setPendingBrief(null));
          dispatch(setConfirmedBrief(null));
          dispatch(setSelectedProducts([]));
          dispatch(setGeneratedContent(null));
          break;
        }

        case 'rai_blocked':
        case 'error':
        case 'chat_response':
        default:
          break;
      }

      // Add assistant message from response
      if (response.message) {
        dispatch(addMessage(createMessage('assistant', response.message)));
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        dispatch(addMessage(createCancelMessage()));
      } else {
        dispatch(addMessage(createErrorMessage()));
      }
    } finally {
      dispatch(setIsLoading(false));
      dispatch(setGenerationStatus(''));
      abortControllerRef.current = null;
      dispatch(incrementHistoryRefresh());
    }
  }, [
    dispatch, conversationId, userId, conversationTitle,
    confirmedBrief, selectedProducts, generatedContent,
    availableProducts, abortControllerRef,
  ]);

  return { handleSendMessage };
}
