/**
 * Chat slice - manages conversation and messaging state
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../types';

interface ChatState {
  conversationId: string;
  conversationTitle: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  generationStatus: string;
  historyRefreshTrigger: number;
}

const initialState: ChatState = {
  conversationId: uuidv4(),
  conversationTitle: null,
  messages: [],
  isLoading: false,
  generationStatus: '',
  historyRefreshTrigger: 0,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setConversationId(state, action: PayloadAction<string>) {
      state.conversationId = action.payload;
    },
    setConversationTitle(state, action: PayloadAction<string | null>) {
      state.conversationTitle = action.payload;
    },
    addMessage(state, action: PayloadAction<ChatMessage>) {
      state.messages.push(action.payload);
    },
    setMessages(state, action: PayloadAction<ChatMessage[]>) {
      state.messages = action.payload;
    },
    setIsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setGenerationStatus(state, action: PayloadAction<string>) {
      state.generationStatus = action.payload;
    },
    incrementHistoryRefresh(state) {
      state.historyRefreshTrigger += 1;
    },
    resetChat(state) {
      state.conversationId = uuidv4();
      state.conversationTitle = null;
      state.messages = [];
      state.isLoading = false;
      state.generationStatus = '';
    },
  },
});

export const {
  setConversationId,
  setConversationTitle,
  addMessage,
  setMessages,
  setIsLoading,
  setGenerationStatus,
  incrementHistoryRefresh,
  resetChat,
} = chatSlice.actions;

export default chatSlice.reducer;
