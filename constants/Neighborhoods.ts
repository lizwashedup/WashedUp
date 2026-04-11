// LA neighborhood picker options — alphabetical, used by both the profile
// edit screen and the post plan screen. When this list changes, every place
// that shows the picker picks up the change automatically.

export const NEIGHBORHOOD_OPTIONS = [
  'Atwater Village', 'Beverly Hills', 'Boyle Heights', 'Brentwood', 'Burbank',
  'Culver City', 'DTLA', 'Eagle Rock', 'East Hollywood', 'Echo Park',
  'El Segundo', 'Encino', 'Glendale', 'Glassell Park', 'Highland Park',
  'Hollywood', 'Huntington Park', 'Inglewood', 'Koreatown', 'La Brea',
  'Larchmont', 'Lincoln Heights', 'Long Beach', 'Los Feliz', 'Manhattan Beach',
  'Mar Vista', 'Marina Del Rey', 'Mid-City', 'Mid-Wilshire', 'North Hollywood', 'Palms',
  'Pasadena', 'Playa Vista', 'Redondo Beach', 'San Fernando Valley', 'Santa Monica',
  'Sherman Oaks', 'Silver Lake', 'South Pasadena', 'Studio City', 'Torrance',
  'Venice', 'West Adams', 'West Hollywood', 'Westchester', 'Westwood',
] as const;

export const NEIGHBORHOOD_OTHER = 'Other';
export const NEIGHBORHOOD_SET = new Set<string>(NEIGHBORHOOD_OPTIONS);
