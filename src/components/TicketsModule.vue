<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onValue, ref as databaseRef } from 'firebase/database'
import { auth, db } from '../firebase'
import AppGlyph from './AppGlyph.vue'
import TicketReceipt from './TicketReceipt.vue'

const ADMIN_UID = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
interface TicketRecord { id: string; code: string; passengerName: string; passengerDni: string; origin: string; destination: string; seatNumber: number; seatPosition: string; price: number; createdAt: number }
interface TripRecord { id: string; departureAt: number; origin: string; destination: string; busId: string; driverId: string; tickets?: Record<string, TicketRecord> }
interface BusRecord { id: string; plate: string; internalCode: string }
interface DriverRecord { id: string; fullName: string }
interface TicketView { ticket: TicketRecord; trip: TripRecord; bus?: BusRecord; driver?: DriverRecord }
const rawTrips = ref<TripRecord[]>([])
const buses = ref<BusRecord[]>([])
const drivers = ref<DriverRecord[]>([])
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const selectedId = ref('')
let stops: Array<() => void> = []

const filteredTickets = computed(() => {
  const search = query.value.trim().toLocaleLowerCase('es-PE')
  return tickets.value.filter(({ ticket }) => !search || [ticket.code, ticket.passengerName, ticket.passengerDni, ticket.origin, ticket.destination].some((value) => value.toLocaleLowerCase('es-PE').includes(search)))
})
const tickets = computed<TicketView[]>(() => rawTrips.value.flatMap((trip) => Object.values(trip.tickets || {}).map((ticket) => ({ ticket, trip, bus: buses.value.find((item) => item.id === trip.busId), driver: drivers.value.find((item) => item.id === trip.driverId) })))
  .sort((a, b) => b.ticket.createdAt - a.ticket.createdAt))
const selectedTicket = computed(() => tickets.value.find(({ ticket }) => ticket.id === selectedId.value))

function load() {
  if (auth.currentUser?.uid !== ADMIN_UID) { loading.value = false; loadError.value = 'La sesión administrativa expiró. Inicia sesión nuevamente.'; return }
  stops.forEach((stop) => stop())
  loading.value = true
  loadError.value = ''
  let pending = 3
  const loaded = () => { pending -= 1; if (pending <= 0) loading.value = false }
  const fail = (error: Error) => { loadError.value = (error as { code?: string }).code === 'PERMISSION_DENIED' ? 'Firebase rechazó la lectura de boletos.' : 'No se pudo conectar con Firebase.'; loading.value = false }
  stops = [
    onValue(databaseRef(db, 'trips'), (snapshot) => {
      const value = snapshot.val() || {}
      const tripRecords = Object.entries(value).map(([id, trip]) => ({ id, ...(trip as Omit<TripRecord, 'id'>) }))
      rawTrips.value = tripRecords
      loaded()
    }, fail),
    onValue(databaseRef(db, 'buses'), (snapshot) => { const value = snapshot.val() || {}; buses.value = Object.entries(value).map(([id, bus]) => ({ id, ...(bus as Omit<BusRecord, 'id'>) })); loaded() }, fail),
    onValue(databaseRef(db, 'drivers'), (snapshot) => { const value = snapshot.val() || {}; drivers.value = Object.entries(value).map(([id, driver]) => ({ id, ...(driver as Omit<DriverRecord, 'id'>) })); loaded() }, fail),
  ]
}

onMounted(load)
onUnmounted(() => stops.forEach((stop) => stop()))

function money(value: number) { return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value) }
function date(value: number) { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function printTicket(id: string) { selectedId.value = id; window.setTimeout(() => window.print(), 50) }
</script>

<template>
  <div class="fleet-content">
    <section class="fleet-heading"><div><span class="section-kicker">REGISTRO DE VENTAS</span><h1>Boletos emitidos</h1><p>Consulta e imprime los boletos guardados en Firebase.</p></div></section>
    <div v-if="loadError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ loadError }}<button @click="load">Reintentar</button></div>
    <section class="fleet-list panel">
      <div class="fleet-list-heading"><div><span class="section-kicker">HISTORIAL</span><h2>{{ tickets.length }} boletos</h2></div><label class="fleet-search"><AppGlyph name="search" /><input v-model="query" type="search" placeholder="Buscar código, pasajero o DNI…" aria-label="Buscar boleto" /></label></div>
      <div v-if="loading" class="fleet-state"><span class="loading-spinner"></span><span>Cargando boletos desde Firebase…</span></div>
      <div v-else-if="loadError" class="fleet-state fleet-state-error">No se pudo cargar el historial.</div>
      <div v-else-if="!tickets.length" class="fleet-state fleet-empty"><span class="empty-icon"><AppGlyph name="receipt" /></span><strong>Aún no hay boletos emitidos</strong><span>Los boletos aparecerán aquí después de confirmar una venta.</span></div>
      <div v-else-if="!filteredTickets.length" class="fleet-state">No hay boletos que coincidan con la búsqueda.</div>
      <div v-else class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>CÓDIGO</th><th>PASAJERO</th><th>RUTA</th><th>SALIDA</th><th>ASIENTO</th><th>PRECIO</th><th>BOLETO</th></tr></thead><tbody>
        <tr v-for="item in filteredTickets" :key="item.ticket.id"><td><strong class="bus-name">{{ item.ticket.code }}</strong></td><td><strong class="bus-name">{{ item.ticket.passengerName }}</strong><span class="bus-code">DNI {{ item.ticket.passengerDni }}</span></td><td>{{ item.ticket.origin }} → {{ item.ticket.destination }}</td><td>{{ date(item.trip.departureAt) }}</td><td>{{ item.ticket.seatNumber }} · {{ item.ticket.seatPosition }}</td><td>{{ money(item.ticket.price) }}</td><td><button class="action-edit" @click="printTicket(item.ticket.id)"><AppGlyph name="print" />Imprimir</button></td></tr>
      </tbody></table></div>
    </section>
    <div v-if="selectedTicket" class="ticket-print-root"><TicketReceipt :ticket="selectedTicket.ticket" :trip="selectedTicket.trip" :bus="selectedTicket.bus" :driver="selectedTicket.driver" /></div>
  </div>
</template>
