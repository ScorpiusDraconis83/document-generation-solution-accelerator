/**
 * Custom hook for conversation action handlers
 * Extracts brief confirm/cancel, product selection, conversation management from App.tsx
 */

import { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  addMessage,
  setConversationId,
  setConversationTitle,
  setMessages,
  resetChat,
} from '../store/chatSlice';
import {
  setPendingBrief,
  setConfirmedBrief,
  setSelectedProducts,
  setAvailableProducts,
  setGeneratedContent,
  resetContent,
} from '../store/contentSlice';
import { sendMessage } from '../api';
import { httpClient } from '../utils/httpClient';
import { createMessage } from '../utils/messageUtils';
import { restoreGeneratedContent } from '../utils/contentParser';
import type { ChatMessage, CreativeBrief, Product } from '../types';

async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  try {
    const data = await httpClient.get<{ products: Product[] }>('/products', signal);
    return data.products || [];
  } catch {
    return [];
  }
}

export function useConversationActions(
  abortControllerRef: React.MutableRefObject<AbortController | null>
) {
  const dispatch = useAppDispatch();
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const productsAbortControllerRef = useRef<AbortController | null>(null);
  const conversationId = useAppSelector(state => state.chat.conversationId);
  const userId = useAppSelector(state => state.app.userId);
  const pendingBrief = useAppSelector(state => state.content.pendingBrief);
  const availableProducts = useAppSelector(state => state.content.availableProducts);
  const selectedProducts = useAppSelector(state => state.content.selectedProducts);

  const handleBriefConfirm = useCallback(async () => {
    if (!pendingBrief) return;

    try {
      const response = await sendMessage({
        conversation_id: conversationId,
        user_id: userId,
        action: 'confirm_brief',
        brief: pendingBrief,
      });

      // Update state based on response
      if (response.action_type === 'brief_confirmed') {
        const brief = response.data?.brief as CreativeBrief | undefined;
        if (brief) {
          dispatch(setConfirmedBrief(brief));
        } else {
          dispatch(setConfirmedBrief(pendingBrief));
        }
        dispatch(setPendingBrief(null));

        // Fetch products separately after confirmation — abort any in-flight fetch first
        productsAbortControllerRef.current?.abort();
        const ac = new AbortController();
        productsAbortControllerRef.current = ac;
        setIsProductsLoading(true);
        try {
          const products = await fetchProducts(ac.signal);
          if (!ac.signal.aborted) {
            dispatch(setAvailableProducts(products));
          }
        } catch {
          // AbortError or network error — ignore
        } finally {
          if (productsAbortControllerRef.current === ac) {
            setIsProductsLoading(false);
          }
        }
      }

      // Add assistant message
      if (response.message) {
        dispatch(addMessage(createMessage('assistant', response.message, 'ProductAgent')));
      }
    } catch {
      // Brief confirmation failed — no action needed
    }
  }, [dispatch, conversationId, userId, pendingBrief]);

  const handleBriefCancel = useCallback(async () => {
    dispatch(setPendingBrief(null));
    dispatch(addMessage(
      createMessage('assistant', 'No problem. Please provide your creative brief again or ask me any questions.')
    ));
  }, [dispatch]);

  const handleProductSelect = useCallback((product: Product) => {
    const isSelected = selectedProducts.some(
      p => (p.sku || p.product_name) === (product.sku || product.product_name)
    );

    if (isSelected) {
      dispatch(setSelectedProducts([]));
    } else {
      // Single selection mode
      dispatch(setSelectedProducts([product]));
    }
  }, [dispatch, selectedProducts]);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [abortControllerRef]);

  const handleSelectConversation = useCallback(async (selectedConversationId: string) => {
    try {
      const data = await httpClient.get<Record<string, unknown>>(`/conversations/${selectedConversationId}?user_id=${encodeURIComponent(userId)}`);
      dispatch(setConversationId(selectedConversationId));
      dispatch(setConversationTitle(null));

      const loadedMessages: ChatMessage[] = ((data.messages as Array<{ role: string; content: string; timestamp?: string; agent?: string }>) || []).map(
        (msg, index: number) => ({
          id: `${selectedConversationId}-${index}`,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: msg.timestamp || new Date().toISOString(),
          agent: msg.agent,
        })
      );
      dispatch(setMessages(loadedMessages));

      // Only set confirmedBrief if the brief was actually confirmed
      const metadata = data.metadata as Record<string, unknown> | undefined;
      const briefWasConfirmed = metadata?.brief_confirmed || data.generated_content;
      if (briefWasConfirmed && data.brief) {
        dispatch(setConfirmedBrief(data.brief as CreativeBrief));
        dispatch(setPendingBrief(null));
      } else if (data.brief) {
        dispatch(setPendingBrief(data.brief as CreativeBrief));
        dispatch(setConfirmedBrief(null));
      } else {
        dispatch(setPendingBrief(null));
        dispatch(setConfirmedBrief(null));
      }

      // Restore availableProducts for product/color name detection
      if (data.brief && availableProducts.length === 0) {
        productsAbortControllerRef.current?.abort();
        const ac = new AbortController();
        productsAbortControllerRef.current = ac;
        setIsProductsLoading(true);
        try {
          const products = await fetchProducts(ac.signal);
          if (!ac.signal.aborted) {
            dispatch(setAvailableProducts(products));
          }
        } catch {
          // AbortError or network error — ignore
        } finally {
          if (productsAbortControllerRef.current === ac) {
            setIsProductsLoading(false);
          }
        }
      }

      if (data.generated_content) {
        const gc = data.generated_content as Record<string, unknown>;
        dispatch(setGeneratedContent(restoreGeneratedContent(gc)));

        const selectedProds = gc.selected_products;
        if (Array.isArray(selectedProds) && selectedProds.length > 0) {
          dispatch(setSelectedProducts(selectedProds as Product[]));
        } else {
          dispatch(setSelectedProducts([]));
        }
      } else {
        dispatch(setGeneratedContent(null));
        dispatch(setSelectedProducts([]));
      }
    } catch {
      // Conversation load failed — no action needed
    }
  }, [dispatch, userId, availableProducts.length]);

  const handleNewConversation = useCallback(() => {
    productsAbortControllerRef.current?.abort();
    productsAbortControllerRef.current = null;
    dispatch(resetChat());
    dispatch(resetContent());
  }, [dispatch]);

  return {
    handleBriefConfirm,
    handleBriefCancel,
    handleProductSelect,
    handleStopGeneration,
    handleSelectConversation,
    handleNewConversation,
    isProductsLoading,
  };
}
