export type BusStatus = 'Operativo' | 'En mantenimiento' | 'Inactivo'

export interface BusFormValues {
  internalCode: string
  plate: string
  brand: string
  model: string
  year: string | number
  capacity: number
  status: BusStatus
  observations: string
}

export type BusFormErrors = Partial<Record<keyof BusFormValues, string>>

export function normalizeFleetIdentifier(value: string): string {
  return value.trim().toLocaleUpperCase('es-PE').replace(/[\s-]+/g, '')
}

export function validateBusForm(values: BusFormValues, currentYear = new Date().getFullYear()): BusFormErrors {
  const errors: BusFormErrors = {}
  const year = Number(values.year)

  if (!values.internalCode.trim()) errors.internalCode = 'Ingresa el código interno del bus.'
  if (!values.plate.trim()) errors.plate = 'Ingresa la placa del bus.'
  if (!values.brand.trim()) errors.brand = 'Ingresa la marca del bus.'
  if (!values.model.trim()) errors.model = 'Ingresa el modelo del bus.'
  if (!Number.isInteger(year) || year < 1950 || year > currentYear) {
    errors.year = `Ingresa un año entre 1950 y ${currentYear}.`
  }
  if (values.capacity !== 39) errors.capacity = 'La capacidad del bus debe ser de 39 asientos.'
  if (!['Operativo', 'En mantenimiento', 'Inactivo'].includes(values.status)) {
    errors.status = 'Selecciona un estado válido.'
  }
  if (values.observations.length > 500) errors.observations = 'Las observaciones no deben superar los 500 caracteres.'

  return errors
}
