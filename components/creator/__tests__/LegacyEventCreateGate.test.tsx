import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRefresh=jest.fn(), mockDismissTo=jest.fn();let mockRead:any,mockEpoch=1,mockActive=true,mockUser='alice';
jest.mock('expo-router',()=>({router:{dismissTo:(...args:unknown[])=>mockDismissTo(...args)}}));
const mockScope={userId:'alice',isCurrent:()=>mockActive};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockUser,epoch:mockEpoch,isLoading:false,error:null}})}));
jest.mock('../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:()=>mockRead}));
jest.mock('../../../lib/legacyEventCreate',()=>({resolveLegacyEventCreate:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>require('react').createElement(require('react-native').View,{},children),PageAction:({title,onPress}:any)=>require('react').createElement(require('react-native').Pressable,{accessibilityLabel:title,onPress}),pageStyles:{body:{}}}));
import { LegacyEventCreateGate } from '../LegacyEventCreateGate';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
let tree:ReactTestRenderer,writeScope:CreatorPageScope;
const context={workspace:'community',community:{id:'sunset',name:'Sunset Club'}};
function Draft(){const [title,setTitle]=useState('');return <TextInput value={title} onChangeText={setTitle}/>;}
const screen=()=> <LegacyEventCreateGate workspace="community" communityId="sunset">{(_context,scope)=>{writeScope=scope;return <Draft/>;}}</LegacyEventCreateGate>;
beforeEach(()=>{jest.clearAllMocks();mockEpoch=1;mockActive=true;mockUser='alice';mockRead={data:context,loading:false,error:null,refresh:mockRefresh};});
afterEach(()=>act(()=>tree?.unmount()));
it('retains entered text across blur and revalidation while preventing writes before access is current',()=>{
 act(()=>{tree=create(screen());});act(()=>tree.root.findByType(TextInput).props.onChangeText('Ski evening'));
 const form=tree.root.findByType(Draft);expect(writeScope.isCurrent()).toBe(true);
 mockActive=false;mockRead={...mockRead,data:undefined,loading:true};act(()=>tree.update(screen()));
 expect(tree.root.findByType(Draft)).toBe(form);expect(tree.root.findByType(TextInput).props.value).toBe('Ski evening');expect(writeScope.isCurrent()).toBe(false);
 mockActive=true;act(()=>tree.update(screen()));expect(writeScope.isCurrent()).toBe(false);
 mockRead={...mockRead,data:context,loading:false};act(()=>tree.update(screen()));expect(writeScope.isCurrent()).toBe(true);expect(tree.root.findByType(Draft)).toBe(form);
});
it('never carries a former account’s unsaved form or permission into the new account',()=>{
 act(()=>{tree=create(screen());});const former=writeScope;mockUser='bob';mockEpoch++;mockRead={...mockRead,data:undefined,loading:true};act(()=>tree.update(screen()));
 expect(tree.root.findAllByType(Draft)).toHaveLength(0);expect(former.isCurrent()).toBe(false);
});
it('retains unsaved text but removes write access on a failed or revoked access check',()=>{
 act(()=>{tree=create(screen());});const former=writeScope;mockRead={...mockRead,error:'Access revoked',loading:false};act(()=>tree.update(screen()));
 expect(tree.root.findAllByType(Draft)).toHaveLength(1);expect(former.isCurrent()).toBe(false);
});
it('offers a way back to named management when event creation is unavailable',()=>{
 mockRead={...mockRead,data:undefined,error:'This community is still a draft.',loading:false};
 act(()=>{tree=create(screen());});
 act(()=>tree.root.findAll(n=>n.props.accessibilityLabel==='You manage')[0].props.onPress());
 expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/friends/manage');
 expect(tree.root.findAllByType(Draft)).toHaveLength(0);
});
