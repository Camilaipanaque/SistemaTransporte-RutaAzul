<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ msg: string }>()
const count = ref(0)
</script>

<template>
  <h2>{{ msg }}</h2>
  <button type="button" @click="count++">count is {{ count }}</button>
  <p>Edit <code>src/App.vue</code> to get started.</p>
</template>
