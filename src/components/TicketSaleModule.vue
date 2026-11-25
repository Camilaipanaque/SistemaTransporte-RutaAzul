<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onValue, push, ref as databaseRef, runTransaction } from 'firebase/database'
import { auth, db } from '../firebase'
import AppGlyph from './AppGlyph.vue'
import TicketReceipt from './TicketReceipt.vue'
import { getSegmentKeys, seatIsAvailable, ticketRoutesForTrip, type RoutePair, type RouteStop } from '../modules/operations/routes'
import { validateTicketForm } from '../modules/operations/validation'

const ADMIN_UID = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
interface TripRecord { id: string; busId: string; driverId: string; origin: RouteStop; destination: RouteStop; departureAt: number; status: string; seatSegments?: Record<string, Record<string, string>>; tickets?: Record<string, TicketRecord> }
interface TicketRecord { id: string; code: string; tripId: string; passengerName: string; passengerDni: string; origin: RouteStop; destination: RouteStop; segments: string[]; seatNumber: number; seatPosition: 'Ventana' | 'Pasillo'; price: number; createdAt: number }
interface BusRecord { id: string; plate: string; internalCode: string; status: string }
interface DriverRecord { id: string; fullName: string; status: string }
const trips = ref<TripRecord[]>([])
const buses = ref<BusRecord[]>([])
const drivers = ref<DriverRecord[]>([])
const loading = ref(true)
const loadError = ref('')
const selling = ref(false)
const operationError = ref('')
const successMessage = ref('')
const selectedTripId = ref('')
const selectedRoute = ref('')
const passengerName = ref('')
const passengerDni = ref('')
const price = ref('')
const selectedSeat = ref<number | null>(null)
const errors = ref<Record<string, string>>({})
const lastSale = ref<{ ticket: TicketRecord; trip: TripRecord; bus: BusRecord | undefined; driver: DriverRecord | undefined } | null>(null)
let stops: Array<() => void> = []

const availableTrips = computed(() => trips.value.filter((trip) => trip.status === 'Programado' && trip.departureAt > Date.now()
  && buses.value.some((bus) => bus.id === trip.busId && bus.status === 'Operativo')
  && drivers.value.some((driver) => driver.id === trip.driverId && driver.status === 'Activo')))
const selectedTrip = computed(() => availableTrips.value.find((trip) => trip.id === selectedTripId.value))
const saleRoutes = computed(() => selectedTrip.value ? ticketRoutesForTrip(selectedTrip.value) : [])
const currentRoute = computed<RoutePair | undefined>(() => {
  const [origin, destination] = selectedRoute.value.split('|')
  return origin && destination ? { origin: origin as RouteStop, destination: destination as RouteStop } : undefined
})
const routeSegments = computed(() => currentRoute.value ? getSegmentKeys(currentRoute.value.origin, currentRoute.value.destination) : [])
const seats = computed(() => Array.from({ length: 39 }, (_, index) => ({
  number: index + 1,
  row: index < 36 ? Math.floor(index / 4) + 1 : 10,
  column: index < 36 ? [2, 3, 5, 6][index % 4] : index === 36 ? 2 : index === 37 ? 4 : 6,
  position: index < 36 ? (index % 4 === 0 || index % 4 === 3 ? 'Ventana' : 'Pasillo') : (index === 37 ? 'Pasillo' : 'Ventana'),
})))
const occupiedSeats = computed(() => {
  const occupied = new Set<number>()
  if (!selectedTrip.value) return occupied
  for (const segment of routeSegments.value) {
    for (const seatNumber of Object.keys(selectedTrip.value.seatSegments?.[segment] || {})) occupied.add(Number(seatNumber))
  }
  return occupied
})

function firebaseError(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === 'PERMISSION_DENIED' || code === 'database/permission-denied') return 'Firebase rechazó la operación. Comprueba las reglas de trips y la sesión administrativa.'
  return 'No se pudo comunicar con Firebase. Revisa la conexión e inténtalo nuevamente.'
}

