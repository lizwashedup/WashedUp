import React from 'react';
import {Redirect,useLocalSearchParams} from 'expo-router';
import {CREATOR_PAGES_ENABLED} from '../../constants/FeatureFlags';
import CreatorPageRequestsScreen from '../../components/creator/pages/CreatorPageRequestsScreen';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export default function CreatorPageRequestsRoute(){
  const {id}=useLocalSearchParams<{id?:string}>();
  return CREATOR_PAGES_ENABLED&&uuid(id)?<CreatorPageRequestsScreen key={id} pageId={id}/>:<Redirect href="/(tabs)/friends"/>;
}
