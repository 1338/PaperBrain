<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

const auth = useAuth();
const items = ref([]);
const file = ref(null);
const loading = ref(true);
const uploading = ref(false);
const workingItem = ref(null);
const error = ref('');
const search = ref('');
const progressFilter = ref('all');
const statusOpen = ref(false);
const editing = ref(null);
const metadata = ref({ title: '', author: '', isbn: '' });
let poll;
let disposed = false;
function edit(item) {
  editing.value = item.id;
  metadata.value = { title: item.title || '', author: item.author || '', isbn: item.isbn || '' };
}
async function updateItem(item, operation) {
  workingItem.value = item.id;
  error.value = '';
  try {
    const result = await operation();
    const current = items.value.find(entry => entry.id === item.id);
    if (current) Object.assign(current, result.item);
    editing.value = null;
  } catch (reason) { error.value = reason.message; }
  finally { workingItem.value = null; }
}
function setProgress(item, action) {
  if (action === 'reset' && !window.confirm(`Reset progress for “${item.title}”?`)) return;
  return updateItem(item, () => api.setProgress(item.id, action, auth.state.csrfToken));
}
function schedulePoll() {
  clearTimeout(poll);
  if (!disposed) poll = setTimeout(async () => {
    if (items.value.some(item => ['queued', 'converting', 'processing'].includes(item.status))) await loadLibrary();
    schedulePoll();
  }, 2500);
}
const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'finished', label: 'Finished' }
];
const selectedStatusLabel = computed(() => statusOptions.find((option) => option.value === progressFilter.value)?.label);

const filteredItems = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return items.value.filter((item) => {
    const matchesTerm = !term || [item.title, item.author, item.isbn, item.originalFilename]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(term));
    const readingStatus = !item.hasProgress
      ? 'not-started'
      : item.progress >= 100 ? 'finished' : 'in-progress';
    return matchesTerm && (progressFilter.value === 'all' || progressFilter.value === readingStatus);
  });
});

function clearFilters() {
  search.value = '';
  progressFilter.value = 'all';
}

function selectStatus(value) {
  progressFilter.value = value;
  statusOpen.value = false;
}

function closeStatusOnBlur(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) statusOpen.value = false;
}

async function loadLibrary() {
  try {
    items.value = (await api.library()).items;
  } catch (reason) {
    error.value = reason.message;
  } finally {
    loading.value = false;
  }
}

function selectFile(event) {
  file.value = event.target.files[0] || null;
}

