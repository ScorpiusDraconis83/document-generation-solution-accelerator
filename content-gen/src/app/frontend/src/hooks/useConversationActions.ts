import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { ChatMessage, Product, CreativeBrief, GeneratedContent } from '../types';
import httpClient from '../api/httpClient';
import {
  useAppDispatch,
  useAppSelector,
  selectUserId,
  selectConversationId,
  selectPendingBrief,
  selectSelectedProducts,
  resetChat,
  resetContent,
  setConversationId,
  setConversationTitle,
  setMessages,
  addMessage,
  setPendingBrief,
  setConfirmedBrief,
  setAwaitingClarification,
  setSelectedProducts,
  setAvailableProducts,
  setGeneratedContent,
  toggleChatHistory,
} from '../store';

/* ------------------------------------------------------------------ */
/*  Helper: create a ChatMessage literal                               */
/* ------------------------------------------------------------------ */
function msg(
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

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Encapsulates every conversation-level user action:
 *
 *  - Loading a saved conversation from history
 *  - Starting a brand-new conversation
 *  - Confirming / cancelling a creative brief
 *  - Starting over with products
 *  - Toggling a product selection
 *  - Toggling the chat-history sidebar
 *
 * All Redux reads/writes are internal so the consumer stays declarative.
 */
export function useConversationActions() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector(selectUserId);
  const conversationId = useAppSelector(selectConversationId);
  const pendingBrief = useAppSelector(selectPendingBrief);
  const selectedProducts = useAppSelector(selectSelectedProducts);

  /* ------------------------------------------------------------ */
  /*  Select (load) a conversation from history                    */
  /* ------------------------------------------------------------ */
  const selectConversation = useCallback(
    async (selectedConversationId: string) => {
      try {
        const data = await httpClient.get<{
          messages?: {
            role: string;
            content: string;
            timestamp?: string;
            agent?: string;
          }[];
          brief?: unknown;
          generated_content?: Record<string, unknown>;
        }>(`/conversations/${selectedConversationId}`, {
          params: { user_id: userId },
        });

        dispatch(setConversationId(selectedConversationId));
        dispatch(setConversationTitle(null)); // Will use title from conversation list

        const loadedMessages: ChatMessage[] = (data.messages || []).map(
          (m, index) => ({
            id: `${selectedConversationId}-${index}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp || new Date().toISOString(),
            agent: m.agent,
          }),
        );
        dispatch(setMessages(loadedMessages));
        dispatch(setPendingBrief(null));
        dispatch(setAwaitingClarification(false));
        dispatch(
          setConfirmedBrief(
            (data.brief as CreativeBrief) || null,
          ),
        );

        // Restore availableProducts so product/color name detection works
        // when regenerating images in a restored conversation
        if (data.brief) {
          try {
            const productsData = await httpClient.get<{
              products?: Product[];
            }>('/products');
            dispatch(setAvailableProducts(productsData.products || []));
          } catch (err) {
            console.error(
              'Error loading products for restored conversation:',
              err,
            );
          }
        }

        if (data.generated_content) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gc = data.generated_content as any;
          let textContent = gc.text_content;
          if (typeof textContent === 'string') {
            try {
              textContent = JSON.parse(textContent);
            } catch {
              // keep as-is
            }
          }

          let imageUrl: string | undefined = gc.image_url;
          if (imageUrl && imageUrl.includes('blob.core.windows.net')) {
            const parts = imageUrl.split('/');
            const filename = parts[parts.length - 1];
            const convId = parts[parts.length - 2];
            imageUrl = `/api/images/${convId}/${filename}`;
          }
          if (!imageUrl && gc.image_base64) {
            imageUrl = `data:image/png;base64,${gc.image_base64}`;
          }

          const restoredContent: GeneratedContent = {
            text_content:
              typeof textContent === 'object' && textContent
                ? {
                    headline: textContent?.headline,
                    body: textContent?.body,
                    cta_text: textContent?.cta,
                    tagline: textContent?.tagline,
                  }
                : undefined,
            image_content:
              imageUrl || gc.image_prompt
                ? {
                    image_url: imageUrl,
                    prompt_used: gc.image_prompt,
                    alt_text:
                      gc.image_revised_prompt ||
                      'Generated marketing image',
                  }
                : undefined,
            violations: gc.violations || [],
            requires_modification: gc.requires_modification || false,
            error: gc.error,
            image_error: gc.image_error,
            text_error: gc.text_error,
          };
          dispatch(setGeneratedContent(restoredContent));

          if (
            gc.selected_products &&
            Array.isArray(gc.selected_products)
          ) {
            dispatch(setSelectedProducts(gc.selected_products));
          } else {
            dispatch(setSelectedProducts([]));
          }
        } else {
          dispatch(setGeneratedContent(null));
          dispatch(setSelectedProducts([]));
        }
      } catch (error) {
        console.error('Error loading conversation:', error);
      }
    },
    [userId, dispatch],
  );

  /* ------------------------------------------------------------ */
  /*  Start a new conversation                                     */
  /* ------------------------------------------------------------ */
  const newConversation = useCallback(() => {
    dispatch(resetChat());
    dispatch(resetContent());
  }, [dispatch]);

  /* ------------------------------------------------------------ */
  /*  Brief lifecycle                                              */
  /* ------------------------------------------------------------ */
  const confirmBrief = useCallback(async () => {
    if (!pendingBrief) return;

    try {
      const { confirmBrief: confirmBriefApi } = await import('../api');
      await confirmBriefApi(pendingBrief, conversationId, userId);
      dispatch(setConfirmedBrief(pendingBrief));
      dispatch(setPendingBrief(null));
      dispatch(setAwaitingClarification(false));

      const productsData = await httpClient.get<{ products?: Product[] }>(
        '/products',
      );
      dispatch(setAvailableProducts(productsData.products || []));

      dispatch(
        addMessage(
          msg(
            'assistant',
            "Great! Your creative brief has been confirmed. Here are the available products for your campaign. Select the ones you'd like to feature, or tell me what you're looking for.",
            'ProductAgent',
          ),
        ),
      );
    } catch (error) {
      console.error('Error confirming brief:', error);
    }
  }, [conversationId, userId, pendingBrief, dispatch]);

  const cancelBrief = useCallback(() => {
    dispatch(setPendingBrief(null));
    dispatch(setAwaitingClarification(false));
    dispatch(
      addMessage(
        msg(
          'assistant',
          'No problem. Please provide your creative brief again or ask me any questions.',
        ),
      ),
    );
  }, [dispatch]);

  /* ------------------------------------------------------------ */
  /*  Product actions                                              */
  /* ------------------------------------------------------------ */
  const productsStartOver = useCallback(() => {
    dispatch(setSelectedProducts([]));
    dispatch(setConfirmedBrief(null));
    dispatch(
      addMessage(
        msg(
          'assistant',
          'Starting over. Please provide your creative brief to begin a new campaign.',
        ),
      ),
    );
  }, [dispatch]);

  const selectProduct = useCallback(
    (product: Product) => {
      const isSelected = selectedProducts.some(
        (p) =>
          (p.sku || p.product_name) ===
          (product.sku || product.product_name),
      );
      if (isSelected) {
        dispatch(setSelectedProducts([]));
      } else {
        // Single selection mode — replace any existing selection
        dispatch(setSelectedProducts([product]));
      }
    },
    [selectedProducts, dispatch],
  );

  /* ------------------------------------------------------------ */
  /*  Sidebar toggle                                               */
  /* ------------------------------------------------------------ */
  const toggleHistory = useCallback(() => {
    dispatch(toggleChatHistory());
  }, [dispatch]);

  return {
    selectConversation,
    newConversation,
    confirmBrief,
    cancelBrief,
    productsStartOver,
    selectProduct,
    toggleHistory,
  };
}
