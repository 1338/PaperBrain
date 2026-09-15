import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import LoginView from './views/LoginView.vue';
import RegisterView from './views/RegisterView.vue';
import LibraryView from './views/LibraryView.vue';
import AdminView from './views/AdminView.vue';
import VerifyEmailView from './views/VerifyEmailView.vue';
import ProfileView from './views/ProfileView.vue';
import { useAuth } from './auth.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/login', component: LoginView, meta: { guest: true } },
    { path: '/register', component: RegisterView, meta: { guest: true } },
    { path: '/library', component: LibraryView, meta: { auth: true } },
    { path: '/admin', component: AdminView, meta: { auth: true, admin: true } },
    { path: '/profile', component: ProfileView, meta: { auth: true } },
    { path: '/verify-email', component: VerifyEmailView },
    {
      path: '/library/:id/read',
      component: () => import('./views/ReaderView.vue'),
      meta: { auth: true, immersive: true }
    },
    {
      path: '/library/:id/listen',
      component: () => import('./views/AudioView.vue'),
      meta: { auth: true, immersive: true }
    }
  ]
});

router.beforeEach(async (to) => {
  const auth = useAuth();

  if (!auth.state.ready) {
    try {
      await auth.refresh();
    } catch {
      // The page remains usable when the API is temporarily unavailable.
    }
  }

  if (to.meta.auth && !auth.state.user) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  if (to.meta.admin && !auth.state.user?.roles?.includes('ROLE_ADMIN')) return '/library';

  if (to.meta.guest && auth.state.user) {
    return '/library';
  }
});

export default router;
