import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPage = '17000000-0000-4000-8000-000000000001';
let mockParams: {id?:unknown}, mockEnabled = true;
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,Redirect:(props:any)=>require('react').createElement('Redirect',props)}));
jest.mock('../../../constants/FeatureFlags',()=>({get CREATOR_PAGES_ENABLED(){return mockEnabled;}}));
jest.mock('../../../components/creator/pages/CreatorPageRequestsScreen',()=>({__esModule:true,default:(props:any)=>require('react').createElement('Requests',props)}));
import Route from '../page-requests';
let tree:ReactTestRenderer;
beforeEach(()=>{mockEnabled=true;mockParams={id:mockPage};});
afterEach(()=>act(()=>tree?.unmount()));
function mount(){act(()=>{tree=create(<Route/>);});}
it('preserves the exact page identity and remounts review state when another page is opened',()=>{
 mount();expect(tree.root.findByType('Requests' as any).props.pageId).toBe(mockPage);
 const previous=tree.root.findByType('Requests' as any);mockParams={id:'27000000-0000-4000-8000-000000000001'};act(()=>tree.update(<Route/>));
 expect(tree.root.findByType('Requests' as any).props.pageId).toBe(mockParams.id);expect(tree.root.findByType('Requests' as any)===previous).toBe(false);
});
it.each([undefined,'', [mockPage], 'invalid-page'])('rejects malformed request-page identity %j',id=>{mockParams={id};mount();expect(tree.root.findByType('Redirect' as any).props.href).toBe('/(tabs)/friends');expect(tree.root.findAllByType('Requests' as any)).toHaveLength(0);});
it('preserves the feature gate',()=>{mockEnabled=false;mount();expect(tree.root.findAllByType('Requests' as any)).toHaveLength(0);});