function load() {
  if (auth.currentUser?.uid !== ADMIN_UID) { loading.value = false; loadError.value = 'La sesión administrativa expiró. Inicia sesión nuevamente.'; return }
  stops.forEach((stop) => stop())
  loading.value = true
  loadError.value = ''
  let pending = 3
  const loaded = () => { pending -= 1; if (pending <= 0) loading.value = false }
  const failed = (error: Error) => { loading.value = false; loadError.value = firebaseError(error) }
  stops = [
    onValue(databaseRef(db, 'trips'), (snapshot) => { const value = snapshot.val() || {}; trips.value = Object.entries(value).map(([id, trip]) => ({ id, ...(trip as Omit<TripRecord, 'id'>) })); loaded() }, failed),
    onValue(databaseRef(db, 'buses'), (snapshot) => { const value = snapshot.val() || {}; buses.value = Object.entries(value).map(([id, bus]) => ({ id, ...(bus as Omit<BusRecord, 'id'>) })); loaded() }, failed),
    onValue(databaseRef(db, 'drivers'), (snapshot) => { const value = snapshot.val() || {}; drivers.value = Object.entries(value).map(([id, driver]) => ({ id, ...(driver as Omit<DriverRecord, 'id'>) })); loaded() }, failed),
  ]
}

onMounted(load)
onUnmounted(() => stops.forEach((stop) => stop()))

function setTrip(value: string) {
  selectedTripId.value = value
  selectedRoute.value = ''
  selectedSeat.value = null
  const first = selectedTrip.value ? ticketRoutesForTrip(selectedTrip.value)[0] : undefined
  if (first) selectedRoute.value = `${first.origin}|${first.destination}`
}

