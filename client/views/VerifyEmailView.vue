<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';

const route = useRoute();
const status = ref('working');
const message = ref('Verifying your email…');

onMounted(async () => {
  try {
    await api.verifyEmail(String(route.query.token || ''));
    status.value = 'success';
    message.value = 'Your email is verified. You can now log in.';
  } catch (error) {
    status.value = 'error';
    message.value = error.message;
  }
});
</script>

<template>
  <section class="auth-card verification-card">
    <p class="eyebrow">Email verification</p>
    <h1>{{ status === 'success' ? 'You’re all set' : 'Verifying' }}</h1>
    <p :class="status === 'error' ? 'error' : 'success-message'">{{ message }}</p>
    <RouterLink v-if="status !== 'working'" class="button" to="/login">Go to login</RouterLink>
  </section>
</template>
