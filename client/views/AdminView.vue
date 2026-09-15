<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

const auth = useAuth();
const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const testingStorage = ref(false);
const error = ref('');
const notice = ref('');
const users = ref([]);
const settings = reactive({
  publicSignup: true,
  requireEmailVerification: false,
  smtp: { host: '', port: 587, secure: false, user: '', password: '', from: '', passwordConfigured: false },
  storage: {
    provider: 'local', endpoint: '', region: 'us-east-1', bucket: '', accessKey: '',
    secretKey: '', secretKeyConfigured: false, forcePathStyle: true
  }
});

async function load() {
  error.value = '';
  try {
    const result = await api.admin();
    Object.assign(settings, result.settings);
    settings.smtp = { ...settings.smtp, ...result.settings.smtp, password: '' };
    settings.storage = { ...settings.storage, ...result.settings.storage, secretKey: '' };
    users.value = result.users;
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.saveAdminSettings(settings, auth.state.csrfToken);
    notice.value = 'Settings saved.';
    settings.smtp.password = '';
    settings.storage.secretKey = '';
    await load();
  } catch (reason) {
    error.value = reason.message;
  } finally {
    saving.value = false;
  }
}

async function checkStorage() {
  testingStorage.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.testStorage(settings.storage, auth.state.csrfToken);
    notice.value = settings.storage.provider === 's3'
      ? 'Connected to the S3 bucket successfully.'
      : 'Local file storage is ready.';
  } catch (reason) {
    error.value = reason.message;
  } finally {
    testingStorage.value = false;
  }
}

async function testEmail() {
  testing.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.testEmail(auth.state.csrfToken);
    notice.value = `Test email sent to ${auth.state.user.email}.`;
  } catch (reason) {
    error.value = reason.message;
  } finally {
    testing.value = false;
  }
}

async function updateUser(user, changes) {
  error.value = '';
  try {
    await api.updateUser(user.id, changes, auth.state.csrfToken);
    await load();
  } catch (reason) {
    error.value = reason.message;
  }
}

async function removeUser(user) {
  if (!window.confirm(`Delete ${user.email}, their library, and all stored media?`)) return;
  try {
    await api.deleteUser(user.id, auth.state.csrfToken);
    users.value = users.value.filter((entry) => entry.id !== user.id);
  } catch (reason) {
    error.value = reason.message;
  }
}

onMounted(load);
</script>

