<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../auth.js';
import { api } from '../api.js';

const auth = useAuth();
const router = useRouter();
const form = reactive({
  displayName: '',
  email: '',
  password: '',
  agreeTerms: false
});
const error = ref('');
const busy = ref(false);
const signupAllowed = ref(true);
const verificationSent = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;

  try {
    const result = await auth.register(form);
    if (result.requiresVerification) verificationSent.value = true;
    else await router.push('/library');
  } catch (reason) {
    error.value = reason.message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try { signupAllowed.value = (await api.config()).publicSignup; } catch { /* form submission remains authoritative */ }
});
</script>

<template>
  <section class="auth-card">
    <p class="eyebrow">Start collecting</p>
    <h1>Create an account</h1>
    <div v-if="verificationSent" class="success-message">
      <h2>Check your inbox</h2>
      <p>We sent you a verification link. Verify your email before logging in.</p>
    </div>
    <p v-else-if="!signupAllowed" class="error">Public account registration is currently disabled.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form v-if="signupAllowed && !verificationSent" @submit.prevent="submit">
      <label>
        Display name
        <input v-model.trim="form.displayName" autocomplete="name" required maxlength="255">
      </label>
      <label>
        Email
        <input v-model.trim="form.email" type="email" autocomplete="email" required>
      </label>
      <label>
        Password
        <input v-model="form.password" type="password" autocomplete="new-password" required minlength="6">
        <small>At least 6 characters</small>
      </label>
      <label class="check">
        <input v-model="form.agreeTerms" type="checkbox" required>
        I agree to the terms
      </label>
      <button class="button" type="submit" :disabled="busy">
        {{ busy ? 'Creating account…' : 'Create account' }}
      </button>
    </form>
  </section>
</template>
