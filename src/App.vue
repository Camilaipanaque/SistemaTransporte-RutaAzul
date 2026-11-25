<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { onValue, ref as databaseRef } from 'firebase/database'
import { auth, db } from './firebase'
import AppGlyph from './components/AppGlyph.vue'
import StatCard from './components/StatCard.vue'

const FleetModule = defineAsyncComponent(() => import('./components/FleetModule.vue'))
const DriverModule = defineAsyncComponent(() => import('./components/DriverModule.vue'))
const TripModule = defineAsyncComponent(() => import('./components/TripModule.vue'))
const TicketSaleModule = defineAsyncComponent(() => import('./components/TicketSaleModule.vue'))
const TicketsModule = defineAsyncComponent(() => import('./components/TicketsModule.vue'))

type NavItem = { label: string; icon: string }
type Stat = { label: string; value: string; detail: string; icon: string; tone: string }

const activeSection = ref('Inicio')
const authorizedAdminUid = 'QpErTEq41pZeSvl01QLbiJY7M6n2'
const currentUser = ref<User | null>(null)
const authReady = ref(false)
const loginEmail = ref('')
const loginPassword = ref('')
const showPassword = ref(false)
const authError = ref('')
const authLoading = ref(false)
const isAdmin = computed(() => currentUser.value?.uid === authorizedAdminUid)
const navItems: NavItem[] = [
  { label: 'Inicio', icon: 'home' },
  { label: 'Venta de pasajes', icon: 'ticket' },
  { label: 'Gestión de viajes', icon: 'route' },
  { label: 'Flota de transporte', icon: 'bus' },
  { label: 'Gestión de choferes', icon: 'users' },
  { label: 'Boletos emitidos', icon: 'receipt' },
  { label: 'Reportes', icon: 'chart' },
]
const dashboardData = ref<Record<string, Record<string, any>>>({ buses: {}, drivers: {}, trips: {} })
const dashboardStates = ref<Record<string, 'loading' | 'ready' | 'error'>>({ buses: 'loading', drivers: 'loading', trips: 'loading' })
const dashboardError = ref('')
let dashboardStops: Array<() => void> = []
const stats = computed<Stat[]>(() => {
  const count = (path: string, filter?: (entry: Record<string, any>) => boolean) => {
    if (dashboardStates.value[path] !== 'ready') return '—'
    const records = Object.values(dashboardData.value[path] || {}) as Record<string, any>[]
    return String(filter ? records.filter(filter).length : records.length)
  }
  const moneyToday = () => {
    if (dashboardStates.value.trips !== 'ready') return '—'
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    let total = 0
    for (const trip of Object.values(dashboardData.value.trips || {}) as Record<string, any>[]) {
      for (const ticket of Object.values((trip.tickets || {}) as Record<string, any>)) {
        if (Number(ticket.createdAt) >= start.getTime() && Number(ticket.createdAt) < end.getTime()) total += Number(ticket.price) || 0
      }
    }
    return `S/ ${total.toFixed(2)}`
  }
  const detail = (path: string) => dashboardStates.value[path] === 'ready' ? 'Datos de Firebase' : dashboardStates.value[path] === 'error' ? 'Sin acceso a Firebase' : 'Cargando…'
  return [
    { label: 'Ventas de hoy', value: moneyToday(), detail: detail('trips'), icon: 'ticket', tone: 'blue' },
    { label: 'Buses registrados', value: count('buses'), detail: detail('buses'), icon: 'bus', tone: 'cyan' },
    { label: 'Choferes registrados', value: count('drivers'), detail: detail('drivers'), icon: 'users', tone: 'violet' },
    { label: 'Viajes programados', value: count('trips', (trip) => trip.status === 'Programado' && Number(trip.departureAt) >= Date.now()), detail: detail('trips'), icon: 'route', tone: 'amber' },
  ]
})
const destinations = ['Pauza', 'Nasca', 'Ica', 'Lima']
const greeting = computed(() => activeSection.value === 'Inicio' ? 'Resumen general' : activeSection.value)

