<template>
  <button
    @click="toggleDarkMode"
    class="fixed top-4 right-4 p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
    aria-label="Toggle Dark Mode"
  >
    <!-- Sun icon for dark mode -->
    <svg
      v-if="isDark"
      xmlns="http://www.w3.org/2000/svg"
      class="h-6 w-6 text-yellow-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="{2}"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
    <!-- Moon icon for light mode -->
    <svg
      v-else
      xmlns="http://www.w3.org/2000/svg"
      class="h-6 w-6 text-gray-700"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="{2}"
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  </button>
</template>

<script setup>
import { ref, onMounted } from "vue";

const isDark = ref(true); // Set default to true for dark mode

function toggleDarkMode() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.classList.add("dark");
    localStorage.theme = "dark";
  } else {
    document.documentElement.classList.remove("dark");
    localStorage.theme = "light";
  }
}

onMounted(() => {
  // Set dark mode as default
  if (!localStorage.theme) {
    localStorage.theme = "dark";
    document.documentElement.classList.add("dark");
  }
  // Sync initial state with localStorage
  isDark.value = localStorage.theme === "dark";
});
</script>
