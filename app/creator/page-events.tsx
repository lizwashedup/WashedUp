import React from 'react';
import {Redirect,useLocalSearchParams} from 'expo-router';
import {CREATOR_PAGES_ENABLED} from '../../constants/FeatureFlags';
import CreatorPageEventsScreen from '../../components/creator/pages/CreatorPageEventsScreen';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export default function CreatorPageEventsRoute(){
  const {id,create}=useLocalSearchParams<{id?:string;create?:string}>();
  return CREATOR_PAGES_ENABLED&&uuid(id)?<CreatorPageEventsScreen key={id} pageId={id} startCreating={create==='1'}/>:<Redirect href="/(tabs)/friends"/>;
}
