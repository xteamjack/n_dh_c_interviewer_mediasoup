<template>
  <div class="min-h-screen bg-gray-100 dark:bg-gray-900">
    <DarkModeToggle />
    <div class="p-6">
      <MeetingRoom />
    </div>
  </div>
</template>

<script setup>
import MeetingRoom from "./components/MeetingRoom.vue";
import DarkModeToggle from "./components/DarkModeToggle.vue";
</script>
