<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onValue, push, ref as databaseRef, runTransaction, set } from 'firebase/database'
import { auth, db } from '../firebase'
import AppGlyph from './AppGlyph.vue'
import { ALL_ROUTES } from '../modules/operations/routes'
import { validateTripForm } from '../modules/operations/validation'

const ADMIN_UID = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
type Status = 'Programado' | 'Finalizado' | 'Cancelado'
interface BusOption { id: string; plate: string; internalCode: string; status: string; capacity: number }
interface DriverOption { id: string; fullName: string; status: string }
interface TripRecord { id: string; busId: string; driverId: string; origin: string; destination: string; departureAt: number; status: Status; createdAt: number; updatedAt: number; tickets?: Record<string, unknown> }
const buses = ref<BusOption[]>([])
const drivers = ref<DriverOption[]>([])
const trips = ref<TripRecord[]>([])
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const operationError = ref('')
const successMessage = ref('')
const modalOpen = ref(false)
const editingTripId = ref<string | null>(null)
const formErrors = ref<Record<string, string>>({})
const form = ref({ busId: '', driverId: '', route: 'Pauza|Nasca', date: '', time: '' })
const routes = ALL_ROUTES
const localToday = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
})()
const availableBuses = computed(() => buses.value.filter((bus) => bus.status === 'Operativo' && bus.capacity === 39))
const availableDrivers = computed(() => drivers.value.filter((driver) => driver.status === 'Activo'))
const futureTrips = computed(() => trips.value.filter((trip) => trip.status === 'Programado' && trip.departureAt >= Date.now()).length)
let stops: Array<() => void> = []

function firebaseError(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === 'PERMISSION_DENIED' || code === 'database/permission-denied') return 'Firebase rechazó la operación. Revisa los permisos de los nodos buses, drivers y trips.'
  return 'No se pudo completar la operación con Firebase. Revisa la conexión e inténtalo nuevamente.'
}

function load() {
  if (auth.currentUser?.uid !== ADMIN_UID) { loading.value = false; loadError.value = 'La sesión administrativa expiró. Inicia sesión nuevamente.'; return }
  stops.forEach((stop) => stop())
  loading.value = true
  loadError.value = ''
  let pending = 3
  const markLoaded = () => { pending -= 1; if (pending <= 0) loading.value = false }
  const handleError = (error: Error) => { loadError.value = firebaseError(error); loading.value = false }
  stops = [
    onValue(databaseRef(db, 'buses'), (snapshot) => { const value = snapshot.val() || {}; buses.value = Object.entries(value).map(([id, bus]) => ({ id, ...(bus as Omit<BusOption, 'id'>) })); markLoaded() }, handleError),
    onValue(databaseRef(db, 'drivers'), (snapshot) => { const value = snapshot.val() || {}; drivers.value = Object.entries(value).map(([id, driver]) => ({ id, ...(driver as Omit<DriverOption, 'id'>) })); markLoaded() }, handleError),
    onValue(databaseRef(db, 'trips'), (snapshot) => { const value = snapshot.val() || {}; trips.value = Object.entries(value).map(([id, trip]) => ({ id, ...(trip as Omit<TripRecord, 'id'>) })).sort((a, b) => a.departureAt - b.departureAt); markLoaded() }, handleError),
  ]
}

onMounted(load)
onUnmounted(() => stops.forEach((stop) => stop()))

function toLocalInputs(timestamp: number) {
  const date = new Date(timestamp)
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  }
}

function openForm(trip?: TripRecord) {
  editingTripId.value = trip?.id ?? null
  const localTime = trip ? toLocalInputs(trip.departureAt) : { date: '', time: '' }
  form.value = { busId: trip?.busId || availableBuses.value[0]?.id || '', driverId: trip?.driverId || availableDrivers.value[0]?.id || '', route: trip ? `${trip.origin}|${trip.destination}` : 'Pauza|Nasca', ...localTime }
  formErrors.value = {}
  operationError.value = ''
  successMessage.value = ''
  modalOpen.value = true
}

