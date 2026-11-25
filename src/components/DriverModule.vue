<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onValue, push, ref as databaseRef, runTransaction, type DataSnapshot } from 'firebase/database'
import { auth, db } from '../firebase'
import AppGlyph from './AppGlyph.vue'
import { normalizeCode, validateDriverForm, type DriverForm } from '../modules/operations/validation'

const ADMIN_UID = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
interface DriverRecord extends DriverForm { id: string; createdAt: number; updatedAt: number }
type StoredDriver = Omit<DriverRecord, 'id'>

const drivers = ref<DriverRecord[]>([])
const loading = ref(true)
const loadError = ref('')
const operationError = ref('')
const successMessage = ref('')
const search = ref('')
const filter = ref<'Todos' | 'Activo' | 'Inactivo'>('Todos')
const modalOpen = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const errors = ref<Partial<Record<keyof DriverForm, string>>>({})
const form = ref<DriverForm>(emptyForm())
let stop: (() => void) | undefined

function emptyForm(): DriverForm { return { fullName: '', dni: '', licenseNumber: '', phone: '', status: 'Activo' } }

const visibleDrivers = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('es-PE')
  return drivers.value.filter((driver) => (filter.value === 'Todos' || driver.status === filter.value)
    && (!query || [driver.fullName, driver.dni, driver.licenseNumber].some((value) => value.toLocaleLowerCase('es-PE').includes(query))))
})

function describeError(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === 'PERMISSION_DENIED' || code === 'database/permission-denied') return 'Firebase rechazó la operación. Revisa los permisos del nodo drivers.'
  if (code === 'NETWORK_ERROR') return 'No se pudo conectar con Firebase. Revisa la conexión e inténtalo nuevamente.'
  return 'No se pudo completar la operación con Firebase.'
}

function loadDrivers() {
  if (auth.currentUser?.uid !== ADMIN_UID) { loading.value = false; loadError.value = 'La sesión administrativa expiró. Inicia sesión nuevamente.'; return }
  loading.value = true
  loadError.value = ''
  stop?.()
  stop = onValue(databaseRef(db, 'drivers'), (snapshot: DataSnapshot) => {
    const records = snapshot.val() as Record<string, StoredDriver> | null
    drivers.value = records ? Object.entries(records).map(([id, record]) => ({ id, ...record })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) : []
    loading.value = false
    loadError.value = ''
  }, (error) => { loading.value = false; loadError.value = describeError(error) })
}

onMounted(loadDrivers)
onUnmounted(() => stop?.())

function openForm(record?: DriverRecord) {
  editingId.value = record?.id ?? null
  form.value = record ? { fullName: record.fullName, dni: record.dni, licenseNumber: record.licenseNumber, phone: record.phone || '', status: record.status } : emptyForm()
  errors.value = {}
  operationError.value = ''
  successMessage.value = ''
  modalOpen.value = true
}

