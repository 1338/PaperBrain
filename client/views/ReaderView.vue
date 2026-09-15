<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const route = useRoute();
const auth = useAuth();
const stage = ref(null);
const canvas = ref(null);
// PDF.js uses native private fields, so its instance cannot be deeply proxied.
const pdf = shallowRef(null);
const item = ref(null);
const page = ref(1);
const zoom = ref(1);
const fitMode = ref(window.innerWidth <= 700 ? 'width' : 'page');
const rendering = ref(false);
const fullscreen = ref(false);
const error = ref('');
const pageLinks = ref([]);
let saveTimer;
let resizeTimer;
let renderTask;

function safePdfUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const totalPages = computed(() => pdf.value?.numPages || item.value?.totalPages || 0);
const percent = computed(() => totalPages.value ? Math.round(page.value / totalPages.value * 100) : 0);

async function renderPage() {
  if (!pdf.value || !canvas.value || !stage.value) return;
  renderTask?.cancel();
  pageLinks.value = [];
  rendering.value = true;

  try {
    const pdfPage = await pdf.value.getPage(page.value);
    const base = pdfPage.getViewport({ scale: 1 });
    const mobile = window.innerWidth <= 700;
    const padding = mobile ? 20 : 64;
    const availableWidth = Math.max(200, stage.value.clientWidth - padding * 2);
    const availableHeight = Math.max(200, stage.value.clientHeight - padding * 2);
    const widthScale = availableWidth / base.width;
    const pageScale = Math.min(widthScale, availableHeight / base.height);
    const scale = (fitMode.value === 'page' ? pageScale : widthScale) * zoom.value;
    const viewport = pdfPage.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const context = canvas.value.getContext('2d', { alpha: false });

    canvas.value.width = Math.floor(viewport.width * pixelRatio);
    canvas.value.height = Math.floor(viewport.height * pixelRatio);
    canvas.value.style.width = `${Math.floor(viewport.width)}px`;
    canvas.value.style.height = `${Math.floor(viewport.height)}px`;

    renderTask = pdfPage.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    await renderTask.promise;
    const pageAnnotations = await pdfPage.getAnnotations({ intent: 'display' });
    pageLinks.value = pageAnnotations
      .filter((annotation) => annotation.subtype === 'Link' && (annotation.url || annotation.dest))
      .map((annotation) => {
        const firstCorner = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
        const secondCorner = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
        const rectangle = [...firstCorner, ...secondCorner];
        const left = Math.min(rectangle[0], rectangle[2]);
        const top = Math.min(rectangle[1], rectangle[3]);
        return {
          id: annotation.id,
          url: safePdfUrl(annotation.url),
          destination: annotation.dest || null,
          label: annotation.overlaidText || annotation.title || annotation.url || 'Go to linked page',
          style: {
            left: `${left}px`,
            top: `${top}px`,
            width: `${Math.abs(rectangle[2] - rectangle[0])}px`,
            height: `${Math.abs(rectangle[3] - rectangle[1])}px`
          }
        };
      })
      .filter((link) => link.url || link.destination);
  } catch (reason) {
    if (reason?.name !== 'RenderingCancelledException') throw reason;
  } finally {
    rendering.value = false;
  }
}

async function followPdfLink(link) {
  if (!link.destination || !pdf.value) return;
  try {
    const destination = typeof link.destination === 'string'
      ? await pdf.value.getDestination(link.destination)
      : link.destination;
    if (!destination?.length) return;
    const target = destination[0];
    const pageIndex = Number.isInteger(target) ? target : await pdf.value.getPageIndex(target);
    goTo(pageIndex + 1);
  } catch {
    error.value = 'This PDF link points to a page that could not be found.';
  }
}

function handlePaperClick(event) {
  if (event.target.closest('.pdf-link-layer a, .pdf-link-layer button')) return;
  const rectangle = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rectangle.left;
  const y = event.clientY - rectangle.top;
  const link = pageLinks.value.find((candidate) => {
    const left = Number.parseFloat(candidate.style.left);
    const top = Number.parseFloat(candidate.style.top);
    const width = Number.parseFloat(candidate.style.width);
    const height = Number.parseFloat(candidate.style.height);
    return x >= left && x <= left + width && y >= top && y <= top + height;
  });
  if (!link) return;
  if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer');
  else followPdfLink(link);
}

function setZoom(nextZoom) {
  zoom.value = Math.min(2.5, Math.max(0.6, Number(nextZoom.toFixed(1))));
}

function setFit(mode) {
  fitMode.value = mode;
  zoom.value = 1;
}

function goTo(nextPage) {
  const requested = Number(nextPage);
  if (!Number.isFinite(requested)) return;
  page.value = Math.min(Math.max(1, Math.round(requested)), totalPages.value);
  stage.value?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
}

function handleKeydown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    goTo(page.value - 1);
  } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    goTo(page.value + 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    goTo(1);
  } else if (event.key === 'End') {
    event.preventDefault();
    goTo(totalPages.value);
  } else if (event.key === '+' || event.key === '=') {
    setZoom(zoom.value + 0.1);
  } else if (event.key === '-') {
    setZoom(zoom.value - 0.1);
  }
}

function handleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPage, 150);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
}

function handleFullscreenChange() {
  fullscreen.value = Boolean(document.fullscreenElement);
}

function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.saveProgress(route.params.id, page.value, auth.state.csrfToken).catch(() => {});
  }, 400);
}

async function load() {
  try {
    const library = await api.library();
    item.value = library.items.find((entry) => String(entry.id) === String(route.params.id));
    if (!item.value || item.value.mediaType === 'audio' || item.value.status !== 'ready') {
      throw new Error('This document is not ready to read.');
    }
    page.value = Math.max(1, item.value.currentPage || 0);
    pdf.value = await pdfjs.getDocument({
      url: `/api/library/${route.params.id}/pdf`,
      withCredentials: true
    }).promise;
    await nextTick();
    await renderPage();
  } catch (reason) {
    error.value = reason.message;
  }
}

watch(page, async () => {
  await renderPage();
  saveProgress();
});
watch([zoom, fitMode], renderPage);

onMounted(() => {
  load();
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleResize);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onBeforeUnmount(() => {
  clearTimeout(saveTimer);
  clearTimeout(resizeTimer);
  renderTask?.cancel();
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  if (item.value) api.saveProgress(route.params.id, page.value, auth.state.csrfToken).catch(() => {});
  pdf.value?.destroy();
});
</script>

<template>
  <section class="book-reader">
    <header class="book-reader-topbar">
      <RouterLink class="reader-back" to="/library" aria-label="Return to library">
        <span aria-hidden="true">←</span><span class="reader-back-label">Library</span>
      </RouterLink>
      <div v-if="item" class="reader-title">
        <strong :title="item.title">{{ item.title }}</strong>
        <span>{{ page }} of {{ totalPages }}</span>
      </div>
      <span class="reader-percent">{{ percent }}%</span>
      <div class="reader-progress" aria-hidden="true"><span :style="{ width: `${percent}%` }"></span></div>
    </header>

    <div v-if="error" class="reader-message"><p class="error" role="alert">{{ error }}</p></div>
    <div v-else ref="stage" class="book-stage" :class="{ rendering }">
      <p v-if="!pdf" class="reader-loading">Opening your book…</p>
      <template v-else>
        <button v-if="!pageLinks.length" class="page-turn page-turn-previous" type="button" :disabled="page <= 1" aria-label="Previous page" @click="goTo(page - 1)"></button>
        <div class="paper-frame" @click="handlePaperClick">
          <canvas ref="canvas" :aria-label="`Page ${page} of ${totalPages}`"></canvas>
          <div v-if="pageLinks.length" class="pdf-link-layer" aria-label="PDF links">
            <template v-for="link in pageLinks" :key="link.id">
              <a v-if="link.url" :href="link.url" :style="link.style" target="_blank" rel="noopener noreferrer" :aria-label="link.label" @pointerdown.stop></a>
              <button v-else type="button" :style="link.style" :aria-label="link.label" @pointerdown.stop @click.stop="followPdfLink(link)"></button>
            </template>
          </div>
        </div>
        <button v-if="!pageLinks.length" class="page-turn page-turn-next" type="button" :disabled="page >= totalPages" aria-label="Next page" @click="goTo(page + 1)"></button>
      </template>
    </div>

    <footer v-if="pdf" class="book-reader-controls">
      <button class="reader-nav-button" type="button" :disabled="page <= 1 || rendering" aria-label="Previous page" @click="goTo(page - 1)">
        <span aria-hidden="true">‹</span><span class="control-label">Previous</span>
      </button>

      <label class="page-position">
        <span>Page</span>
        <input :value="page" inputmode="numeric" type="number" min="1" :max="totalPages" aria-label="Current page" @change="goTo($event.target.value)">
        <span>of {{ totalPages }}</span>
      </label>

      <div class="reader-display-controls">
        <button type="button" :disabled="zoom <= 0.6" aria-label="Zoom out" @click="setZoom(zoom - 0.1)">−</button>
        <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" :disabled="zoom >= 2.5" aria-label="Zoom in" @click="setZoom(zoom + 0.1)">+</button>
        <select :class="`fit-${fitMode}`" :value="fitMode" :aria-label="fitMode === 'page' ? 'Page fitting: fit page' : 'Page fitting: fit width'" @change="setFit($event.target.value)">
          <option value="page">Fit page</option>
          <option value="width">Fit width</option>
        </select>
        <button class="fullscreen-button" type="button" :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="toggleFullscreen">
          {{ fullscreen ? '↙' : '↗' }}
        </button>
      </div>

      <button class="reader-nav-button next" type="button" :disabled="page >= totalPages || rendering" aria-label="Next page" @click="goTo(page + 1)">
        <span class="control-label">Next</span><span aria-hidden="true">›</span>
      </button>
    </footer>
  </section>
</template>
