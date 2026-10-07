import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
let mockEventId='event';
const mockMedia=jest.fn();
jest.mock('../../../hooks/useEventMediaSource',()=>({useEventMediaSource:(...args:unknown[])=>mockMedia(...args)}));
const mockEvent=jest.fn(),mockAudience=jest.fn(),mockPush=jest.fn();let mockScope={userId:'owner',isCurrent:()=>true};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,viewerId:mockScope.userId}})}));
jest.mock('../../../lib/creatorCommunications',()=>({CommunicationAudienceDenied:class extends Error{},getCommunicationEvent:(...a:any[])=>mockEvent(...a),getCommunicationAudience:(...a:any[])=>mockAudience(...a)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockEventId}),router:{push:(...a:any[])=>mockPush(...a),canGoBack:()=>false,replace:jest.fn()}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:({title,onPress,accessibilityLabel,disabled}:any)=>require('react').createElement(require('react-native').Pressable,{accessibilityLabel:accessibilityLabel??title,onPress,disabled})}));
import Screen from '../../../app/creator/event-messages';
let tree:ReactTestRenderer;
const text=()=>{const flatten=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node?.children?flatten(node.children):'';return flatten(tree.toJSON());};
const action=(label:string)=>tree.root.findAll(x=>x.props.accessibilityLabel===label && typeof x.props.onPress==='function')[0];
async function mount(){await act(async()=>{tree=create(<Screen/>);});}
beforeEach(()=>{jest.clearAllMocks();mockEventId='event';mockScope={userId:'owner',isCurrent:()=>true};mockEvent.mockResolvedValue({id:'event',title:'Sunday Table',image:null,venue:'Los Angeles'});mockAudience.mockResolvedValue({purchases:2,rsvps:3});});
afterEach(()=>{if(tree)act(()=>tree.unmount());});
it('denied entry does not read or reveal the audience or creator destinations',async()=>{mockEvent.mockResolvedValue(null);await mount();expect(mockAudience).not.toHaveBeenCalled();expect(text()).not.toContain('Write a message');});
it('distinguishes audience failure from zero recipients and keeps event identity',async()=>{mockAudience.mockRejectedValue(Error('offline'));await mount();expect(text()).toContain('Sunday Table');expect(text()).toContain('Couldn’t load the registration audience');expect(text()).not.toContain('eligible');});
it('shows separate registration sources rather than a false exact-person total',async()=>{await mount();expect(text()).toContain('ticket purchases');expect(text()).toContain('RSVPs');expect(text()).not.toContain('5 people');});
it('preserves original message and reminder destinations for the exact event',async()=>{await mount();await act(async()=>{action('New attendee message').props.onPress();});expect(mockPush).toHaveBeenCalledWith('/creator/attendee-message?id=event');await act(async()=>action('Edit reminders').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/event-reminders?id=event');});
it('a retired event callback cannot navigate under another session',async()=>{await mount();const open=action('New attendee message').props.onPress;mockScope.isCurrent=()=>false;open();expect(mockPush).not.toHaveBeenCalled();});
it('never carries private event content across account changes',async()=>{await mount();expect(text()).toContain('Sunday Table');mockScope={userId:'different',isCurrent:()=>true};mockEvent.mockResolvedValue(null);await act(async()=>tree.update(<Screen/>));expect(text()).not.toContain('Sunday Table');});

it('resolves private event artwork through the existing authenticated no-cache reader',async()=>{
 mockEventId='11111111-1111-4111-8111-111111111111';
 const reference=`creator-event-media:${mockEventId}/private-22222222-2222-4222-8222-222222222222.jpg`;
 const source={uri:'https://isolated.invalid/authenticated-cover',headers:{Authorization:'fictional-test'},useCaching:false};
 mockMedia.mockReturnValue({source,error:false,current:()=>true,generation:1,fail:jest.fn(),retry:jest.fn()});
 mockEvent.mockResolvedValue({id:mockEventId,title:'Sunday Table',image:reference,venue:'Los Angeles'});
 await mount();
 expect(mockMedia).toHaveBeenCalledWith(mockEventId,reference,'cover');
 const image=tree.root.findByType(require('expo-image').Image);
 expect(image.props.source).toBe(source);expect(image.props.cachePolicy).toBe('none');
});
