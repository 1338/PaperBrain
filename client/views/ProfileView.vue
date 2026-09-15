<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../auth.js';

const auth = useAuth();
const router = useRouter();
const form = reactive({
  displayName: auth.state.user?.displayName || '',
  email: auth.state.user?.email || '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
});
const saving = ref(false);
const error = ref('');
const notice = ref('');

async function submit() {
  error.value = '';
  notice.value = '';
  if (form.newPassword !== form.confirmPassword) {
    error.value = 'New passwords do not match.';
    return;
  }
  saving.value = true;
  try {
    const result = await auth.updateProfile({
      displayName: form.displayName,
      email: form.email,
      currentPassword: form.currentPassword,
      newPassword: form.newPassword
    });
    if (result.requiresVerification) {
      await router.push({ path: '/login', query: { verification: 'sent' } });
      return;
    }
    form.currentPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
    notice.value = 'Profile updated.';
  } catch (reason) {
    error.value = reason.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="profile-page">
    <p class="eyebrow">Your account</p>
    <h1>Profile</h1>
    <p class="profile-intro">Update how you appear and keep your sign-in details secure.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>

    <form class="profile-form" @submit.prevent="submit">
      <fieldset>
        <legend>Identity</legend>
        <label>Display name<input v-model.trim="form.displayName" autocomplete="name" maxlength="255" required></label>
        <label>Email address<input v-model.trim="form.email" type="email" autocomplete="email" required></label>
        <small>If email verification is enabled, changing your email signs you out and sends a new verification link.</small>
      </fieldset>

      <fieldset>
        <legend>Security</legend>
        <label>Current password<input v-model="form.currentPassword" type="password" autocomplete="current-password"></label>
        <small>Your current password is required when changing your email or password.</small>
        <label>New password<input v-model="form.newPassword" type="password" autocomplete="new-password" minlength="6"></label>
        <label>Confirm new password<input v-model="form.confirmPassword" type="password" autocomplete="new-password" minlength="6"></label>
      </fieldset>

      <button class="button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save profile' }}</button>
    </form>
  </section>
</template>
