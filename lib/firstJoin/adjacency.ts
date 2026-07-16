/**
 * LA neighborhood adjacency for the first-join ranker's "same or adjacent
 * neighborhood" bonus (spec a1). The repo had no adjacency data, so this map
 * is the source of truth; every name must exist in NEIGHBORHOOD_OPTIONS
 * (constants/Neighborhoods.ts), which both the profile picker and the plan
 * composer write from: a unit test enforces that.
 *
 * Edges are declared one-way here and symmetrized at module load, so a missing
 * reverse edge can never make the bonus directional. Adjacency is practical
 * ("would a new user go there for a first plan"), not strictly cadastral:
 * a small gap neighborhood between two listed ones does not break the edge.
 */

import { NEIGHBORHOOD_OTHER } from '../../constants/Neighborhoods';

const RAW_ADJACENCY: Record<string, string[]> = {
  'Atwater Village': ['Silver Lake', 'Los Feliz', 'Glassell Park', 'Glendale'],
  'Beverly Hills': ['West Hollywood', 'Westwood', 'Mid-Wilshire', 'La Brea'],
  'Boyle Heights': ['DTLA', 'Lincoln Heights', 'Huntington Park'],
  'Brentwood': ['Santa Monica', 'Westwood'],
  'Burbank': ['North Hollywood', 'Glendale', 'Studio City'],
  'Culver City': ['Palms', 'Mar Vista', 'West Adams', 'Playa Vista', 'Westchester', 'Mid-City'],
  'DTLA': ['Echo Park', 'Boyle Heights', 'Lincoln Heights', 'Koreatown', 'Huntington Park'],
  'Eagle Rock': ['Highland Park', 'Glassell Park', 'Glendale', 'Pasadena'],
  'East Hollywood': ['Hollywood', 'Los Feliz', 'Silver Lake', 'Koreatown', 'Larchmont'],
  // Koreatown edge approved in review: the Westlake gap does not break practical adjacency.
  'Echo Park': ['Silver Lake', 'DTLA', 'Lincoln Heights', 'Koreatown'],
  'El Segundo': ['Manhattan Beach', 'Westchester', 'Playa Vista'],
  'Encino': ['Sherman Oaks', 'San Fernando Valley'],
  'Glendale': ['Burbank', 'Atwater Village', 'Eagle Rock', 'Glassell Park', 'Pasadena'],
  'Glassell Park': ['Eagle Rock', 'Highland Park', 'Atwater Village', 'Glendale', 'Lincoln Heights'],
  'Highland Park': ['Eagle Rock', 'Glassell Park', 'South Pasadena', 'Lincoln Heights', 'Pasadena'],
  'Hollywood': ['West Hollywood', 'East Hollywood', 'Los Feliz', 'La Brea', 'Larchmont'],
  'Huntington Park': ['Boyle Heights', 'DTLA'],
  'Inglewood': ['Westchester', 'West Adams', 'Culver City'],
  'Koreatown': ['Mid-Wilshire', 'East Hollywood', 'DTLA', 'Larchmont', 'Mid-City'],
  'La Brea': ['Hollywood', 'West Hollywood', 'Mid-Wilshire', 'Mid-City', 'Larchmont'],
  'Larchmont': ['Hollywood', 'East Hollywood', 'Koreatown', 'Mid-Wilshire', 'La Brea'],
  'Lincoln Heights': ['Boyle Heights', 'DTLA', 'Highland Park', 'Glassell Park', 'Echo Park'],
  'Long Beach': ['Torrance'],
  'Los Feliz': ['Silver Lake', 'Atwater Village', 'East Hollywood', 'Hollywood'],
  'Manhattan Beach': ['El Segundo', 'Redondo Beach'],
  'Mar Vista': ['Palms', 'Culver City', 'Venice', 'Santa Monica', 'Playa Vista'],
  'Marina Del Rey': ['Venice', 'Playa Vista', 'Westchester', 'Mar Vista'],
  'Mid-City': ['Mid-Wilshire', 'La Brea', 'West Adams', 'Koreatown'],
  'Mid-Wilshire': ['Koreatown', 'La Brea', 'Larchmont', 'Mid-City', 'Beverly Hills'],
  'North Hollywood': ['Burbank', 'Studio City', 'Sherman Oaks', 'San Fernando Valley'],
  'Palms': ['Culver City', 'Mar Vista', 'Westwood'],
  'Pasadena': ['South Pasadena', 'Eagle Rock', 'Glendale'],
  'Playa Vista': ['Westchester', 'Marina Del Rey', 'Culver City', 'Mar Vista', 'El Segundo'],
  'Redondo Beach': ['Manhattan Beach', 'Torrance'],
  'San Fernando Valley': ['Encino', 'Sherman Oaks', 'Studio City', 'North Hollywood', 'Burbank'],
  'Santa Monica': ['Venice', 'Brentwood', 'Mar Vista'],
  'Sherman Oaks': ['Studio City', 'Encino', 'North Hollywood', 'San Fernando Valley'],
  'Silver Lake': ['Echo Park', 'Los Feliz', 'Atwater Village', 'East Hollywood'],
  'South Pasadena': ['Pasadena', 'Highland Park'],
  // Hollywood edge approved in review: the Cahuenga pass connects the two in practice.
  'Studio City': ['Sherman Oaks', 'North Hollywood', 'Burbank', 'San Fernando Valley', 'Hollywood'],
  'Torrance': ['Redondo Beach', 'Long Beach'],
  'Venice': ['Santa Monica', 'Mar Vista', 'Marina Del Rey'],
  'West Adams': ['Mid-City', 'Culver City', 'Inglewood'],
  'West Hollywood': ['Hollywood', 'Beverly Hills', 'La Brea'],
  'Westchester': ['Playa Vista', 'Inglewood', 'El Segundo', 'Culver City', 'Marina Del Rey'],
  'Westwood': ['Beverly Hills', 'Brentwood', 'Palms'],
};

function buildSymmetric(raw: Record<string, string[]>): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  const add = (a: string, b: string) => {
    (map[a] ??= new Set()).add(b);
  };
  for (const [name, neighbors] of Object.entries(raw)) {
    for (const other of neighbors) {
      add(name, other);
      add(other, name);
    }
  }
  return map;
}

export const NEIGHBORHOOD_ADJACENCY: Record<string, Set<string>> = buildSymmetric(RAW_ADJACENCY);

/**
 * Same or adjacent neighborhood, per spec a1. Null on either side never
 * matches, and "Other" never matches "Other": two plans "somewhere else"
 * share no geography (no bonus, and no tier-1 geo match).
 */
export function isSameOrAdjacentNeighborhood(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === NEIGHBORHOOD_OTHER || b === NEIGHBORHOOD_OTHER) return false;
  if (a === b) return true;
  return NEIGHBORHOOD_ADJACENCY[a]?.has(b) ?? false;
}