function stopDashboardReads() {
  dashboardStops.forEach((stop) => stop())
  dashboardStops = []
}

function startDashboardReads() {
  stopDashboardReads()
  if (!authReady.value || !isAdmin.value || activeSection.value !== 'Inicio' || auth.currentUser?.uid !== authorizedAdminUid) return
  const paths = ['buses', 'drivers', 'trips']
  dashboardStates.value = Object.fromEntries(paths.map((path) => [path, 'loading'])) as Record<string, 'loading' | 'ready' | 'error'>
  dashboardError.value = ''
  dashboardStops = paths.map((path) => onValue(databaseRef(db, path), (snapshot) => {
    dashboardData.value[path] = snapshot.val() || {}
    dashboardStates.value[path] = 'ready'
  }, () => {
    dashboardStates.value[path] = 'error'
    dashboardError.value = 'No se pudieron leer algunos indicadores desde Firebase.'
  }))
}

watch([isAdmin, activeSection, authReady], startDashboardReads)
onUnmounted(stopDashboardReads)

function selectSection(label: string) {
  activeSection.value = label
}

function messageForAuthError(error: unknown) {
  const code = (error as { code?: string })?.code
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/invalid-email': 'Ingresa un correo electrónico válido.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta al administrador.',
    'auth/too-many-requests': 'Hubo demasiados intentos. Espera un momento e inténtalo nuevamente.',
    'auth/network-request-failed': 'No se pudo conectar. Revisa tu conexión a internet.',
  }
  return (code && messages[code]) || 'No se pudo iniciar sesión. Verifica tus datos e inténtalo nuevamente.'
}

async function login() {
  authError.value = ''
  authLoading.value = true
  try {
    const credential = await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value)
    if (credential.user.uid !== authorizedAdminUid) {
      await signOut(auth)
      authError.value = 'Esta cuenta no tiene autorización para acceder al panel administrativo.'
      return
    }
    currentUser.value = credential.user
    loginPassword.value = ''
  } catch (error) {
    authError.value = messageForAuthError(error)
  } finally {
    authLoading.value = false
  }
}

async function logout() {
  authError.value = ''
  await signOut(auth)
}

onMounted(() => {
  onAuthStateChanged(auth, (user) => {
    if (user && user.uid !== authorizedAdminUid) {
      currentUser.value = null
      authReady.value = true
      authError.value = 'Esta cuenta no tiene autorización para acceder al panel administrativo.'
      void signOut(auth).catch(() => undefined)
      return
    }
    currentUser.value = user
    authReady.value = true
  })
})
</script>

