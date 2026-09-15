<script setup>
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './auth.js';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

async function logout() {
  await auth.logout();
  await router.push('/');
}
</script>

<template>
  <div class="app-shell" :class="{ 'immersive-shell': route.meta.immersive }">
    <header v-if="!route.meta.immersive" class="site-header">
      <RouterLink class="brand" :to="auth.state.user ? '/library' : '/'">PaperBrain</RouterLink>
      <nav aria-label="Main navigation">
        <RouterLink v-if="auth.state.user?.roles?.includes('ROLE_ADMIN')" to="/admin">Admin</RouterLink>
        <template v-if="auth.state.user">
          <RouterLink to="/profile">Profile</RouterLink>
          <button class="link-button" type="button" @click="logout">Log out</button>
        </template>
        <template v-else>
          <RouterLink to="/login">Log in</RouterLink>
          <RouterLink class="button small" to="/register">Join</RouterLink>
        </template>
      </nav>
    </header>

    <main :class="{ 'immersive-main': route.meta.immersive }">
      <RouterView />
    </main>
  </div>
</template>
