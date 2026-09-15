async function request(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}

export const api = {
  config: () => request('/config'),
  session: () => request('/session'),
  register: (form) => request('/register', {
    method: 'POST',
    body: JSON.stringify(form)
  }),
  login: (form) => request('/login', {
    method: 'POST',
    body: JSON.stringify(form)
  }),
  logout: (csrfToken) => request('/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  }),
  updateProfile(profile, csrfToken) {
    return request('/profile', {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(profile)
    });
  },
  library: () => request('/library'),
  updateMetadata(id, metadata, csrfToken) {
    return request(`/library/${id}/metadata`, { method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(metadata) });
  },
  setProgress(id, action, csrfToken) {
    return request(`/library/${id}/progress`, { method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ action }) });
  },
  uploadMedia(file, csrfToken) {
    const body = new FormData();
    body.append('file', file);
    return request('/library', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body
    });
  },
  saveProgress(id, page, csrfToken) {
    return request(`/library/${id}/progress`, {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ page })
    });
  },
  saveAudioProgress(id, seconds, duration, csrfToken, started = true) {
    return request(`/library/${id}/progress`, {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ seconds, duration, started })
    });
  },
  retryConversion(id, csrfToken) {
    return request(`/library/${id}/retry`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken }
    });
  },
  deleteBook(id, csrfToken) {
    return request(`/library/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken }
    });
  },
  verifyEmail: (token) => request('/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  admin: () => request('/admin'),
  saveAdminSettings(settings, csrfToken) {
    return request('/admin/settings', {
      method: 'PUT', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(settings)
    });
  },
  testEmail(csrfToken) {
    return request('/admin/settings/test-email', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
  },
  testStorage(storage, csrfToken) {
    return request('/admin/settings/test-storage', {
      method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ storage })
    });
  },
  updateUser(id, changes, csrfToken) {
    return request(`/admin/users/${id}`, {
      method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(changes)
    });
  },
  deleteUser(id, csrfToken) {
    return request(`/admin/users/${id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
  }
};
