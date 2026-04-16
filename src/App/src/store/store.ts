/**
 * Redux store configuration
 */

import { configureStore } from '@reduxjs/toolkit';
import appReducer from './appSlice';
import chatReducer from './chatSlice';
import contentReducer from './contentSlice';

export const store = configureStore({
  reducer: {
    app: appReducer,
    chat: chatReducer,
    content: contentReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
