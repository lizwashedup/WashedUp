/**
 * WashedUp — Custom Google Map Style
 * Warm, minimal styling to match the Golden Hour design system.
 * Use with MapView: customMapStyle={MAP_STYLE}
 * Note: customMapStyle only works with PROVIDER_GOOGLE on Android.
 */

export const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f0' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9b8b7a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f8f5f0' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#b8a99a' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#f0ebe3' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0ebe3' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9b8b7a' }] },
];
