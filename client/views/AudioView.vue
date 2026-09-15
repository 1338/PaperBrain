<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

const route = useRoute();
const auth = useAuth();
const player = ref(null);
const item = ref(null);
const error = ref('');
const currentTime = ref(0);
const duration = ref(0);
const playing = ref(false);
const volume = ref(0.9);
const speed = ref(1);
let restored = false;
let lastSavedAt = 0;

const percent = computed(() => duration.value ? Math.round(currentTime.value / duration.value * 100) : 0);
const displayTitle = computed(() => item.value?.title?.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled audio');
const timelineStyle = computed(() => ({ '--audio-progress': `${percent.value}%` }));
const volumeStyle = computed(() => ({ '--volume-progress': `${volume.value * 100}%` }));

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

function save(immediate = false) {
  if (!duration.value || currentTime.value <= 0) return;
  const persist = () => {
    lastSavedAt = Date.now();
    api.saveAudioProgress(
      route.params.id,
      currentTime.value,
      duration.value,
      auth.state.csrfToken
    ).catch(() => {});
  };
  if (immediate || Date.now() - lastSavedAt >= 5000) persist();
}

function loadedMetadata() {
  duration.value = Number.isFinite(player.value.duration) ? player.value.duration : 0;
  player.value.volume = volume.value;
  player.value.playbackRate = speed.value;
  if (!restored && item.value?.progressSeconds && duration.value) {
    player.value.currentTime = Math.min(item.value.progressSeconds, duration.value);
    currentTime.value = player.value.currentTime;
  }
  restored = true;
  api.saveAudioProgress(
    route.params.id,
    currentTime.value,
    duration.value,
    auth.state.csrfToken,
    false
  ).catch(() => {});
}

function timeUpdated() {
  currentTime.value = player.value.currentTime;
  save();
}

async function togglePlayback() {
  if (!player.value) return;
  if (player.value.paused) await player.value.play();
  else player.value.pause();
}

function seekTo(value) {
  if (!player.value || !duration.value) return;
  player.value.currentTime = Math.min(duration.value, Math.max(0, Number(value)));
  currentTime.value = player.value.currentTime;
  save();
}

function seekBy(seconds) {
  seekTo(currentTime.value + seconds);
}

function setVolume(value) {
  volume.value = Number(value);
  if (player.value) player.value.volume = volume.value;
}

function setSpeed(value) {
  speed.value = Number(value);
  if (player.value) player.value.playbackRate = speed.value;
}

function handleKeydown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === ' ') {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    seekBy(-15);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    seekBy(15);
  }
}

async function load() {
  try {
    const library = await api.library();
    item.value = library.items.find((entry) => String(entry.id) === String(route.params.id));
    if (!item.value || item.value.mediaType !== 'audio' || item.value.status !== 'ready') {
      throw new Error('This audio item is not ready to play.');
    }
  } catch (reason) {
    error.value = reason.message;
  }
}

onMounted(() => {
  load();
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (duration.value) save(true);
});
</script>

<template>
  <section class="listening-room">
    <header class="audio-topbar">
      <RouterLink class="reader-back" to="/library" aria-label="Return to library">
        <span aria-hidden="true">←</span><span class="reader-back-label">Library</span>
      </RouterLink>
      <span>PaperBrain Audio</span>
      <span>{{ percent }}%</span>
    </header>

    <div v-if="error" class="reader-message"><p class="error" role="alert">{{ error }}</p></div>
    <div v-else-if="item" class="audio-experience">
      <div class="audio-visual" :class="{ playing }" aria-hidden="true">
        <div class="record-ring ring-one"></div>
        <div class="record-ring ring-two"></div>
        <div class="record-center">PB</div>
      </div>

      <div class="audio-information">
        <p class="audio-kicker">Now listening</p>
        <h1 :title="displayTitle">{{ displayTitle }}</h1>
        <p>{{ item.author || item.fileType }}</p>
      </div>

      <audio
        ref="player"
        class="native-audio"
        preload="metadata"
        :src="`/api/library/${item.id}/audio`"
        @loadedmetadata="loadedMetadata"
        @timeupdate="timeUpdated"
        @play="playing = true"
        @pause="playing = false; save(true)"
        @seeked="save(true)"
        @ended="playing = false; save(true)"
        @error="error = 'This audio file could not be played by your browser.'"
      ></audio>

      <div class="audio-timeline">
        <input
          :value="currentTime"
          :max="duration || 0"
          :style="timelineStyle"
          type="range"
          min="0"
          step="0.1"
          aria-label="Playback position"
          @input="seekTo($event.target.value)"
        >
        <div><span>{{ formatTime(currentTime) }}</span><span>−{{ formatTime(Math.max(0, duration - currentTime)) }}</span></div>
      </div>

      <div class="audio-primary-controls">
        <button type="button" aria-label="Go back 15 seconds" @click="seekBy(-15)"><span>↶</span><small>15</small></button>
        <button class="audio-play" type="button" :aria-label="playing ? 'Pause' : 'Play'" @click="togglePlayback">
          <span aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span>
        </button>
        <button type="button" aria-label="Go forward 15 seconds" @click="seekBy(15)"><span>↷</span><small>15</small></button>
      </div>

      <div class="audio-secondary-controls">
        <label>
          <span>Speed</span>
          <select :value="speed" @change="setSpeed($event.target.value)">
            <option :value="0.75">0.75×</option>
            <option :value="1">1×</option>
            <option :value="1.25">1.25×</option>
            <option :value="1.5">1.5×</option>
            <option :value="2">2×</option>
          </select>
        </label>
        <label class="volume-control">
          <span aria-hidden="true">{{ volume === 0 ? '⌁' : '◖' }}</span><span class="sr-only">Volume</span>
          <input :value="volume" :style="volumeStyle" type="range" min="0" max="1" step="0.05" aria-label="Volume" @input="setVolume($event.target.value)">
        </label>
      </div>
    </div>
    <p v-else class="reader-loading">Preparing your audio…</p>
  </section>
</template>
