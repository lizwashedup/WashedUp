import React from 'react';
import { ActivityIndicator } from 'react-native';
import { PageFrame, PageAction, pageStyles } from '../../components/creator/pages/PageFrame';
import { CreatorSpaceEntry } from '../../components/creator/pages/CreatorSpaceEntry';
import { useObservedUser } from '../../hooks/useObservedUser';
import Colors from '../../constants/Colors';
import { ScaledText } from '../../components/ScaledText';

export default function CreatorManagementRoute() {
  const account = useObservedUser();
  return <PageFrame title="You manage">
    {account.error ? <><ScaledText accessibilityRole="alert" style={pageStyles.body}>Couldn’t check your account.</ScaledText><PageAction title="Try again" onPress={() => { void account.retry().catch(() => undefined); }} /></> : account.isLoading ? <ActivityIndicator accessibilityLabel="Checking your account" color={Colors.terracotta} />
      : account.viewerId ? <CreatorSpaceEntry userId={account.viewerId} expanded />
      : <ScaledText>Sign in to manage your communities and events.</ScaledText>}
  </PageFrame>;
}
