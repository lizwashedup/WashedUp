import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { MapView, Marker } from '../../../components/MapView.native';
import { MAP_STYLE } from '../../../constants/MapStyle';
import Colors from '../../../constants/Colors';
import type { Plan } from '../../../lib/fetchPlans';

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

interface PlansMapViewProps {
  plans: Plan[];
  wishlistedSet: Record<string, boolean>;
  onPlanPress: (planId: string) => void;
}

export default function PlansMapView({ plans, wishlistedSet, onPlanPress }: PlansMapViewProps) {
  const mapPlans = plans.filter((p) => p.latitude != null && p.longitude != null);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={LA_REGION}
      customMapStyle={MAP_STYLE}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {mapPlans.map((plan) => (
        <Marker
          key={plan.id}
          coordinate={{ latitude: plan.latitude!, longitude: plan.longitude! }}
          title={plan.title}
          description={plan.location_text ?? undefined}
          pinColor={wishlistedSet[plan.id] ? Colors.errorRed : Colors.terracotta}
          onCalloutPress={() => onPlanPress(plan.id)}
        />
      ))}
    </MapView>
  );
}
