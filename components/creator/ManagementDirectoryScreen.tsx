import React from 'react';
import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { PageFrame, PageAction, pageStyles } from './pages/PageFrame';
import { CreatorSpaceEntry } from './pages/CreatorSpaceEntry';
import { useObservedUser } from '../../hooks/useObservedUser';
import Colors from '../../constants/Colors';
import { ScaledText } from '../ScaledText';

export default function CreatorManagementRoute() {
  const account = useObservedUser();
  return <PageFrame title="You manage" inTabs onBack={() => router.navigate('/(tabs)/friends')}>
    {account.error ? <><ScaledText accessibilityRole="alert" style={pageStyles.body}>Couldn’t check your account.</ScaledText><PageAction title="Try again" onPress={() => { void account.retry().catch(() => undefined); }} /></> : account.isLoading ? <ActivityIndicator accessibilityLabel="Checking your account" color={Colors.terracotta} />
      : account.viewerId ? <CreatorSpaceEntry userId={account.viewerId} expanded />
      : <ScaledText>Sign in to manage your communities and events.</ScaledText>}
  </PageFrame>;
}
