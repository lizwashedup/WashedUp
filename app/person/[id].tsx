import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PeopleRouteAccountGate from '../../components/yours/state/PeopleRouteAccountGate';
import KeepPage from '../../components/yours/keep/KeepPage';

export default function PersonRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PeopleRouteAccountGate id={id}>{props => <KeepPage {...props} />}</PeopleRouteAccountGate>;
}
