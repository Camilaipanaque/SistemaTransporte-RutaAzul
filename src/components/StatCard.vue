<script setup lang="ts">
import AppGlyph from './AppGlyph.vue'

defineProps<{ label: string; value: string; detail: string; icon: string; tone: string }>()
</script>

<template>
  <article class="stat-card">
    <div class="stat-top"><span class="stat-icon" :class="`tone-${tone}`"><AppGlyph :name="icon" /></span><span class="stat-menu">···</span></div>
    <p class="stat-label">{{ label }}</p>
    <div class="stat-bottom"><strong>{{ value }}</strong><span class="stat-detail">{{ detail }}</span></div>
  </article>
</template>