<template>
  <section class="admin-page">
    <p class="eyebrow">Instance administration</p>
    <h1>Admin</h1>
    <p class="admin-intro">Control access, email delivery, and the people using this PaperBrain instance.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <p v-if="loading" class="muted">Loading administration…</p>

    <template v-else>
      <form class="admin-panel" @submit.prevent="saveSettings">
        <div class="admin-panel-heading">
          <div><p class="eyebrow">Access</p><h2>Registration</h2></div>
          <button class="button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save settings' }}</button>
        </div>
        <label class="setting-row">
          <span><strong>Public signup</strong><small>Allow visitors to create their own account.</small></span>
          <input v-model="settings.publicSignup" type="checkbox">
        </label>
        <label class="setting-row">
          <span><strong>Email verification</strong><small>Require new users to verify their address before login.</small></span>
          <input v-model="settings.requireEmailVerification" type="checkbox">
        </label>

        <div class="admin-panel-heading smtp-heading">
          <div><p class="eyebrow">Delivery</p><h2>Email server</h2></div>
          <button class="secondary-button" type="button" :disabled="testing" @click="testEmail">{{ testing ? 'Sending…' : 'Send test email' }}</button>
        </div>
        <div class="smtp-grid">
          <label>SMTP host<input v-model.trim="settings.smtp.host" placeholder="smtp.example.com"></label>
          <label>Port<input v-model.number="settings.smtp.port" type="number" min="1" max="65535"></label>
          <label>Username<input v-model.trim="settings.smtp.user" autocomplete="off"></label>
          <label>Password<input v-model="settings.smtp.password" type="password" autocomplete="new-password" :placeholder="settings.smtp.passwordConfigured ? 'Saved — enter to replace' : ''"></label>
          <label class="smtp-from">From address<input v-model.trim="settings.smtp.from" placeholder="PaperBrain <paperbrain@example.com>"></label>
          <label class="check"><input v-model="settings.smtp.secure" type="checkbox">Use implicit TLS (usually port 465)</label>
        </div>

        <div class="admin-panel-heading storage-heading">
          <div><p class="eyebrow">Files</p><h2>Storage</h2></div>
          <button class="secondary-button" type="button" :disabled="testingStorage" @click="checkStorage">{{ testingStorage ? 'Testing…' : 'Test storage' }}</button>
        </div>
        <div class="storage-grid">
          <label>Storage provider
            <select v-model="settings.storage.provider">
              <option value="local">Local filesystem</option>
              <option value="s3">S3-compatible bucket</option>
            </select>
          </label>
          <p v-if="settings.storage.provider === 'local'" class="storage-note">
            Uploads are kept in PaperBrain's local data directory. With Docker, this is persisted in the configured data volume.
          </p>
          <template v-else>
            <label>Endpoint <input v-model.trim="settings.storage.endpoint" placeholder="https://s3.example.com"></label>
            <label>Region <input v-model.trim="settings.storage.region" placeholder="us-east-1"></label>
            <label>Bucket <input v-model.trim="settings.storage.bucket" placeholder="paperbrain"></label>
            <label>Access key <input v-model.trim="settings.storage.accessKey" autocomplete="off"></label>
            <label>Secret key <input v-model="settings.storage.secretKey" type="password" autocomplete="new-password" :placeholder="settings.storage.secretKeyConfigured ? 'Saved — enter to replace' : ''"></label>
            <label class="check"><input v-model="settings.storage.forcePathStyle" type="checkbox">Use path-style bucket URLs</label>
            <p class="storage-note storage-note-wide">Leave the endpoint blank for AWS S3. Path-style URLs are commonly required by MinIO and other S3-compatible services.</p>
          </template>
        </div>
        <p class="storage-warning">Storage changes apply to new uploads. Local files stay local and S3 files stay in S3. Changing S3 connection details can make earlier S3 uploads unavailable.</p>
      </form>

      <section class="admin-panel users-panel">
        <div class="admin-panel-heading"><div><p class="eyebrow">People</p><h2>Users</h2></div><span>{{ users.length }} total</span></div>
        <div class="user-list">
          <article v-for="user in users" :key="user.id" class="user-row">
            <div class="user-avatar">{{ user.displayName?.slice(0, 1).toUpperCase() }}</div>
            <div class="user-identity"><strong>{{ user.displayName }}</strong><span>{{ user.email }}</span></div>
            <div class="user-badges">
              <span v-if="user.roles.includes('ROLE_ADMIN')">Admin</span>
              <span :class="{ warning: !user.active }">{{ user.active ? 'Active' : 'Disabled' }}</span>
              <span :class="{ warning: !user.emailVerified }">{{ user.emailVerified ? 'Verified' : 'Unverified' }}</span>
            </div>
            <div class="user-actions">
              <button type="button" :disabled="String(user.id) === String(auth.state.user.id) && user.active" @click="updateUser(user, { active: !user.active })">{{ user.active ? 'Disable' : 'Enable' }}</button>
              <button type="button" @click="updateUser(user, { emailVerified: !user.emailVerified })">{{ user.emailVerified ? 'Unverify' : 'Verify' }}</button>
              <button type="button" :disabled="String(user.id) === String(auth.state.user.id) && user.roles.includes('ROLE_ADMIN')" @click="updateUser(user, { admin: !user.roles.includes('ROLE_ADMIN') })">{{ user.roles.includes('ROLE_ADMIN') ? 'Remove admin' : 'Make admin' }}</button>
              <button class="danger-link" type="button" :disabled="String(user.id) === String(auth.state.user.id)" @click="removeUser(user)">Delete</button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
