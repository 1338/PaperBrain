<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../auth.js';

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const form = reactive({ email: '', password: '', rememberMe: false });
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;

  try {
    await auth.login(form);
    await router.push(String(route.query.redirect || '/library'));
  } catch (reason) {
    error.value = reason.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth-card">
    <p class="eyebrow">Welcome back</p>
    <h1>Log in</h1>
    <p v-if="route.query.verification === 'sent'" class="success-message">Check your new email address for a verification link before logging in again.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model.trim="form.email" type="email" autocomplete="email" required>
      </label>
      <label>
        Password
        <input v-model="form.password" type="password" autocomplete="current-password" required>
      </label>
      <label class="check">
        <input v-model="form.rememberMe" type="checkbox">
        Remember me for 7 days
      </label>
      <button class="button" type="submit" :disabled="busy">
        {{ busy ? 'Logging in…' : 'Log in' }}
      </button>
    </form>
    <p class="form-foot">New here? <RouterLink to="/register">Create an account</RouterLink>.</p>
  </section>
</template>
