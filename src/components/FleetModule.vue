<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onValue, push, ref as databaseRef, runTransaction, type DataSnapshot } from 'firebase/database'
import { auth, db } from '../firebase'
import AppGlyph from './AppGlyph.vue'
import StatCard from './StatCard.vue'
import { normalizeFleetIdentifier, validateBusForm, type BusFormErrors, type BusFormValues, type BusStatus } from '../modules/fleet/validation'

const ADMIN_UID = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
const currentYear = new Date().getFullYear()
interface BusRecord extends BusFormValues {
  id: string
  year: number
  createdAt: number
  updatedAt: number
}
interface StoredBus extends Omit<BusRecord, 'id'> {}

const statuses: BusStatus[] = ['Operativo', 'En mantenimiento', 'Inactivo']
const buses = ref<BusRecord[]>([])
const isLoading = ref(true)
const isSaving = ref(false)
const loadError = ref('')
const operationError = ref('')
const successMessage = ref('')
const searchQuery = ref('')
const statusFilter = ref<'Todos' | BusStatus>('Todos')
const modalOpen = ref(false)
const editingBusId = ref<string | null>(null)
const statusOnly = ref(false)
const formErrors = ref<BusFormErrors>({})
const form = ref<BusFormValues>(emptyForm())
let unsubscribe: (() => void) | undefined

function emptyForm(): BusFormValues {
  return { internalCode: '', plate: '', brand: '', model: '', year: '', capacity: 39, status: 'Operativo', observations: '' }
}

const counts = computed(() => ({
  total: buses.value.length,
  operational: buses.value.filter((bus) => bus.status === 'Operativo').length,
  maintenance: buses.value.filter((bus) => bus.status === 'En mantenimiento').length,
  inactive: buses.value.filter((bus) => bus.status === 'Inactivo').length,
}))

const metrics = computed(() => [
  { label: 'Buses registrados', value: String(counts.value.total), detail: 'Registro real', icon: 'bus', tone: 'blue' },
  { label: 'Operativos', value: String(counts.value.operational), detail: 'Disponibles', icon: 'check', tone: 'cyan' },
  { label: 'En mantenimiento', value: String(counts.value.maintenance), detail: 'Atención técnica', icon: 'tools', tone: 'amber' },
  { label: 'Inactivos', value: String(counts.value.inactive), detail: 'Fuera de servicio', icon: 'pause', tone: 'violet' },
])

const filteredBuses = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('es-PE')
  return buses.value.filter((bus) => {
    const matchesStatus = statusFilter.value === 'Todos' || bus.status === statusFilter.value
    const matchesQuery = !query || [bus.plate, bus.internalCode, bus.brand, bus.model]
      .some((value) => value.toLocaleLowerCase('es-PE').includes(query))
    return matchesStatus && matchesQuery
  })
})

function errorMessage(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === 'PERMISSION_DENIED' || code === 'database/permission-denied') {
    return 'Firebase rechazó la operación. Verifica que la cuenta tenga permiso para el nodo buses.'
  }
  if (code === 'NETWORK_ERROR' || code === 'network-request-failed') {
    return 'No se pudo conectar con Firebase. Revisa tu conexión e inténtalo nuevamente.'
  }
  return 'No se pudo completar la operación con Firebase. Inténtalo nuevamente.'
}

