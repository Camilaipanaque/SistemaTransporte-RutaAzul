export const ROUTE_STOPS = ['Pauza', 'Nasca', 'Ica', 'Lima'] as const
export type RouteStop = (typeof ROUTE_STOPS)[number]
export interface RoutePair { origin: RouteStop; destination: RouteStop }

export const ALL_ROUTES: RoutePair[] = ROUTE_STOPS.slice(1).flatMap((destination) => [
  { origin: 'Pauza' as const, destination },
  { origin: destination, destination: 'Pauza' as const },
])

export function getSegmentKeys(origin: RouteStop, destination: RouteStop): string[] {
  const from = ROUTE_STOPS.indexOf(origin)
  const to = ROUTE_STOPS.indexOf(destination)
  if (from === to) return []
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  return Array.from({ length: high - low }, (_, offset) => `${ROUTE_STOPS[low + offset]}__${ROUTE_STOPS[low + offset + 1]}`)
}

export function seatIsAvailable(locks: Record<string, Record<string, string>> | undefined, seatNumber: number, segments: string[]): boolean {
  const seatKey = String(seatNumber)
  return segments.every((segment) => !locks?.[segment]?.[seatKey])
}

export function routeIsWithinTrip(trip: RoutePair, leg: RoutePair): boolean {
  if (leg.origin === leg.destination || (leg.origin !== 'Pauza' && leg.destination !== 'Pauza')) return false
  const tripStart = ROUTE_STOPS.indexOf(trip.origin)
  const tripEnd = ROUTE_STOPS.indexOf(trip.destination)
  const legStart = ROUTE_STOPS.indexOf(leg.origin)
  const legEnd = ROUTE_STOPS.indexOf(leg.destination)
  const direction = Math.sign(tripEnd - tripStart)
  return direction !== 0 && direction === Math.sign(legEnd - legStart)
    && (legStart - tripStart) * direction >= 0
    && (tripEnd - legEnd) * direction >= 0
}

export function ticketRoutesForTrip(trip: RoutePair): RoutePair[] {
  return ALL_ROUTES.filter((route) => routeIsWithinTrip(trip, route))
}
