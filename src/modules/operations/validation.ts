import { ALL_ROUTES, routeIsWithinTrip, type RoutePair } from './routes.ts'

export interface DriverForm {
  fullName: string
  dni: string
  licenseNumber: string
  phone: string
  status: 'Activo' | 'Inactivo'
}

export interface TripForm {
  busId: string
  driverId: string
  origin: string
  destination: string
  date: string
  time: string
}

export interface TicketForm {
  tripId: string
  origin: string
  destination: string
  passengerName: string
  passengerDni: string
  price: string | number
  seatNumber: number | null
}

export function normalizeCode(value: string): string {
  return value.trim().toLocaleUpperCase('es-PE').replace(/[\s-]+/g, '')
}

export function validateDriverForm(form: DriverForm) {
  const errors: Partial<Record<keyof DriverForm, string>> = {}
  if (form.fullName.trim().length < 3) errors.fullName = 'Ingresa el nombre completo del chofer.'
  if (!/^\d{8}$/.test(form.dni.trim())) errors.dni = 'El DNI debe tener 8 dígitos.'
  if (form.licenseNumber.trim().length < 4) errors.licenseNumber = 'Ingresa un número de licencia válido.'
  if (form.phone.trim() && !/^\+?[\d ()-]{7,16}$/.test(form.phone.trim())) errors.phone = 'Ingresa un teléfono válido.'
  return errors
}

export function validateTripForm(form: TripForm, now = Date.now()) {
  const errors: Partial<Record<keyof TripForm, string>> = {}
  if (!form.busId) errors.busId = 'Selecciona un bus operativo.'
  if (!form.driverId) errors.driverId = 'Selecciona un chofer activo.'
  if (!form.date || !form.time || new Date(`${form.date}T${form.time}`).getTime() <= now) errors.date = 'Selecciona una fecha y horario futuros.'
  const route = { origin: form.origin, destination: form.destination } as RoutePair
  if (!ALL_ROUTES.some((item) => item.origin === route.origin && item.destination === route.destination)) {
    errors.destination = 'Selecciona una ruta entre Pauza y uno de los destinos habilitados.'
  }
  return errors
}

export function validateTicketForm(form: TicketForm, trip: RoutePair | undefined) {
  const errors: Partial<Record<keyof TicketForm, string>> = {}
  if (!form.tripId || !trip) errors.tripId = 'Selecciona un viaje disponible.'
  const route = { origin: form.origin, destination: form.destination } as RoutePair
  if (trip && !routeIsWithinTrip(trip, route)) errors.destination = 'El tramo elegido no corresponde al viaje.'
  if (form.passengerName.trim().length < 3) errors.passengerName = 'Ingresa el nombre completo del pasajero.'
  if (!/^\d{8}$/.test(form.passengerDni.trim())) errors.passengerDni = 'El DNI debe tener 8 dígitos.'
  const price = Number(form.price)
  if (!Number.isFinite(price) || price <= 0 || Math.round(price * 100) !== price * 100) errors.price = 'Ingresa un precio válido mayor que cero.'
  if (!Number.isInteger(form.seatNumber) || !form.seatNumber || form.seatNumber < 1 || form.seatNumber > 39) errors.seatNumber = 'Selecciona un asiento disponible.'
  return errors
}
