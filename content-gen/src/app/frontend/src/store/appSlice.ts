/**
 * App slice — application-level state (user info, config, feature flags, UI toggles).
 * createSlice + createAsyncThunk replaces manual dispatch + string constants.
 * Granular selectors — each component subscribes only to the state it needs.
 */
import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';

/* ------------------------------------------------------------------ */
/*  Async Thunks                                                      */
/* ------------------------------------------------------------------ */

export const fetchAppConfig = createAsyncThunk(
  'app/fetchAppConfig',
  async () => {
    const { getAppConfig } = await import('../api');
    const config = await getAppConfig();
    return config;
  },
);

export const fetchUserInfo = createAsyncThunk(
  'app/fetchUserInfo',
  async () => {
    const response = await fetch('/.auth/me');
    if (!response.ok) return { userId: 'anonymous', userName: '' };

    const payload = await response.json();
    const claims: { typ: string; val: string }[] = payload[0]?.user_claims || [];

    const objectId = claims.find(
      (c) => c.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier',
    )?.val || 'anonymous';

    const name = claims.find((c) => c.typ === 'name')?.val || '';

    return { userId: objectId, userName: name };
  },
);

/* ------------------------------------------------------------------ */
/*  Slice                                                             */
/* ------------------------------------------------------------------ */

interface AppState {
  userId: string;
  userName: string;
  isLoading: boolean;
  imageGenerationEnabled: boolean;
  showChatHistory: boolean;
  generationStatus: string;
}

const initialState: AppState = {
  userId: '',
  userName: '',
  isLoading: false,
  imageGenerationEnabled: true,
  showChatHistory: true,
  generationStatus: '',
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setIsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setGenerationStatus(state, action: PayloadAction<string>) {
      state.generationStatus = action.payload;
    },
    toggleChatHistory(state) {
      state.showChatHistory = !state.showChatHistory;
    },
    setShowChatHistory(state, action: PayloadAction<boolean>) {
      state.showChatHistory = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAppConfig.fulfilled, (state, action) => {
        state.imageGenerationEnabled = action.payload.enable_image_generation;
      })
      .addCase(fetchAppConfig.rejected, (state) => {
        state.imageGenerationEnabled = true; // default when fetch fails
      })
      .addCase(fetchUserInfo.fulfilled, (state, action) => {
        state.userId = action.payload.userId;
        state.userName = action.payload.userName;
      })
      .addCase(fetchUserInfo.rejected, (state) => {
        state.userId = 'anonymous';
        state.userName = '';
      });
  },
});

export const { setIsLoading, setGenerationStatus, toggleChatHistory, setShowChatHistory } =
  appSlice.actions;
export default appSlice.reducer;