function setRoute(value: string) { selectedRoute.value = value; selectedSeat.value = null; errors.value = {} }
function seatPosition(number: number) { return seats.value.find((seat) => seat.number === number)?.position || 'Ventana' }
function routeName(trip: TripRecord) { return `${trip.origin} → ${trip.destination}` }
function driverName(id: string) { return drivers.value.find((driver) => driver.id === id)?.fullName || 'Chofer' }
function busName(id: string) { return buses.value.find((bus) => bus.id === id)?.plate || 'Bus' }
function formatDate(value: number) { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function printLastSale() { window.print() }

async function sellTicket() {
  operationError.value = ''
  successMessage.value = ''
  const route = currentRoute.value
  errors.value = validateTicketForm({ tripId: selectedTripId.value, origin: route?.origin || '', destination: route?.destination || '', passengerName: passengerName.value, passengerDni: passengerDni.value, price: price.value, seatNumber: selectedSeat.value }, selectedTrip.value)
  if (Object.keys(errors.value).length) return
  if (auth.currentUser?.uid !== ADMIN_UID) { operationError.value = 'Tu sesión no tiene autorización. Inicia sesión nuevamente.'; return }

  const trip = selectedTrip.value
  const bus = trip && buses.value.find((item) => item.id === trip.busId)
  const driver = trip && drivers.value.find((item) => item.id === trip.driverId)
  if (!trip || !route || !bus || bus.status !== 'Operativo' || !driver || driver.status !== 'Activo') {
    operationError.value = 'El viaje seleccionado ya no está disponible para la venta.'
    return
  }

  selling.value = true
  let occupiedSeat = false
  let tripUnavailable = false
  try {
    const tripRef = databaseRef(db, `trips/${trip.id}`)
    const ticketId = push(databaseRef(db, `trips/${trip.id}/tickets`)).key
    if (!ticketId) throw new Error('No se pudo generar el identificador del boleto.')
    const segments = getSegmentKeys(route.origin, route.destination)
    const priceValue = Number(price.value)
    const seat = selectedSeat.value as number
    const seatType = seatPosition(seat) as 'Ventana' | 'Pasillo'
    const result = await runTransaction(tripRef, (currentValue) => {
      occupiedSeat = false
      tripUnavailable = false
      if (!currentValue || typeof currentValue !== 'object') { tripUnavailable = true; return }
      const current = currentValue as TripRecord
      if (current.status !== 'Programado' || current.departureAt <= Date.now()) { tripUnavailable = true; return }
      if (!seatIsAvailable(current.seatSegments, seat, segments)) { occupiedSeat = true; return }
      const now = Date.now()
      const ticket: TicketRecord = {
        id: ticketId,
        code: `RA-${now.toString(36).toUpperCase()}-${ticketId.slice(-5).toUpperCase()}`,
        tripId: trip.id,
        passengerName: passengerName.value.trim(),
        passengerDni: passengerDni.value.trim(),
        origin: route.origin,
        destination: route.destination,
        segments,
        seatNumber: seat,
        seatPosition: seatType,
        price: priceValue,
        createdAt: now,
      }
      const nextLocks = { ...(current.seatSegments || {}) }
      for (const segment of segments) nextLocks[segment] = { ...(nextLocks[segment] || {}), [String(seat)]: ticketId }
      return { ...current, seatSegments: nextLocks, tickets: { ...(current.tickets || {}), [ticketId]: ticket }, updatedAt: now }
    }, { applyLocally: false })

    if (!result.committed) {
      if (occupiedSeat) { operationError.value = 'Ese asiento acaba de ocuparse para uno de los tramos seleccionados. Elige otro asiento.'; selectedSeat.value = null }
      else if (tripUnavailable) operationError.value = 'El viaje ya no está disponible para la venta.'
      else operationError.value = 'Firebase no confirmó la venta. Actualiza los datos e inténtalo nuevamente.'
      return
    }
    const saved = (result.snapshot.val() as TripRecord).tickets?.[ticketId]
    if (!saved) { operationError.value = 'Firebase confirmó la reserva del asiento, pero no se pudo leer el boleto. Actualiza la vista.'; return }
    lastSale.value = { ticket: saved, trip, bus, driver }
    successMessage.value = 'El pasaje se registró correctamente en Firebase.'
    passengerName.value = ''
    passengerDni.value = ''
    price.value = ''
    selectedSeat.value = null
    errors.value = {}
  } catch (error) { operationError.value = firebaseError(error) }
  finally { selling.value = false }
}
</script>

<template>
  <div class="fleet-content sales-content">
    <section class="fleet-heading"><div><span class="section-kicker">ATENCIÓN AL PASAJERO</span><h1>Venta de pasajes</h1><p>Selecciona un viaje y un asiento libre para emitir el boleto.</p></div><span class="sales-security"><AppGlyph name="lock" /> Venta protegida</span></section>
    <div v-if="loadError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ loadError }}<button @click="load">Reintentar</button></div>
    <div v-if="operationError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ operationError }}<button aria-label="Cerrar mensaje" @click="operationError = ''">×</button></div>
    <div v-if="successMessage" class="fleet-alert alert-success" role="status"><AppGlyph name="check" />{{ successMessage }}<button aria-label="Cerrar mensaje" @click="successMessage = ''">×</button></div>

    <div v-if="loading" class="fleet-list panel fleet-state"><span class="loading-spinner"></span><span>Cargando viajes y disponibilidad desde Firebase…</span></div>
    <div v-else-if="loadError" class="fleet-list panel fleet-state fleet-state-error">No se pudo cargar la información necesaria para vender.</div>
    <div v-else-if="!availableTrips.length" class="fleet-list panel fleet-state fleet-empty"><span class="empty-icon"><AppGlyph name="ticket" /></span><strong>No hay viajes disponibles para la venta</strong><span>Programa un viaje futuro con un bus operativo y un chofer activo.</span></div>
    <template v-else>
      <section class="sale-panel panel">
        <div class="sale-section-title"><span class="step-number">1</span><div><strong>Elige el viaje y el tramo</strong><small>Las opciones dependen de la ruta programada.</small></div></div>
        <div class="sale-selection-grid">
          <label class="field"><span>Viaje <b>*</b></span><select :value="selectedTripId" @change="setTrip(($event.target as HTMLSelectElement).value)"><option value="">Selecciona fecha y ruta</option><option v-for="trip in availableTrips" :key="trip.id" :value="trip.id">{{ routeName(trip) }} · {{ formatDate(trip.departureAt) }}</option></select><small v-if="errors.tripId" class="field-error">{{ errors.tripId }}</small></label>
          <label class="field"><span>Tramo del pasaje <b>*</b></span><select :value="selectedRoute" :disabled="!selectedTrip" @change="setRoute(($event.target as HTMLSelectElement).value)"><option value="">Selecciona origen y destino</option><option v-for="route in saleRoutes" :key="`${route.origin}|${route.destination}`" :value="`${route.origin}|${route.destination}`">{{ route.origin }} → {{ route.destination }}</option></select><small v-if="errors.destination" class="field-error">{{ errors.destination }}</small></label>
        </div>
        <div v-if="selectedTrip" class="trip-meta"><span><AppGlyph name="bus" />{{ busName(selectedTrip.busId) }}</span><span><AppGlyph name="users" />{{ driverName(selectedTrip.driverId) }}</span><span><AppGlyph name="clock" />{{ formatDate(selectedTrip.departureAt) }}</span></div>
      </section>

      <div class="sale-main-grid">
        <section class="sale-panel panel seat-panel">
          <div class="sale-section-title"><span class="step-number">2</span><div><strong>Selecciona un asiento</strong><small>Disponibilidad validada en cada tramo.</small></div><span class="seat-total">39 asientos</span></div>
          <div v-if="!selectedTrip || !selectedRoute" class="seat-prompt"><AppGlyph name="route" /><span>Primero selecciona un viaje y un tramo.</span></div>
          <template v-else>
            <div class="seat-legend"><span><i class="seat-swatch available"></i>Disponible</span><span><i class="seat-swatch selected"></i>Seleccionado</span><span><i class="seat-swatch occupied"></i>Ocupado</span></div>
            <div class="bus-seat-map">
              <div class="driver-cabin"><span><AppGlyph name="steering" /> CONDUCTOR</span><span class="bus-front">FRENTE DEL BUS</span></div>
              <div class="seat-rows">
                <div v-for="row in 10" :key="row" class="seat-row" :class="{ 'rear-row': row === 10 }">
                  <span class="row-number">{{ row === 10 ? 'R' : row }}</span>
                  <template v-for="seat in seats.filter((item) => item.row === row)" :key="seat.number">
                    <button class="seat-button" :class="{ 'seat-selected': selectedSeat === seat.number, 'seat-occupied': occupiedSeats.has(seat.number), 'seat-window': seat.position === 'Ventana' }" :style="{ gridColumn: seat.column }" :disabled="occupiedSeats.has(seat.number) || selling" :title="`Asiento ${seat.number}, ${seat.position}${occupiedSeats.has(seat.number) ? ', ocupado en este tramo' : ''}`" @click="selectedSeat = seat.number; errors.seatNumber = ''"><span>{{ seat.number }}</span><small>{{ seat.position === 'Ventana' ? 'V' : 'P' }}</small></button>
                  </template>
                </div>
              </div>
              <div class="seat-position-hint"><span>V · Ventana</span><span>P · Pasillo</span></div>
            </div>
            <p v-if="errors.seatNumber" class="field-error seat-error">{{ errors.seatNumber }}</p>
          </template>
        </section>

        <section class="sale-panel panel passenger-panel">
          <div class="sale-section-title"><span class="step-number">3</span><div><strong>Datos del pasajero</strong><small>El precio lo ingresa el operador.</small></div></div>
          <form class="bus-form passenger-form" @submit.prevent="sellTicket">
            <label class="field"><span>Nombre completo <b>*</b></span><input v-model="passengerName" maxlength="100" placeholder="Nombres y apellidos" required :disabled="selling" /></label>
            <label class="field"><span>DNI <b>*</b></span><input v-model="passengerDni" inputmode="numeric" maxlength="8" minlength="8" placeholder="8 dígitos" required :disabled="selling" /><small v-if="errors.passengerDni" class="field-error">{{ errors.passengerDni }}</small></label>
            <label class="field"><span>Precio del pasaje (S/) <b>*</b></span><input v-model="price" type="number" min="0.01" step="0.01" placeholder="0.00" required :disabled="selling" /><small v-if="errors.price" class="field-error">{{ errors.price }}</small></label>
            <div class="selected-seat-summary"><span>Asiento</span><strong>{{ selectedSeat ? `${selectedSeat} · ${seatPosition(selectedSeat)}` : 'Selecciona en el croquis' }}</strong></div>
            <button class="fleet-primary-button sell-button" type="submit" :disabled="selling || !selectedTrip"><span v-if="selling" class="loading-spinner small"></span>{{ selling ? 'Confirmando en Firebase…' : 'Registrar venta y emitir boleto' }}</button>
          </form>
        </section>
      </div>
    </template>

    <section v-if="lastSale" class="sale-result panel"><div class="sale-result-heading"><div><span class="section-kicker">VENTA CONFIRMADA</span><h2>Boleto emitido</h2></div><button class="fleet-primary-button" @click="printLastSale"><AppGlyph name="print" /> Imprimir boleto</button></div><TicketReceipt :ticket="lastSale.ticket" :trip="lastSale.trip" :bus="lastSale.bus" :driver="lastSale.driver" /></section>
  </div>
</template>
