/**
 * zip -> LA area names, the client mirror of the zip_areas table
 * (migration 20260707200000, definer-only on the server, so the members
 * tab cannot query it). Display-only: used to show a leader the AREA of a
 * pending requester instead of the raw zip (Liz's call, doc 13). The
 * server table is the source of truth; if it ever gains rows, regenerate
 * this file from the migration seed. Unknown zip -> null, the intro-card
 * treatment (the line simply does not render).
 */

const ZIP_AREAS: Record<string, string> = {
  '90001': 'south la', '90002': 'watts', '90003': 'south la', '90004': 'hancock park',
  '90005': 'koreatown', '90006': 'koreatown', '90007': 'university park', '90008': 'baldwin hills',
  '90010': 'koreatown', '90011': 'south la', '90012': 'chinatown', '90013': 'downtown la',
  '90014': 'downtown la', '90015': 'downtown la', '90016': 'west adams', '90017': 'downtown la',
  '90018': 'jefferson park', '90019': 'mid-city', '90020': 'koreatown', '90021': 'downtown la',
  '90022': 'east la', '90023': 'boyle heights', '90024': 'westwood', '90025': 'west la',
  '90026': 'echo park', '90027': 'los feliz', '90028': 'hollywood', '90029': 'east hollywood',
  '90031': 'lincoln heights', '90032': 'el sereno', '90033': 'boyle heights', '90034': 'palms',
  '90035': 'pico-robertson', '90036': 'fairfax', '90037': 'south la', '90038': 'hollywood',
  '90039': 'atwater village', '90041': 'eagle rock', '90042': 'highland park', '90043': 'hyde park',
  '90044': 'athens', '90045': 'westchester', '90046': 'west hollywood', '90047': 'south la',
  '90048': 'beverly grove', '90049': 'brentwood', '90056': 'ladera heights', '90057': 'westlake',
  '90061': 'south la', '90062': 'south la', '90063': 'east la', '90064': 'rancho park',
  '90065': 'glassell park', '90066': 'mar vista', '90067': 'century city', '90068': 'hollywood hills',
  '90069': 'west hollywood', '90071': 'downtown la', '90077': 'bel air', '90089': 'usc',
  '90094': 'playa vista', '90210': 'beverly hills', '90211': 'beverly hills', '90212': 'beverly hills',
  '90230': 'culver city', '90232': 'culver city', '90245': 'el segundo', '90247': 'gardena',
  '90248': 'gardena', '90249': 'gardena', '90254': 'hermosa beach', '90260': 'lawndale',
  '90266': 'manhattan beach', '90272': 'pacific palisades', '90274': 'palos verdes', '90275': 'rancho palos verdes',
  '90277': 'redondo beach', '90278': 'redondo beach', '90290': 'topanga', '90291': 'venice',
  '90292': 'marina del rey', '90293': 'playa del rey', '90301': 'inglewood', '90302': 'inglewood',
  '90303': 'inglewood', '90304': 'inglewood', '90305': 'inglewood', '90401': 'santa monica',
  '90402': 'santa monica', '90403': 'santa monica', '90404': 'santa monica', '90405': 'santa monica',
  '90501': 'torrance', '90502': 'torrance', '90503': 'torrance', '90504': 'torrance',
  '90505': 'torrance', '90601': 'whittier', '90602': 'whittier', '90603': 'whittier',
  '90604': 'whittier', '90605': 'whittier', '90640': 'montebello', '90650': 'norwalk',
  '90660': 'pico rivera', '90701': 'artesia', '90703': 'cerritos', '90706': 'bellflower',
  '90710': 'harbor city', '90712': 'lakewood', '90713': 'lakewood', '90715': 'lakewood',
  '90717': 'lomita', '90731': 'san pedro', '90732': 'san pedro', '90744': 'wilmington',
  '90745': 'carson', '90746': 'carson', '90755': 'signal hill', '90802': 'long beach',
  '90803': 'long beach', '90804': 'long beach', '90805': 'long beach', '90806': 'long beach',
  '90807': 'long beach', '90808': 'long beach', '90810': 'long beach', '90813': 'long beach',
  '90814': 'long beach', '90815': 'long beach', '91001': 'altadena', '91006': 'arcadia',
  '91007': 'arcadia', '91011': 'la canada', '91016': 'monrovia', '91024': 'sierra madre',
  '91030': 'south pasadena', '91040': 'sunland', '91042': 'tujunga', '91101': 'pasadena',
  '91103': 'pasadena', '91104': 'pasadena', '91105': 'pasadena', '91106': 'pasadena',
  '91107': 'pasadena', '91108': 'san marino', '91201': 'glendale', '91202': 'glendale',
  '91203': 'glendale', '91204': 'glendale', '91205': 'glendale', '91206': 'glendale',
  '91207': 'glendale', '91208': 'glendale', '91214': 'la crescenta', '91301': 'agoura hills',
  '91302': 'calabasas', '91303': 'canoga park', '91304': 'west hills', '91306': 'winnetka',
  '91307': 'west hills', '91311': 'chatsworth', '91316': 'encino', '91324': 'northridge',
  '91325': 'northridge', '91331': 'pacoima', '91335': 'reseda', '91340': 'san fernando',
  '91342': 'sylmar', '91343': 'north hills', '91344': 'granada hills', '91345': 'mission hills',
  '91352': 'sun valley', '91356': 'tarzana', '91364': 'woodland hills', '91367': 'woodland hills',
  '91401': 'van nuys', '91402': 'panorama city', '91403': 'sherman oaks', '91405': 'van nuys',
  '91406': 'van nuys', '91411': 'van nuys', '91423': 'sherman oaks', '91436': 'encino',
  '91501': 'burbank', '91502': 'burbank', '91504': 'burbank', '91505': 'burbank',
  '91506': 'burbank', '91601': 'north hollywood', '91602': 'toluca lake', '91604': 'studio city',
  '91605': 'north hollywood', '91606': 'north hollywood', '91607': 'valley village', '91706': 'baldwin park',
  '91711': 'claremont', '91731': 'el monte', '91732': 'el monte', '91733': 'south el monte',
  '91740': 'glendora', '91741': 'glendora', '91744': 'la puente', '91746': 'la puente',
  '91754': 'monterey park', '91755': 'monterey park', '91765': 'diamond bar', '91766': 'pomona',
  '91767': 'pomona', '91768': 'pomona', '91770': 'rosemead', '91775': 'san gabriel',
  '91776': 'san gabriel', '91780': 'temple city', '91789': 'walnut', '91790': 'west covina',
  '91791': 'west covina', '91801': 'alhambra', '91803': 'alhambra',
};

export function areaFromZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  return ZIP_AREAS[String(zip).trim()] ?? null;
}