function receiveBuses(snapshot: DataSnapshot) {
  const value = snapshot.val() as Record<string, StoredBus> | null
  buses.value = value
    ? Object.entries(value).map(([id, bus]) => ({ id, ...bus }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    : []
  isLoading.value = false
  loadError.value = ''
}

function loadBuses() {
  if (auth.currentUser?.uid !== ADMIN_UID) {
    isLoading.value = false
    loadError.value = 'La sesión administrativa expiró. Vuelve a iniciar sesión.'
    return
  }
  isLoading.value = true
  loadError.value = ''
  unsubscribe?.()
  unsubscribe = onValue(databaseRef(db, 'buses'), receiveBuses, (error) => {
    isLoading.value = false
    loadError.value = errorMessage(error)
  })
}

onMounted(loadBuses)

onUnmounted(() => unsubscribe?.())

function openCreateForm() {
  editingBusId.value = null
  statusOnly.value = false
  form.value = emptyForm()
  formErrors.value = {}
  operationError.value = ''
  successMessage.value = ''
  modalOpen.value = true
}

function openEditForm(bus: BusRecord, forStatus = false) {
  editingBusId.value = bus.id
  statusOnly.value = forStatus
  form.value = {
    internalCode: bus.internalCode,
    plate: bus.plate,
    brand: bus.brand,
    model: bus.model,
    year: String(bus.year),
    capacity: 39,
    status: bus.status,
    observations: bus.observations || '',
  }
  formErrors.value = {}
  operationError.value = ''
  successMessage.value = ''
  modalOpen.value = true
}

function closeForm() {
  if (isSaving.value) return
  modalOpen.value = false
  formErrors.value = {}
}

function confirmDeactivation(previousStatus?: BusStatus) {
  return form.value.status !== 'Inactivo' || previousStatus === 'Inactivo'
    || window.confirm('¿Confirmas que deseas marcar este bus como inactivo? Se conservará su historial y no se eliminará.')
}

function uniqueDuplicate(records: Record<string, StoredBus>, id: string, values: BusFormValues) {
  for (const [otherId, bus] of Object.entries(records)) {
    if (otherId === id) continue
    if (normalizeFleetIdentifier(bus.plate) === normalizeFleetIdentifier(values.plate)) return 'plate' as const
    if (normalizeFleetIdentifier(bus.internalCode) === normalizeFleetIdentifier(values.internalCode)) return 'internalCode' as const
  }
  return null
}

async function saveBus() {
  formErrors.value = validateBusForm(form.value)
  operationError.value = ''
  successMessage.value = ''
  if (Object.keys(formErrors.value).length) return

  const current = editingBusId.value ? buses.value.find((bus) => bus.id === editingBusId.value) : undefined
  if (editingBusId.value && !current) {
    operationError.value = 'Este bus ya no aparece en el registro. Actualiza la lista e inténtalo nuevamente.'
    return
  }
  if (!confirmDeactivation(current?.status)) return
  if (auth.currentUser?.uid !== ADMIN_UID) {
    operationError.value = 'Tu sesión no tiene autorización. Vuelve a iniciar sesión.'
    return
  }

  isSaving.value = true
  let duplicateField: 'plate' | 'internalCode' | null = null
  let recordDisappeared = false
  try {
    const busesRef = databaseRef(db, 'buses')
    const id = editingBusId.value || push(busesRef).key
    if (!id) throw new Error('No se pudo crear un identificador para el bus.')
    const result = await runTransaction(busesRef, (currentValue) => {
      duplicateField = null
      recordDisappeared = false
      const records = (currentValue && typeof currentValue === 'object' ? currentValue : {}) as Record<string, StoredBus>
      const duplicate = uniqueDuplicate(records, id, form.value)
      if (duplicate) {
        duplicateField = duplicate
        return
      }
      const previous = records[id]
      if (editingBusId.value && !previous) {
        recordDisappeared = true
        return
      }
      const timestamp = Date.now()
      const nextRecords = { ...records }
      nextRecords[id] = {
        internalCode: form.value.internalCode.trim(),
        plate: form.value.plate.trim().toLocaleUpperCase('es-PE'),
        brand: form.value.brand.trim(),
        model: form.value.model.trim(),
        year: Number(form.value.year),
        capacity: 39,
        status: form.value.status,
        observations: form.value.observations.trim(),
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      return nextRecords
    }, { applyLocally: false })

    if (!result.committed) {
      if (duplicateField === 'plate') formErrors.value.plate = 'Ya existe un bus registrado con esta placa.'
      else if (duplicateField === 'internalCode') formErrors.value.internalCode = 'Ya existe un bus con este código interno.'
      else if (recordDisappeared) operationError.value = 'El registro cambió mientras lo editabas. Actualiza la lista e inténtalo nuevamente.'
      else operationError.value = 'Firebase no confirmó el cambio. Actualiza la lista antes de volver a intentarlo.'
      return
    }

    successMessage.value = editingBusId.value ? 'La información del bus se actualizó correctamente.' : 'El bus se registró correctamente.'
    modalOpen.value = false
  } catch (error) {
    operationError.value = errorMessage(error)
  } finally {
    isSaving.value = false
  }
}

function formatDate(value: number) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value))
}