<template>
  <div v-if="!authReady" class="auth-loading-screen" role="status" aria-live="polite">
    <span class="loading-spinner"></span><span>Verificando sesión segura…</span>
  </div>

  <main v-else-if="!isAdmin" class="login-page">
    <header class="login-header">
      <a class="brand" href="#inicio" aria-label="Ruta Azul, inicio">
        <span class="brand-mark"><AppGlyph name="bus" /></span>
        <span class="brand-copy"><strong>RUTA AZUL</strong><small>Transporte interprovincial</small></span>
      </a>
      <span class="login-header-note"><span></span> Acceso administrativo seguro</span>
    </header>
    <div class="login-layout">
      <section class="login-promo">
        <span class="eyebrow"><span class="eyebrow-line"></span> VIAJA CON CONFIANZA</span>
        <h1>Sistema de Venta<br />de Pasajes</h1>
        <p>Conectamos destinos y personas. Ingresa al panel para administrar la operación de Ruta Azul.</p>
        <div class="destination-list" aria-label="Destinos disponibles">
          <span v-for="place in destinations" :key="place" class="destination-chip"><AppGlyph name="pin" />{{ place }}</span>
        </div>
        <div class="login-bus-scene" role="img" aria-label="Ilustración de bus interprovincial">
          <div class="login-sun"></div><div class="login-mountain"></div>
          <svg viewBox="0 0 520 270" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <ellipse cx="274" cy="231" rx="222" ry="22" fill="#071e34" opacity=".3" />
            <path d="M63 66Q72 43 101 40h315q35 0 48 35l20 116q4 21-20 25H63q-20 0-20-21V89q0-17 20-23Z" fill="#f5fbfd" stroke="#c5deea" stroke-width="3" />
            <path d="M75 69q4-13 24-14h305q21 0 28 20l7 24H69Z" fill="#12385b" />
            <path d="M87 66h83v25H79Zm94 0h81v25h-81Zm91 0h83v25h-83Zm94 0h29q12 0 17 12l3 13h-49Z" fill="#58a8cd" />
            <path d="M49 111h416l15 67q4 18-19 18H59q-15 0-15-17v-50q0-13 5-18Z" fill="#fff" />
            <path d="M48 142h422l7 31H45Z" fill="#29a4d6" /><path d="M45 174h432l3 11q2 11-16 14H59q-16 0-16-17Z" fill="#12385b" />
            <path d="M78 113h80v21H78Zm91 0h80v21h-80Zm91 0h80v21h-80Zm91 0h81v21h-81Z" fill="#d8eaf3" />
            <circle cx="139" cy="198" r="30" fill="#182d40" /><circle cx="139" cy="198" r="15" fill="#afc4d0" /><circle cx="139" cy="198" r="7" fill="#f7fbfd" />
            <circle cx="402" cy="198" r="30" fill="#182d40" /><circle cx="402" cy="198" r="15" fill="#afc4d0" /><circle cx="402" cy="198" r="7" fill="#f7fbfd" />
            <path d="M286 151h92" stroke="#fff" stroke-width="4" stroke-linecap="round" /><text x="294" y="168" fill="#fff" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="2">RUTA AZUL</text>
          </svg>
          <span class="login-scene-caption">Rutas que nos unen</span>
        </div>
      </section>

      <section class="login-card" aria-labelledby="login-title">
        <div class="login-card-icon"><AppGlyph name="user" /></div>
        <span class="section-kicker">BIENVENIDO DE NUEVO</span>
        <h2 id="login-title">Iniciar sesión</h2>
        <p class="login-intro">Ingresa tus credenciales administrativas para continuar.</p>
        <form class="auth-form" @submit.prevent="login">
          <label for="login-email">Correo electrónico</label>
          <div class="input-wrap"><AppGlyph name="mail" /><input id="login-email" v-model="loginEmail" type="email" autocomplete="username" placeholder="admin@rutaazul.pe" required :disabled="authLoading" /></div>
          <label for="login-password">Contraseña</label>
          <div class="input-wrap"><AppGlyph name="lock" /><input id="login-password" v-model="loginPassword" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Ingresa tu contraseña" required :disabled="authLoading" /><button class="password-toggle" type="button" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="showPassword = !showPassword"><AppGlyph :name="showPassword ? 'eye-off' : 'eye'" /></button></div>
          <p v-if="authError" class="auth-error" role="alert"><AppGlyph name="info" />{{ authError }}</p>
          <button class="auth-submit" type="submit" :disabled="authLoading">
            <span v-if="authLoading" class="loading-spinner small"></span><span>{{ authLoading ? 'Verificando acceso…' : 'Ingresar al panel' }}</span><AppGlyph v-if="!authLoading" name="arrow" />
          </button>
        </form>
        <div class="secure-note"><AppGlyph name="lock" /><span>Acceso exclusivo para personal autorizado</span></div>
        <div class="login-footnote">© 2025 Ruta Azul · Sistema de Venta de Pasajes</div>
      </section>
    </div>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#inicio" aria-label="Sistema de Venta de Pasajes, inicio" @click="selectSection('Inicio')">
        <span class="brand-mark"><AppGlyph name="bus" /></span>
        <span class="brand-copy"><strong>RUTA AZUL</strong><small>Transporte interprovincial</small></span>
      </a>

      <div class="nav-caption">MENÚ PRINCIPAL</div>
      <nav class="side-nav" aria-label="Menú principal">
        <button v-for="item in navItems" :key="item.label" class="nav-item" :class="{ selected: activeSection === item.label }" @click="selectSection(item.label)">
          <AppGlyph :name="item.icon" /><span>{{ item.label }}</span>
          <span v-if="item.label === 'Venta de pasajes'" class="nav-count">+</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <div class="help-card">
          <div class="help-icon"><AppGlyph name="spark" /></div>
          <strong>¿Necesitas ayuda?</strong>
          <p>Estamos aquí para ayudarte a organizar tus viajes.</p>
          <span class="help-link">Soporte administrativo</span>
        </div>
        <button class="nav-item logout" @click="logout"><AppGlyph name="logout" /><span>Cerrar sesión</span></button>
        <div class="profile-row">
          <div class="avatar">{{ currentUser?.email?.slice(0, 2).toUpperCase() || 'AD' }}</div>
          <div class="profile-name"><strong>{{ currentUser?.email }}</strong><small>Administrador autorizado</small></div>
          <AppGlyph name="more" />
        </div>
      </div>
    </aside>

    <main class="main-area" id="inicio">
      <header class="topbar">
        <div class="breadcrumb"><span>Panel administrativo</span><span class="crumb-slash">/</span><strong>{{ greeting }}</strong></div>
        <div class="top-actions">
          <span class="demo-pill"><span></span> Sesión administrativa</span>
          <button class="login-button" @click="logout"><AppGlyph name="logout" /> Cerrar sesión</button>
        </div>
      </header>

      <FleetModule v-if="activeSection === 'Flota de transporte'" />
      <DriverModule v-else-if="activeSection === 'Gestión de choferes'" />
      <TripModule v-else-if="activeSection === 'Gestión de viajes'" />
      <TicketSaleModule v-else-if="activeSection === 'Venta de pasajes'" />
      <TicketsModule v-else-if="activeSection === 'Boletos emitidos'" />

      <div v-else class="content-wrap">
        <section class="welcome-banner">
          <div class="welcome-copy">
            <span class="eyebrow"><span class="eyebrow-line"></span> VIAJA CON CONFIANZA</span>
            <h1>Sistema de Venta<br />de Pasajes</h1>
            <p>Conectamos destinos y personas. Administra tus viajes con una experiencia simple, segura y cercana.</p>
            <div class="destination-list" aria-label="Destinos disponibles">
              <span v-for="place in destinations" :key="place" class="destination-chip"><AppGlyph name="pin" />{{ place }}</span>
            </div>
          </div>
          <div class="bus-art" role="img" aria-label="Ilustración referencial de un bus interprovincial recorriendo la sierra peruana">
            <div class="sun"></div><div class="cloud cloud-one"></div><div class="cloud cloud-two"></div>
            <div class="mountain mountain-back"></div><div class="mountain mountain-front"></div>
            <div class="road"></div>
            <svg class="coach" viewBox="0 0 520 270" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs><linearGradient id="coachBody" x1="0" x2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#dceef8"/></linearGradient><linearGradient id="windshield" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#91cde7"/><stop offset="1" stop-color="#265d86"/></linearGradient></defs>
              <ellipse cx="274" cy="231" rx="222" ry="22" fill="#102b49" opacity=".18"/>
              <path d="M63 66Q72 43 101 40h315q35 0 48 35l20 116q4 21-20 25H63q-20 0-20-21V89q0-17 20-23Z" fill="url(#coachBody)" stroke="#c5deea" stroke-width="3"/>
              <path d="M75 69q4-13 24-14h305q21 0 28 20l7 24H69Z" fill="#12385b"/>
              <path d="M87 66h83v25H79Zm94 0h81v25h-81Zm91 0h83v25h-83Zm94 0h29q12 0 17 12l3 13h-49Z" fill="url(#windshield)"/>
              <path d="M49 111h416l15 67q4 18-19 18H59q-15 0-15-17v-50q0-13 5-18Z" fill="#fff"/>
              <path d="M48 142h422l7 31H45Z" fill="#29a4d6"/><path d="M45 174h432l3 11q2 11-16 14H59q-16 0-16-17Z" fill="#12385b"/>
              <path d="M78 113h80v21H78Zm91 0h80v21h-80Zm91 0h80v21h-80Zm91 0h81v21h-81Z" fill="#d8eaf3"/>
              <path d="M410 60q20 1 27 19l5 15h-31Z" fill="url(#windshield)"/><rect x="463" y="119" width="9" height="17" rx="4" fill="#f4c45e"/><rect x="46" y="119" width="8" height="17" rx="4" fill="#ef806f"/>
              <circle cx="139" cy="198" r="30" fill="#182d40"/><circle cx="139" cy="198" r="15" fill="#afc4d0"/><circle cx="139" cy="198" r="7" fill="#f7fbfd"/>
              <circle cx="402" cy="198" r="30" fill="#182d40"/><circle cx="402" cy="198" r="15" fill="#afc4d0"/><circle cx="402" cy="198" r="7" fill="#f7fbfd"/>
              <path d="M286 151h92" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/><text x="294" y="168" fill="#fff" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="2">RUTA AZUL</text>
            </svg>
            <div class="image-tag"><span class="tag-pin"><AppGlyph name="pin" /></span><span><small>RUTAS QUE NOS UNEN</small><strong>Tu próximo destino te espera</strong></span></div>
          </div>
          <div class="banner-orb orb-one"></div><div class="banner-orb orb-two"></div>
        </section>

        <section class="metrics-section" aria-labelledby="metrics-title">
          <div class="section-heading"><div><span class="section-kicker">INDICADORES EN TIEMPO REAL</span><h2 id="metrics-title">{{ greeting }}</h2></div><span class="updated-label"><AppGlyph name="database" /> Datos guardados en Firebase</span></div>
          <p v-if="dashboardError" class="database-message database-error" role="status">{{ dashboardError }}</p>
          <div class="stats-grid">
            <StatCard v-for="stat in stats" :key="stat.label" :label="stat.label" :value="stat.value" :detail="stat.detail" :icon="stat.icon" :tone="stat.tone" />
          </div>
        </section>

        <section class="bottom-grid">
          <article class="panel routes-panel">
            <div class="panel-heading"><div><span class="section-kicker">CONECTAMOS CONTIGO</span><h2>Destinos populares</h2></div><button class="text-action" @click="selectSection('Gestión de viajes')">Ver rutas <span>→</span></button></div>
            <div class="route-grid">
              <button v-for="(place, index) in destinations" :key="place" class="route-card" @click="selectSection('Venta de pasajes')">
                <span class="route-number">0{{ index + 1 }}</span><span class="route-place"><AppGlyph name="pin" /><strong>{{ place }}</strong></span><span class="route-arrow">↗</span>
              </button>
            </div>
            <div class="route-footnote"><span class="route-dot"></span> Pauza, Nasca, Ica y Lima</div>
          </article>
          <article class="panel next-panel">
            <div class="next-icon"><AppGlyph name="compass" /></div>
            <span class="section-kicker">LISTOS PARA PARTIR</span>
            <h2>Tu operación,<br />en un solo lugar.</h2>
            <p>Consulta viajes, organiza tu flota y brinda un mejor servicio a cada pasajero.</p>
            <button class="next-link" @click="selectSection('Gestión de viajes')">Explorar panel <span>→</span></button>
            <div class="next-decoration">RUTA<br />AZUL</div>
          </article>
        </section>

        <footer class="page-footer"><span>© 2025 Ruta Azul · Sistema de Venta de Pasajes</span><span>Sesión protegida · Administrador autorizado</span></footer>
      </div>
    </main>
  </div>
</template>
