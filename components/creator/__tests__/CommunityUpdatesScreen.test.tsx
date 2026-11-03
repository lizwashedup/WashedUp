import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockSend = jest.fn(), mockCheck = jest.fn(), mockHistory = jest.fn(), mockAudience = jest.fn();
const mockInvalidate = jest.fn();
let mockScope: any, mockCommunity: any, mockEpoch: number;
jest.mock('@tanstack/react-query', () => ({useQueryClient: () => ({invalidateQueries: mockInvalidate})}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({dispatch: jest.fn()}), usePreventRemove: jest.fn()}));
jest.mock('../../../hooks/useCreatorAccessRead', () => ({useCreatorAccessRead: () => ({data:{},isLoading:false,isError:false})}));
jest.mock('../../../hooks/useCreatorPageScope', () => ({useCreatorPageScope: () => ({scope:mockScope,account:{epoch:mockEpoch,isLoading:false,error:null}})}));
jest.mock('../../../lib/selectedCommunity', () => ({useLedCommunity: () => mockCommunity}));
jest.mock('../../../lib/creatorMode', () => ({getBroadcasts: (...a: any[]) => mockHistory(...a),getBroadcastAudienceCount:(...a:any[])=>mockAudience(...a),sendBroadcast:(...a:any[])=>mockSend(...a),checkBroadcast:(...a:any[])=>mockCheck(...a),isAdminTierRole:(role:string)=>['leader','admin','co_leader'].includes(role)}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({useAfterglowFonts: () => ({fonts:require('../../../constants/Typography').CreatorFonts})}));
jest.mock('../pages/PageFrame', () => ({PageAction: (p:any) => require('react')['createElement']('button',{...p,accessibilityLabel:p.accessibilityLabel??p.title},p.title)}));
jest.mock('../../keyboard/KeyboardDoneBar', () => ({KEYBOARD_DONE_ACCESSORY_ID:'done'}));
jest.mock('expo-crypto', () => ({randomUUID:()=> '11111111-1111-4111-8111-111111111111'}));
import Screen from '../CommunityUpdatesScreen';
let tree: ReactTestRenderer;
const control=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&(typeof n.props.onPress==='function'||typeof n.props.onChangeText==='function'))[0];
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):(node?.children??[]).map(text).join('');
const mount=async()=>{await act(async()=>{tree=create(<Screen/>);});};
const type=async(body:string)=>{await act(async()=>control('Community update').props.onChangeText(body));};
const press=async(label:string)=>{await act(async()=>control(label).props.onPress());};
function pending(){let resolve!:(v?:any)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
beforeEach(()=>{
 jest.clearAllMocks();mockEpoch=1;mockScope={userId:'one',isCurrent:()=>true};mockCommunity={id:'sunset',name:'Sunset Club',role:'leader'};
 (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
 mockHistory.mockResolvedValue([]);mockAudience.mockResolvedValue(0);mockCheck.mockResolvedValue(false);mockSend.mockResolvedValue(undefined);
});
afterEach(()=>act(()=>tree?.unmount()));
it('keeps failed history and audience reads honest while retaining the draft during refresh',async()=>{
 mockHistory.mockRejectedValue(Error('offline'));mockAudience.mockRejectedValue(Error('offline'));await mount();await type('Bring a picnic');
 expect(text(tree.toJSON())).toContain('Couldn’t check who receives');expect(text(tree.toJSON())).not.toContain('No other members');
 mockHistory.mockResolvedValue([{id:'old',body:'Previously sent',created_at:'2026-09-18T17:00:00Z'}]);await press('Refresh sent updates');
 expect(control('Community update').props.value).toBe('Bring a picnic');expect(text(tree.toJSON())).toContain('Previously sent');
});
it('persists the original ID before sending and closes the same-frame double-tap gap',async()=>{
 await mount();await type('Bring a picnic');const write=pending();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>write.promise);
 const send=control('Send update').props.onPress;act(()=>{send();send();});expect(mockSend).not.toHaveBeenCalled();
 await act(async()=>write.resolve());expect(mockSend).toHaveBeenCalledTimes(1);
 expect(mockSend).toHaveBeenCalledWith('sunset','Bring a picnic',mockScope,'11111111-1111-4111-8111-111111111111');
 expect(text(tree.toJSON())).toContain('Update posted');
 await act(async()=>send());expect(mockSend).toHaveBeenCalledTimes(1);
});
it('checks an uncertain result without sending, then retries only the saved ID',async()=>{
 mockSend.mockRejectedValueOnce(Error('lost response'));await mount();await type('Bring a picnic');await press('Send update');
 expect(text(tree.toJSON())).toContain('may already have been posted');await press('Check update');expect(mockSend).toHaveBeenCalledTimes(1);
 await press('Retry update');expect(mockSend).toHaveBeenCalledTimes(2);expect(mockSend.mock.calls[1][3]).toBe(mockSend.mock.calls[0][3]);
 expect(text(tree.toJSON())).toContain('Update posted');
});
it('recognizes a confirmed stored update without sending it again',async()=>{
 const body='Already posted';(AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({version:1,userId:'one',eventId:'sunset',kind:'community-update',value:{body,attempt:{id:'11111111-1111-4111-8111-111111111111',body}}}));
 mockCheck.mockResolvedValue(true);await mount();await press('Check update');expect(mockSend).not.toHaveBeenCalled();expect(text(tree.toJSON())).toContain('Update posted');
});
it('does not send when saving the recovery identity fails',async()=>{
 await mount();await type('Keep this');(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk'));await press('Send update');
 expect(mockSend).not.toHaveBeenCalled();expect(text(tree.toJSON())).toContain('Couldn’t save your draft');
});
it('does not dispatch an old visit after a pending local save resolves',async()=>{
 await mount();await type('Keep this');const write=pending();(AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>write.promise);
 act(()=>control('Send update').props.onPress());mockScope.isCurrent=()=>false;await act(async()=>write.resolve());expect(mockSend).not.toHaveBeenCalled();
});
it('separates drafts after an account or community change and rejects old send callbacks',async()=>{
 await mount();await type('Original draft');const staleSend=control('Send update').props.onPress;mockScope.isCurrent=()=>false;
 mockScope={userId:'two',isCurrent:()=>true};mockEpoch=2;mockCommunity={...mockCommunity,id:'another'};await act(async()=>tree.update(<Screen/>));
 expect(control('Community update').props.value).toBe('');await act(async()=>staleSend());expect(mockSend).not.toHaveBeenCalled();
 expect(AsyncStorage.getItem).toHaveBeenCalledWith('creator-communication:v1:two:community-update:another');
});
it('does not give a narrower collaborator the composer',async()=>{
 mockCommunity.role='events';await mount();expect(control('Community update')).toBeUndefined();expect(mockHistory).not.toHaveBeenCalled();
});
