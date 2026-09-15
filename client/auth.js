import { reactive, readonly } from 'vue';
import { api } from './api.js';

const state = reactive({
  user: null,
  csrfToken: null,
  ready: false
});

async function refresh() {
  const session = await api.session();
  state.user = session.user;
  state.csrfToken = session.csrfToken;
  state.ready = true;
}

export function useAuth() {
  return {
    state: readonly(state),
    refresh,
    async login(form) {
      await api.login(form);
      await refresh();
    },
    async register(form) {
      const result = await api.register(form);
      if (!result.requiresVerification) await refresh();
      return result;
    },
    async logout() {
      await api.logout(state.csrfToken);
      await refresh();
    },
    async updateProfile(profile) {
      const result = await api.updateProfile(profile, state.csrfToken);
      state.user = result.user;
      if (!result.requiresVerification) await refresh();
      return result;
    }
  };
}
