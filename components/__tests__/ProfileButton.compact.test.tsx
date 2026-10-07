import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {TouchableOpacity} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {router} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileButton from '../ProfileButton';
jest.mock('@tanstack/react-query',()=>({useQuery:jest.fn()}));
jest.mock('expo-router',()=>({router:{push:jest.fn()}}));
jest.mock('../../lib/supabase',()=>({supabase:{}}));
jest.mock('../InboxModal',()=>()=>null);
jest.mock('../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:jest.requireActual('../../constants/Typography').AfterglowFonts})}));
let tree:ReactTestRenderer;
beforeEach(()=>{(useQuery as jest.Mock).mockImplementation(({queryKey})=>({data:queryKey[0]==='profile-photo'?'https://example.test/photo.jpg':queryKey[0]==='inbox-count'?3:'viewer',refetch:jest.fn()}));});
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllMocks();});
it('opens Profile directly from the compact photo without an inbox or completion interruption',async()=>{
 act(()=>{tree=create(<ProfileButton compact surface="scene"/>);});
 const buttons=tree.root.findAllByType(TouchableOpacity);
 expect(buttons.find(b=>b.props.accessibilityLabel==='Inbox')).toBeUndefined();
 await act(async()=>{await buttons.find(b=>b.props.accessibilityLabel==='Profile')!.props.onPress();});
 expect(router.push).toHaveBeenCalledWith('/(tabs)/profile');expect(AsyncStorage.getItem).not.toHaveBeenCalled();
 expect((useQuery as jest.Mock).mock.calls.find(([o])=>o.queryKey[0]==='inbox-count')![0].enabled).toBe(false);
});
it('retains the existing inbox entry on main app headers',()=>{
 act(()=>{tree=create(<ProfileButton/>);});
 expect(tree.root.findAllByType(TouchableOpacity).find(b=>b.props.accessibilityLabel==='Inbox')).toBeDefined();
 expect((useQuery as jest.Mock).mock.calls.find(([o])=>o.queryKey[0]==='inbox-count')![0].enabled).toBe(true);
});