function statusClass(status: BusStatus) {
  return status === 'Operativo' ? 'status-operational' : status === 'En mantenimiento' ? 'status-maintenance' : 'status-inactive'
}
</script>

<template>
  <div class="fleet-content">
    <section class="fleet-heading">
      <div>
        <span class="section-kicker">ADMINISTRACIÓN DE TRANSPORTE</span>
        <h1>Flota de transporte</h1>
        <p>Administra los buses registrados y consulta su estado operativo.</p>
      </div>
      <button class="fleet-primary-button" @click="openCreateForm"><AppGlyph name="plus" /> Registrar bus</button>
    </section>

    <div v-if="successMessage" class="fleet-alert alert-success" role="status"><AppGlyph name="check" />{{ successMessage }}<button aria-label="Cerrar mensaje" @click="successMessage = ''">×</button></div>
    <div v-if="loadError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ loadError }}<button aria-label="Reintentar lectura" @click="loadBuses">Reintentar</button></div>
    <div v-if="operationError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ operationError }}<button aria-label="Cerrar mensaje" @click="operationError = ''">×</button></div>

    <section class="fleet-metrics" aria-label="Resumen de la flota">
      <StatCard v-for="metric in metrics" :key="metric.label" v-bind="metric" />
    </section>

    <section class="fleet-list panel">
      <div class="fleet-list-heading">
        <div><span class="section-kicker">INVENTARIO</span><h2>Buses registrados</h2></div>
        <div class="fleet-filters">
          <label class="fleet-search"><AppGlyph name="search" /><input v-model="searchQuery" type="search" placeholder="Buscar bus…" aria-label="Buscar por placa, código, marca o modelo" /></label>
          <select v-model="statusFilter" aria-label="Filtrar por estado"><option>Todos</option><option v-for="status in statuses" :key="status">{{ status }}</option></select>
        </div>
      </div>

      <div v-if="isLoading" class="fleet-state"><span class="loading-spinner"></span><span>Cargando buses desde Firebase…</span></div>
      <div v-else-if="loadError" class="fleet-state fleet-state-error">No fue posible cargar la flota. Corrige el acceso a Firebase e inténtalo nuevamente.</div>
      <div v-else-if="buses.length === 0" class="fleet-state fleet-empty"><span class="empty-icon"><AppGlyph name="bus" /></span><strong>Aún no hay buses registrados</strong><span>Registra el primer bus de la flota para que aparezca en este listado.</span><button class="fleet-secondary-button" @click="openCreateForm">Registrar primer bus</button></div>
      <div v-else-if="filteredBuses.length === 0" class="fleet-state">No hay buses que coincidan con la búsqueda o el estado seleccionado.</div>
      <div v-else class="fleet-table-wrap">
        <table class="fleet-table">
          <thead><tr><th>BUS</th><th>MARCA Y MODELO</th><th>AÑO</th><th>ASIENTOS</th><th>ESTADO</th><th>ACTUALIZADO</th><th>ACCIONES</th></tr></thead>
          <tbody>
            <tr v-for="bus in filteredBuses" :key="bus.id">
              <td><strong class="bus-plate">{{ bus.plate }}</strong><span class="bus-code">Código {{ bus.internalCode }}</span></td>
              <td><strong class="bus-name">{{ bus.brand }} {{ bus.model }}</strong><span v-if="bus.observations" class="bus-code bus-observation" :title="bus.observations">{{ bus.observations }}</span></td>
              <td>{{ bus.year }}</td><td><span class="seat-count">{{ bus.capacity }} asientos</span></td>
              <td><span class="status-badge" :class="statusClass(bus.status)"><i></i>{{ bus.status }}</span></td>
              <td class="bus-date">{{ formatDate(bus.updatedAt) }}</td>
              <td><div class="bus-actions"><button class="action-edit" @click="openEditForm(bus)"><AppGlyph name="edit" />Editar</button><button class="action-state" @click="openEditForm(bus, true)"><AppGlyph name="sliders" />Estado</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!isLoading && !loadError && buses.length" class="fleet-table-footer"><span>{{ filteredBuses.length }} de {{ buses.length }} buses</span><span>Los registros se conservan para el historial de viajes.</span></div>
    </section>

    <div v-if="modalOpen" class="fleet-modal-backdrop" @click.self="closeForm">
      <section class="fleet-modal" role="dialog" aria-modal="true" :aria-labelledby="'bus-form-title'">
        <header class="fleet-modal-header"><div><span class="section-kicker">FLOTA RUTA AZUL</span><h2 id="bus-form-title">{{ editingBusId ? (statusOnly ? 'Cambiar estado del bus' : 'Editar bus') : 'Registrar bus' }}</h2></div><button class="modal-close" aria-label="Cerrar formulario" :disabled="isSaving" @click="closeForm">×</button></header>
        <p class="fleet-modal-copy">{{ statusOnly ? 'Actualiza el estado operativo del bus.' : 'Completa los datos del vehículo. La capacidad es fija para esta flota.' }}</p>
        <form class="bus-form" @submit.prevent="saveBus">
          <div class="form-grid">
            <label v-if="!statusOnly" class="field"><span>Código interno <b>*</b></span><input v-model="form.internalCode" maxlength="20" required placeholder="Ej. BUS-001" :disabled="isSaving" /><small v-if="formErrors.internalCode" class="field-error">{{ formErrors.internalCode }}</small></label>
            <label v-if="!statusOnly" class="field"><span>Placa <b>*</b></span><input v-model="form.plate" maxlength="12" required placeholder="Ej. ABC-123" :disabled="isSaving" /><small v-if="formErrors.plate" class="field-error">{{ formErrors.plate }}</small></label>
            <label v-if="!statusOnly" class="field"><span>Marca <b>*</b></span><input v-model="form.brand" maxlength="40" required placeholder="Ej. Volvo" :disabled="isSaving" /><small v-if="formErrors.brand" class="field-error">{{ formErrors.brand }}</small></label>
            <label v-if="!statusOnly" class="field"><span>Modelo <b>*</b></span><input v-model="form.model" maxlength="40" required placeholder="Ej. B11R" :disabled="isSaving" /><small v-if="formErrors.model" class="field-error">{{ formErrors.model }}</small></label>
            <label v-if="!statusOnly" class="field"><span>Año de fabricación <b>*</b></span><input v-model="form.year" type="number" min="1950" :max="currentYear" step="1" required placeholder="2022" :disabled="isSaving" /><small v-if="formErrors.year" class="field-error">{{ formErrors.year }}</small></label>
            <label v-if="!statusOnly" class="field"><span>Capacidad</span><div class="fixed-capacity"><AppGlyph name="seat" /><strong>39 asientos</strong><small>Capacidad fija</small></div></label>
            <label class="field" :class="{ 'field-full': !statusOnly }"><span>Estado <b>*</b></span><select v-model="form.status" required :disabled="isSaving"><option v-for="status in statuses" :key="status">{{ status }}</option></select></label>
            <label v-if="!statusOnly" class="field field-full"><span>Observaciones <small>(opcional)</small></span><textarea v-model="form.observations" rows="3" maxlength="500" placeholder="Notas sobre el bus, equipamiento o condición…" :disabled="isSaving"></textarea><small class="field-hint">{{ form.observations.length }}/500 caracteres</small><small v-if="formErrors.observations" class="field-error">{{ formErrors.observations }}</small></label>
          </div>
          <div v-if="operationError" class="form-operation-error" role="alert">{{ operationError }}</div>
          <footer class="form-actions"><button type="button" class="fleet-cancel-button" :disabled="isSaving" @click="closeForm">Cancelar</button><button type="submit" class="fleet-primary-button" :disabled="isSaving"><span v-if="isSaving" class="loading-spinner small"></span>{{ isSaving ? 'Guardando…' : (editingBusId ? 'Guardar cambios' : 'Registrar bus') }}</button></footer>
        </form>
      </section>
    </div>
  </div>
</template>
