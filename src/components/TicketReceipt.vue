<script setup lang="ts">
import AppGlyph from './AppGlyph.vue'

defineProps<{
  ticket: { code: string; passengerName: string; passengerDni: string; origin: string; destination: string; seatNumber: number; seatPosition: string; price: number; createdAt: number }
  trip: { departureAt: number }
  bus?: { plate: string; internalCode: string }
  driver?: { fullName: string }
}>()

function formatDate(value: number, includeTime = true) {
  return new Intl.DateTimeFormat('es-PE', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' }).format(new Date(value))
}
function formatMoney(value: number) { return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value) }
</script>

<template>
  <article class="ticket-receipt">
    <header class="receipt-header"><div class="receipt-brand"><span class="receipt-mark"><AppGlyph name="bus" /></span><span><strong>RUTA AZUL</strong><small>Transporte interprovincial</small></span></div><div class="receipt-kind"><span>BOLETO DE VIAJE</span><strong>{{ ticket.code }}</strong></div></header>
    <div class="receipt-route"><span>{{ ticket.origin }}</span><span class="receipt-route-line">⟶</span><span>{{ ticket.destination }}</span></div>
    <div class="receipt-grid">
      <div><small>PASAJERO</small><strong>{{ ticket.passengerName }}</strong></div>
      <div><small>DNI</small><strong>{{ ticket.passengerDni }}</strong></div>
      <div><small>FECHA DE SALIDA</small><strong>{{ formatDate(trip.departureAt) }}</strong></div>
      <div><small>ASIENTO</small><strong>{{ ticket.seatNumber }} · {{ ticket.seatPosition }}</strong></div>
      <div><small>BUS</small><strong>{{ bus?.plate || '—' }} <span v-if="bus">· {{ bus.internalCode }}</span></strong></div>
      <div><small>CHOFER</small><strong>{{ driver?.fullName || '—' }}</strong></div>
      <div><small>EMITIDO</small><strong>{{ formatDate(ticket.createdAt) }}</strong></div>
      <div><small>PRECIO</small><strong>{{ formatMoney(ticket.price) }}</strong></div>
    </div>
    <footer class="receipt-footer"><span>Conserve este boleto para abordar.</span><span>{{ ticket.code }}</span></footer>
  </article>
</template>