function routeLabel(origin: string, destination: string) { return `${origin} → ${destination}` }
function formatDate(value: number) { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function busName(id: string) { const bus = buses.value.find((item) => item.id === id); return bus ? `${bus.plate} · ${bus.internalCode}` : 'Bus no disponible' }
function driverName(id: string) { return drivers.value.find((item) => item.id === id)?.fullName || 'Chofer no disponible' }

async function saveTrip() {
  const [origin, destination] = form.value.route.split('|')
  const values = { ...form.value, origin, destination }
  formErrors.value = validateTripForm(values)
  operationError.value = ''
  successMessage.value = ''
  if (Object.keys(formErrors.value).length) return
  if (auth.currentUser?.uid !== ADMIN_UID) { operationError.value = 'Tu sesión no tiene autorización. Vuelve a iniciar sesión.'; return }
  const bus = availableBuses.value.find((item) => item.id === form.value.busId)
  const driver = availableDrivers.value.find((item) => item.id === form.value.driverId)
  if (!bus || !driver) { operationError.value = 'El bus debe estar operativo y el chofer activo antes de programar el viaje.'; return }
  saving.value = true
  try {
    const departureAt = new Date(`${form.value.date}T${form.value.time}`).getTime()
    const now = Date.now()
    if (editingTripId.value) {
      const tripRef = databaseRef(db, `trips/${editingTripId.value}`)
      const result = await runTransaction(tripRef, (currentValue) => {
        if (!currentValue || typeof currentValue !== 'object') return
        const current = currentValue as TripRecord
        if (current.status !== 'Programado' || Object.keys(current.tickets || {}).length) return
        return { ...current, busId: bus.id, driverId: driver.id, origin, destination, departureAt, updatedAt: now }
      }, { applyLocally: false })
      if (!result.committed) {
        operationError.value = 'No se pudo actualizar: el viaje ya no está disponible o tiene boletos emitidos.'
        return
      }
      successMessage.value = 'El viaje se actualizó correctamente.'
    } else {
      const id = push(databaseRef(db, 'trips')).key
      if (!id) throw new Error('No se pudo generar el identificador del viaje.')
      await set(databaseRef(db, `trips/${id}`), { busId: bus.id, driverId: driver.id, origin, destination, departureAt, status: 'Programado', createdAt: now, updatedAt: now })
      successMessage.value = 'El viaje se programó correctamente.'
    }
    modalOpen.value = false
  } catch (error) { operationError.value = firebaseError(error) }
  finally { saving.value = false }
}

async function cancelTrip(trip: TripRecord) {
  operationError.value = ''
  successMessage.value = ''
  if (auth.currentUser?.uid !== ADMIN_UID) { operationError.value = 'Tu sesión no tiene autorización. Vuelve a iniciar sesión.'; return }
  saving.value = true
  try {
    const result = await runTransaction(databaseRef(db, `trips/${trip.id}`), (currentValue) => {
      if (!currentValue || typeof currentValue !== 'object') return
      const current = currentValue as TripRecord
      if (current.status !== 'Programado' || Object.keys(current.tickets || {}).length) return
      return { ...current, status: 'Cancelado', updatedAt: Date.now() }
    }, { applyLocally: false })
    if (!result.committed) { operationError.value = 'No se pudo cancelar: el viaje ya no está disponible o tiene boletos emitidos.'; return }
    successMessage.value = 'El viaje se canceló correctamente.'
  } catch (error) { operationError.value = firebaseError(error) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="fleet-content">
    <section class="fleet-heading"><div><span class="section-kicker">PROGRAMACIÓN DE SERVICIOS</span><h1>Gestión de viajes</h1><p>Programa salidas con buses operativos y choferes activos.</p></div><button class="fleet-primary-button" :disabled="loading || !availableBuses.length || !availableDrivers.length" @click="openForm()"><AppGlyph name="plus" /> Programar viaje</button></section>
    <div v-if="successMessage" class="fleet-alert alert-success" role="status"><AppGlyph name="check" />{{ successMessage }}<button aria-label="Cerrar mensaje" @click="successMessage = ''">×</button></div>
    <div v-if="loadError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ loadError }}<button @click="load">Reintentar</button></div>
    <div v-if="operationError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ operationError }}<button aria-label="Cerrar mensaje" @click="operationError = ''">×</button></div>
    <section class="driver-summary"><div class="driver-summary-icon"><AppGlyph name="route" /></div><div><span>Viajes programados</span><strong>{{ futureTrips }}</strong></div><div class="driver-summary-divider"></div><div><span>Rutas habilitadas</span><strong>{{ routes.length }}</strong></div></section>
    <section class="fleet-list panel"><div class="fleet-list-heading"><div><span class="section-kicker">SALIDAS</span><h2>Viajes programados</h2></div><span class="updated-label"><AppGlyph name="clock" /> Horarios locales</span></div>
      <div v-if="loading" class="fleet-state"><span class="loading-spinner"></span><span>Cargando buses, choferes y viajes…</span></div>
      <div v-else-if="loadError" class="fleet-state fleet-state-error">No fue posible cargar los datos para programar viajes.</div>
      <div v-else-if="!trips.length" class="fleet-state fleet-empty"><span class="empty-icon"><AppGlyph name="route" /></span><strong>Aún no hay viajes programados</strong><span>Programa una salida para habilitar la venta de pasajes.</span><button class="fleet-secondary-button" :disabled="!availableBuses.length || !availableDrivers.length" @click="openForm()">Programar primer viaje</button><small v-if="!availableBuses.length || !availableDrivers.length" class="field-hint">Se requiere al menos un bus operativo y un chofer activo.</small></div>
      <div v-else class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>RUTA</th><th>FECHA Y HORA</th><th>BUS</th><th>CHOFER</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>
        <tr v-for="trip in trips" :key="trip.id"><td><strong class="bus-name">{{ routeLabel(trip.origin, trip.destination) }}</strong></td><td>{{ formatDate(trip.departureAt) }}</td><td>{{ busName(trip.busId) }}</td><td>{{ driverName(trip.driverId) }}</td><td><span class="status-badge" :class="trip.status === 'Programado' ? 'status-operational' : 'status-inactive'"><i></i>{{ trip.status }}</span></td><td><button v-if="trip.status === 'Programado' && trip.departureAt > Date.now() && !Object.keys(trip.tickets || {}).length" class="action-edit" :disabled="saving" @click="openForm(trip)"><AppGlyph name="edit" />Editar</button><button v-if="trip.status === 'Programado' && trip.departureAt > Date.now() && !Object.keys(trip.tickets || {}).length" class="action-edit" :disabled="saving" @click="cancelTrip(trip)">Cancelar</button><span v-if="Object.keys(trip.tickets || {}).length" class="bus-code">Con boletos emitidos</span></td></tr>
      </tbody></table></div>
    </section>
    <div v-if="modalOpen" class="fleet-modal-backdrop" @click.self="!saving && (modalOpen = false)"><section class="fleet-modal" role="dialog" aria-modal="true" aria-labelledby="trip-form-title"><header class="fleet-modal-header"><div><span class="section-kicker">GESTIÓN DE SALIDAS</span><h2 id="trip-form-title">{{ editingTripId ? 'Editar viaje' : 'Programar viaje' }}</h2></div><button class="modal-close" aria-label="Cerrar formulario" :disabled="saving" @click="modalOpen = false">×</button></header><p class="fleet-modal-copy">Selecciona una ruta, un bus operativo y un chofer activo.</p>
      <form class="bus-form" @submit.prevent="saveTrip"><div class="form-grid">
        <label class="field field-full"><span>Ruta <b>*</b></span><select v-model="form.route" :disabled="saving"><option v-for="route in routes" :key="`${route.origin}|${route.destination}`" :value="`${route.origin}|${route.destination}`">{{ routeLabel(route.origin, route.destination) }}</option></select><small v-if="formErrors.destination" class="field-error">{{ formErrors.destination }}</small></label>
        <label class="field"><span>Bus <b>*</b></span><select v-model="form.busId" :disabled="saving || !availableBuses.length"><option value="">Selecciona un bus</option><option v-for="bus in availableBuses" :key="bus.id" :value="bus.id">{{ bus.plate }} · {{ bus.internalCode }}</option></select><small v-if="formErrors.busId" class="field-error">{{ formErrors.busId }}</small></label>
        <label class="field"><span>Chofer <b>*</b></span><select v-model="form.driverId" :disabled="saving || !availableDrivers.length"><option value="">Selecciona un chofer</option><option v-for="driver in availableDrivers" :key="driver.id" :value="driver.id">{{ driver.fullName }}</option></select><small v-if="formErrors.driverId" class="field-error">{{ formErrors.driverId }}</small></label>
        <label class="field"><span>Fecha <b>*</b></span><input v-model="form.date" type="date" required :min="localToday" :disabled="saving" /><small v-if="formErrors.date" class="field-error">{{ formErrors.date }}</small></label>
        <label class="field"><span>Horario de salida <b>*</b></span><input v-model="form.time" type="time" required :disabled="saving" /><small v-if="formErrors.date" class="field-error">{{ formErrors.date }}</small></label>
      </div><div v-if="operationError" class="form-operation-error" role="alert">{{ operationError }}</div><footer class="form-actions"><button type="button" class="fleet-cancel-button" :disabled="saving" @click="modalOpen = false">Cerrar</button><button type="submit" class="fleet-primary-button" :disabled="saving || !availableBuses.length || !availableDrivers.length"><span v-if="saving" class="loading-spinner small"></span>{{ saving ? 'Guardando…' : (editingTripId ? 'Guardar cambios' : 'Programar viaje') }}</button></footer></form>
    </section></div>
  </div>
</template>