function formatMediaTime(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return 'Unknown length';
  const whole = Math.floor(Number(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

async function upload() {
  if (!file.value) return;
  error.value = '';
  uploading.value = true;

  try {
    const result = await api.uploadMedia(file.value, auth.state.csrfToken);
    items.value.unshift(result.item);
    file.value = null;
    document.querySelector('#media-upload').value = '';
  } catch (reason) {
    error.value = reason.message;
    await loadLibrary();
  } finally {
    uploading.value = false;
  }
}

async function retry(item) {
  error.value = '';
  workingItem.value = item.id;
  item.status = 'converting';
  try {
    const result = await api.retryConversion(item.id, auth.state.csrfToken);
    Object.assign(item, result.item);
  } catch (reason) {
    error.value = reason.message;
    await loadLibrary();
  } finally {
    workingItem.value = null;
  }
}

async function remove(item) {
  if (!window.confirm(`Delete “${item.title}” and its stored files? This cannot be undone.`)) return;
  error.value = '';
  workingItem.value = item.id;
  try {
    await api.deleteBook(item.id, auth.state.csrfToken);
    items.value = items.value.filter((entry) => entry.id !== item.id);
  } catch (reason) {
    error.value = reason.message;
  } finally {
    workingItem.value = null;
  }
}

onMounted(() => { loadLibrary(); schedulePoll(); });
onUnmounted(() => { disposed = true; clearTimeout(poll); });
</script>

<template>
  <section class="library">
    <p class="eyebrow">Your library</p>
    <h1>{{ auth.state.user?.displayName }}’s PaperBrain</h1>

    <form class="upload-card" @submit.prevent="upload">
      <div>
        <h2>Add something to read or listen to</h2>
        <p>Upload EPUB, MOBI, PDF, MP3, or WAV. Ebooks are converted to PDF automatically.</p>
      </div>
      <label class="file-picker" for="media-upload">
        <span>{{ file?.name || 'Choose a file' }}</span>
        <input id="media-upload" type="file" accept=".epub,.mobi,.pdf,.mp3,.wav,application/epub+zip,application/x-mobipocket-ebook,application/pdf,audio/mpeg,audio/wav" required @change="selectFile">
      </label>
      <button class="button" type="submit" :disabled="!file || uploading">
        {{ uploading ? 'Processing…' : 'Upload' }}
      </button>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">Loading your library…</p>

    <div v-else-if="!items.length" class="empty-state">
      <span aria-hidden="true">⌁</span>
      <h2>No papers yet</h2>
      <p>Upload an EPUB, MOBI, PDF, MP3, or WAV file to begin.</p>
    </div>

    <template v-else>
      <div class="library-tools" role="search">
        <label class="library-search">
          <span>Search your library</span>
          <span class="search-field">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input v-model="search" type="search" placeholder="Title, author, or ISBN…">
          </span>
        </label>
        <div class="library-status" @focusout="closeStatusOnBlur" @keydown.esc="statusOpen = false">
          <span id="reading-status-label">Reading status</span>
          <button class="status-trigger" type="button" aria-haspopup="listbox" :aria-expanded="statusOpen" aria-labelledby="reading-status-label reading-status-value" @click="statusOpen = !statusOpen">
            <strong id="reading-status-value">{{ selectedStatusLabel }}</strong>
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>
          </button>
          <div v-if="statusOpen" class="status-options" role="listbox" aria-labelledby="reading-status-label">
            <button v-for="option in statusOptions" :key="option.value" type="button" role="option" :aria-selected="progressFilter === option.value" :class="{ selected: progressFilter === option.value }" @click="selectStatus(option.value)">
              {{ option.label }}
            </button>
          </div>
        </div>
        <p class="result-count" aria-live="polite">{{ filteredItems.length }} of {{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}</p>
      </div>

      <div v-if="!filteredItems.length" class="empty-state filtered-empty">
        <span aria-hidden="true">⌕</span>
        <h2>No matching items</h2>
        <p>Try another title, author, or reading status.</p>
        <button class="secondary-button" type="button" @click="clearFilters">Clear filters</button>
      </div>

      <div v-else class="book-grid">
      <article v-for="item in filteredItems" :key="item.id" class="book-card">
        <div class="book-mark" :class="{ audio: item.mediaType === 'audio' }" aria-hidden="true">
          {{ ['epub', 'mobi'].includes(item.mediaType) ? `${item.fileType}→PDF` : item.fileType }}
        </div>
        <div>
          <p class="book-author">{{ item.author || 'Unknown author' }}</p>
          <p v-if="item.isbn" class="book-isbn">ISBN {{ item.isbn }}</p>
          <h2 :title="item.title">{{ item.title }}</h2>
          <template v-if="item.status === 'ready'">
            <div class="progress-label">
              <span v-if="item.mediaType === 'audio'">
                {{ item.hasProgress ? formatMediaTime(item.progressSeconds) : 'Not started' }} · {{ formatMediaTime(item.durationSeconds) }}
              </span>
              <span v-else>{{ item.hasProgress ? `Page ${item.currentPage} of ${item.totalPages}` : `${item.totalPages} pages · Not started` }}</span>
              <strong>{{ item.progress }}%</strong>
            </div>
            <div class="progress-track" role="progressbar" :aria-valuenow="item.progress" aria-valuemin="0" aria-valuemax="100">
              <span :style="{ width: `${item.progress}%` }"></span>
            </div>
            <RouterLink class="button small read-button" :to="item.mediaType === 'audio' ? `/library/${item.id}/listen` : `/library/${item.id}/read`">
              {{ item.mediaType === 'audio' ? (item.hasProgress && item.progressSeconds > 0 ? 'Continue listening' : 'Start listening') : (item.hasProgress ? 'Continue reading' : 'Start reading') }}
            </RouterLink>
            <div class="item-actions">
              <button class="secondary-button" type="button" :disabled="workingItem === item.id" @click="edit(item)">Edit details</button>
              <button v-if="item.progress < 100" class="secondary-button" type="button" :disabled="workingItem === item.id" @click="setProgress(item, 'finish')">Mark finished</button>
              <button v-if="item.hasProgress" class="secondary-button" type="button" :disabled="workingItem === item.id" @click="setProgress(item, 'reset')">Reset progress</button>
            </div>
            <form v-if="editing === item.id" class="metadata-editor" @submit.prevent="updateItem(item, () => api.updateMetadata(item.id, metadata, auth.state.csrfToken))">
              <label>Title<input v-model="metadata.title" required maxlength="500"></label>
              <label>Author<input v-model="metadata.author" maxlength="500"></label>
              <label>ISBN<input v-model="metadata.isbn" maxlength="32" placeholder="ISBN-10 or ISBN-13"></label>
              <button class="button small" :disabled="workingItem === item.id">Save details</button>
              <button class="secondary-button" type="button" :disabled="workingItem === item.id" @click="editing = null">Cancel</button>
            </form>
          </template>
          <template v-else-if="item.status === 'failed'">
            <p class="error">{{ item.error || 'Conversion failed.' }}</p>
            <button v-if="['epub', 'mobi', 'pdf'].includes(item.mediaType)" class="secondary-button" type="button" :disabled="workingItem === item.id" @click="retry(item)">
              Retry processing
            </button>
          </template>
          <p v-else class="muted" role="status">{{ item.status === 'queued' ? 'Queued for conversion…' : 'Processing…' }} You can leave this page.</p>
          <button class="danger-link" type="button" :disabled="workingItem === item.id" @click="remove(item)">
            Delete book
          </button>
        </div>
      </article>
      </div>
    </template>
  </section>
</template>
