import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PeopleRouteAccountGate from '../../components/yours/state/PeopleRouteAccountGate';
import PersonProfilePage from '../../components/yours/profile/PersonProfilePage';

export default function ProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PeopleRouteAccountGate id={id}>{props => <PersonProfilePage {...props} />}</PeopleRouteAccountGate>;
}
