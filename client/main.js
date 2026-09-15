import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import './styles.css';

// PDF.js uses this newer JavaScript API when available. Keep the reader
// compatible with browser engines that have not shipped it yet.
Math.sumPrecise ||= (values) => {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
};

createApp(App).use(router).mount('#app');
