import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPush = jest.fn(), mockReplace = jest.fn(), mockAccess = jest.fn();
let mockPagesEnabled = true;
jest.mock('expo-router', () => ({ router: { push: (...args:any[])=>mockPush(...args), replace: (...args:any[])=>mockReplace(...args) } }));
jest.mock('../../../constants/FeatureFlags', () => ({ get CREATOR_PAGES_ENABLED(){ return mockPagesEnabled; } }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess:()=>mockAccess(), hasCreatorAccess:(a:any)=>a?.approved===true, creatorLandingRoute:()=> '/(creator)/today' }));
jest.mock('../../../lib/haptics', () => ({ hapticMedium:jest.fn() }));
import { CreatorSpaceBanner } from '../CreatorSpaceBanner';
let tree:ReactTestRenderer;
beforeEach(()=>{jest.clearAllMocks();mockPagesEnabled=true;mockAccess.mockResolvedValue({approved:true});});
afterEach(()=>act(()=>tree?.unmount()));
async function render(){await act(async()=>{tree=create(<CreatorSpaceBanner/>)});}
it('pushes the page workspace while preserving the personal screen for Back', async()=>{
 await render();const action=tree.root.findAll(n=>n.props.accessibilityRole==='button'&&typeof n.props.onPress==='function')[0];
 await act(async()=>action.props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/pages');expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps the legacy route unchanged when page management is disabled', async()=>{
 mockPagesEnabled=false;await render();const action=tree.root.findAll(n=>n.props.accessibilityRole==='button'&&typeof n.props.onPress==='function')[0];
 await act(async()=>action.props.onPress());expect(mockReplace).toHaveBeenCalledWith('/(creator)/today');expect(mockPush).not.toHaveBeenCalled();
});
it('does not widen the approved-creator entry gate', async()=>{
 mockAccess.mockResolvedValue({approved:false});await render();expect(tree.toJSON()).toBeNull();
});
it('does not offer an unverified route after an access read fails', async()=>{
 mockAccess.mockRejectedValue(Error('offline'));await render();expect(tree.toJSON()).toBeNull();
});