async function saveDriver() {
  errors.value = validateDriverForm(form.value)
  operationError.value = ''
  successMessage.value = ''
  if (Object.keys(errors.value).length) return
  if (auth.currentUser?.uid !== ADMIN_UID) { operationError.value = 'Tu sesión no tiene autorización. Vuelve a iniciar sesión.'; return }

  saving.value = true
  let duplicate: 'dni' | 'licenseNumber' | null = null
  try {
    const driversRef = databaseRef(db, 'drivers')
    const id = editingId.value || push(driversRef).key
    if (!id) throw new Error('No se pudo generar un identificador.')
    const result = await runTransaction(driversRef, (currentValue) => {
      duplicate = null
      const records = (currentValue && typeof currentValue === 'object' ? currentValue : {}) as Record<string, StoredDriver>
      for (const [otherId, record] of Object.entries(records)) {
        if (otherId === id) continue
        if (normalizeCode(record.dni) === normalizeCode(form.value.dni)) { duplicate = 'dni'; return }
        if (normalizeCode(record.licenseNumber) === normalizeCode(form.value.licenseNumber)) { duplicate = 'licenseNumber'; return }
      }
      const previous = records[id]
      if (editingId.value && !previous) return
      const now = Date.now()
      return { ...records, [id]: { fullName: form.value.fullName.trim(), dni: form.value.dni.trim(), licenseNumber: form.value.licenseNumber.trim().toLocaleUpperCase('es-PE'), phone: form.value.phone.trim(), status: form.value.status, createdAt: previous?.createdAt ?? now, updatedAt: now } }
    }, { applyLocally: false })
    if (!result.committed) {
      if (duplicate === 'dni') errors.value.dni = 'Ya existe un chofer con este DNI.'
      else if (duplicate === 'licenseNumber') errors.value.licenseNumber = 'Esta licencia ya está registrada.'
      else operationError.value = 'Firebase no confirmó el cambio. Actualiza el listado e inténtalo nuevamente.'
      return
    }
    successMessage.value = editingId.value ? 'La información del chofer se actualizó correctamente.' : 'El chofer se registró correctamente.'
    modalOpen.value = false
  } catch (error) { operationError.value = describeError(error) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="fleet-content">
    <section class="fleet-heading"><div><span class="section-kicker">ADMINISTRACIÓN DE PERSONAL</span><h1>Gestión de choferes</h1><p>Registra y actualiza la información del personal de conducción.</p></div><button class="fleet-primary-button" @click="openForm()"><AppGlyph name="plus" /> Registrar chofer</button></section>
    <div v-if="successMessage" class="fleet-alert alert-success" role="status"><AppGlyph name="check" />{{ successMessage }}<button aria-label="Cerrar mensaje" @click="successMessage = ''">×</button></div>
    <div v-if="loadError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ loadError }}<button @click="loadDrivers">Reintentar</button></div>
    <div v-if="operationError" class="fleet-alert alert-error" role="alert"><AppGlyph name="info" />{{ operationError }}<button aria-label="Cerrar mensaje" @click="operationError = ''">×</button></div>
    <section class="driver-summary"><div class="driver-summary-icon"><AppGlyph name="users" /></div><div><span>Choferes registrados</span><strong>{{ drivers.length }}</strong></div><div class="driver-summary-divider"></div><div><span>Activos</span><strong>{{ drivers.filter((driver) => driver.status === 'Activo').length }}</strong></div></section>
    <section class="fleet-list panel">
      <div class="fleet-list-heading"><div><span class="section-kicker">PERSONAL DE CONDUCCIÓN</span><h2>Choferes</h2></div><div class="fleet-filters"><label class="fleet-search"><AppGlyph name="search" /><input v-model="search" type="search" placeholder="Buscar por nombre, DNI o licencia…" aria-label="Buscar chofer" /></label><select v-model="filter" aria-label="Filtrar choferes"><option>Todos</option><option>Activo</option><option>Inactivo</option></select></div></div>
      <div v-if="loading" class="fleet-state"><span class="loading-spinner"></span><span>Cargando choferes desde Firebase…</span></div>
      <div v-else-if="loadError" class="fleet-state fleet-state-error">No fue posible cargar los choferes.</div>
      <div v-else-if="!drivers.length" class="fleet-state fleet-empty"><span class="empty-icon"><AppGlyph name="users" /></span><strong>Aún no hay choferes registrados</strong><span>Registra el primer chofer para vincularlo con los viajes.</span><button class="fleet-secondary-button" @click="openForm()">Registrar primer chofer</button></div>
      <div v-else-if="!visibleDrivers.length" class="fleet-state">No hay choferes que coincidan con los filtros.</div>
      <div v-else class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>CHOFER</th><th>DNI</th><th>LICENCIA</th><th>TELÉFONO</th><th>ESTADO</th><th>ACTUALIZADO</th><th>ACCIÓN</th></tr></thead><tbody>
        <tr v-for="driver in visibleDrivers" :key="driver.id"><td><strong class="bus-name">{{ driver.fullName }}</strong></td><td>{{ driver.dni }}</td><td>{{ driver.licenseNumber }}</td><td>{{ driver.phone || '—' }}</td><td><span class="status-badge" :class="driver.status === 'Activo' ? 'status-operational' : 'status-inactive'"><i></i>{{ driver.status }}</span></td><td class="bus-date">{{ new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(driver.updatedAt)) }}</td><td><button class="action-edit" @click="openForm(driver)"><AppGlyph name="edit" />Editar</button></td></tr>
      </tbody></table></div>
    </section>
    <div v-if="modalOpen" class="fleet-modal-backdrop" @click.self="!saving && (modalOpen = false)"><section class="fleet-modal" role="dialog" aria-modal="true" aria-labelledby="driver-form-title"><header class="fleet-modal-header"><div><span class="section-kicker">RUTA AZUL</span><h2 id="driver-form-title">{{ editingId ? 'Editar chofer' : 'Registrar chofer' }}</h2></div><button class="modal-close" aria-label="Cerrar formulario" :disabled="saving" @click="modalOpen = false">×</button></header><p class="fleet-modal-copy">Ingresa los datos del conductor. DNI y licencia deben ser únicos.</p>
      <form class="bus-form" @submit.prevent="saveDriver"><div class="form-grid">
        <label class="field field-full"><span>Nombre completo <b>*</b></span><input v-model="form.fullName" maxlength="100" required placeholder="Nombres y apellidos" :disabled="saving" /><small v-if="errors.fullName" class="field-error">{{ errors.fullName }}</small></label>
        <label class="field"><span>DNI <b>*</b></span><input v-model="form.dni" inputmode="numeric" maxlength="8" minlength="8" required placeholder="8 dígitos" :disabled="saving" /><small v-if="errors.dni" class="field-error">{{ errors.dni }}</small></label>
        <label class="field"><span>Número de licencia <b>*</b></span><input v-model="form.licenseNumber" maxlength="20" required placeholder="Número de brevete" :disabled="saving" /><small v-if="errors.licenseNumber" class="field-error">{{ errors.licenseNumber }}</small></label>
        <label class="field"><span>Teléfono <small>(opcional)</small></span><input v-model="form.phone" type="tel" maxlength="16" placeholder="999 999 999" :disabled="saving" /><small v-if="errors.phone" class="field-error">{{ errors.phone }}</small></label>
        <label class="field"><span>Estado <b>*</b></span><select v-model="form.status" :disabled="saving"><option>Activo</option><option>Inactivo</option></select></label>
      </div><div v-if="operationError" class="form-operation-error" role="alert">{{ operationError }}</div><footer class="form-actions"><button type="button" class="fleet-cancel-button" :disabled="saving" @click="modalOpen = false">Cancelar</button><button type="submit" class="fleet-primary-button" :disabled="saving"><span v-if="saving" class="loading-spinner small"></span>{{ saving ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Registrar chofer') }}</button></footer></form>
    </section></div>
  </div>
</template>
