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
  userEmail: string;
  imageGenerationEnabled: boolean;
  showChatHistory: boolean;
}

const initialState: AppState = {
  userId: '',
  userName: '',
  userEmail: '',
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

type AuthClaim = { typ: string; val: string };
type AuthPayload = Array<{ user_id: string; user_claims: AuthClaim[] }>;

export const fetchCurrentUser = createAsyncThunk(
  'app/fetchCurrentUser',
  async () => {
    try {
      const payload = await httpClient.fetchExternal<AuthPayload>('/.auth/me');

      const userClaims = payload[0]?.user_claims || [];
      const objectIdClaim = userClaims.find(
        (claim) =>
          claim.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier'
      );
      const nameClaim = userClaims.find(
        (claim) => claim.typ === 'name'
      );
      
      // Search each email claim type individually for reliability
      let emailVal = '';
      for (const claim of userClaims) {
        if (claim.typ === 'preferred_username' || 
            claim.typ === 'email' ||
            claim.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
            claim.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn') {
          emailVal = claim.val;
          break;
        }
      }
      
      const userData = {
        userId: objectIdClaim?.val || 'anonymous',
        userName: nameClaim?.val || '',
        userEmail: emailVal,
      };
      
      return userData;
    } catch (error) {
      return { userId: 'anonymous', userName: '', userEmail: '' };
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
        state.userEmail = action.payload.userEmail;
      })
      .addCase(fetchCurrentUser.rejected, (state) => {
        state.userId = 'anonymous';
        state.userName = '';
        state.userEmail = '';
      });
  },
});

export const { toggleChatHistory } = appSlice.actions;
export default appSlice.reducer;
