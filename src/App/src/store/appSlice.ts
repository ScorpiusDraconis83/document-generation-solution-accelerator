/**
 * App slice - manages application-level state
 * (user info, feature flags, UI toggles)
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { AppConfig } from '../types';
import { getAppConfig } from '../api';
import { httpClient } from '../utils/httpClient';

interface AppState {
  userId: string;
  userName: string;
  imageGenerationEnabled: boolean;
  showChatHistory: boolean;
}

const initialState: AppState = {
  userId: '',
  userName: '',
  imageGenerationEnabled: true,
  showChatHistory: true,
};

export const fetchAppConfig = createAsyncThunk(
  'app/fetchConfig',
  async () => {
    const config: AppConfig = await getAppConfig();
    return config;
  }
);

export const fetchCurrentUser = createAsyncThunk(
  'app/fetchCurrentUser',
  async () => {
    try {
      const payload = await httpClient.fetchExternal<Array<{
        user_claims?: Array<{ typ: string; val: string }>;
      }>>('/.auth/me');
      const userClaims = payload[0]?.user_claims || [];
      const objectIdClaim = userClaims.find(
        (claim) =>
          claim.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier'
      );
      const nameClaim = userClaims.find(
        (claim) => claim.typ === 'name'
      );
      return {
        userId: objectIdClaim?.val || 'anonymous',
        userName: nameClaim?.val || '',
      };
    } catch {
      return { userId: 'anonymous', userName: '' };
    }
  }
);

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    toggleChatHistory(state) {
      state.showChatHistory = !state.showChatHistory;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAppConfig.fulfilled, (state, action) => {
        state.imageGenerationEnabled = action.payload.enable_image_generation;
      })
      .addCase(fetchAppConfig.rejected, (state) => {
        // Default to enabled if config fetch fails
        state.imageGenerationEnabled = true;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.userId = action.payload.userId;
        state.userName = action.payload.userName;
      })
      .addCase(fetchCurrentUser.rejected, (state) => {
        state.userId = 'anonymous';
        state.userName = '';
      });
  },
});

export const { toggleChatHistory } = appSlice.actions;
export default appSlice.reducer;
