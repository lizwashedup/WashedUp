import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn(), mockEvent = jest.fn(), mockTeam = jest.fn();
let mockCurrent = true;
const mockScope = { userId: 'creator', isCurrent: () => mockCurrent };
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:'creator',epoch:1,isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageWorkspace',()=>({loadCreatorPageWorkspace:(...args:unknown[])=>mockLoad(...args)}));
jest.mock('../../../../lib/creatorPageTeamWorkspace',()=>({loadCreatorPageTeamWorkspace:(...args:unknown[])=>mockTeam(...args)}));
jest.mock('../../../../lib/creatorEvents',()=>({getOperatorEvent:(...args:unknown[])=>mockEvent(...args)}));
jest.mock('../../../../lib/supabase',()=>({supabase:{}}));
jest.mock('expo-router',()=>({router:{canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import CreatorPageEventGate from '../CreatorPageEventGate';
let tree:ReactTestRenderer;
const render=(child:jest.Mock)=> <CreatorPageEventGate pageId="page" eventId="event">{child}</CreatorPageEventGate>;
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockLoad.mockResolvedValue({draft:{id:'page',page_data:{name:'Page'},owner_id:'creator',page_kind:'organization'},events:[{id:'event',status:'Live'}]});});
afterEach(()=>act(()=>tree?.unmount()));
it('waits for a fresh full saved event before mounting the editor',async()=>{
 let resolve!:(x:unknown)=>void;mockEvent.mockReturnValue(new Promise(r=>{resolve=r;}));const child=jest.fn(()=>null);
 await act(async()=>{tree=create(render(child));});expect(child).not.toHaveBeenCalled();
 const event={id:'event',status:'Live',title:'Fresh title',description_blocks:[{type:'text',content:'Keep saved story'}]};
 await act(async()=>{resolve(event);});expect(child).toHaveBeenCalledWith({pageId:'page',name:'Page',ownerId:'creator',kind:'organization',isPublished:false,entry:'owner'},mockScope,event);
});
it('never opens or reads an event outside the owning page',async()=>{
 mockLoad.mockResolvedValue({draft:{id:'page',page_data:{name:'Page'},owner_id:'creator',page_kind:'organization'},events:[{id:'other-event'}]});const child=jest.fn(()=>null);
 await act(async()=>{tree=create(render(child));});expect(mockEvent).not.toHaveBeenCalled();expect(child).not.toHaveBeenCalled();
});
it('rejects a full-event response arriving after the page/account visit retires',async()=>{
 let resolve!:(x:unknown)=>void;mockEvent.mockReturnValue(new Promise(r=>{resolve=r;}));const child=jest.fn(()=>null);
 await act(async()=>{tree=create(render(child));});mockCurrent=false;
 await act(async()=>{resolve({id:'event',status:'Draft'});});expect(child).not.toHaveBeenCalled();
});

it('teammate entry uses only the narrow workspace and passes no owner review information',async()=>{
 mockTeam.mockResolvedValue({pageId:'page',kind:'community',name:'Published page',ownerId:'owner',events:[{id:'event'}]});mockEvent.mockResolvedValue({id:'event',status:'Live'});const child=jest.fn(()=>null);
 await act(async()=>{tree=create(<CreatorPageEventGate pageId="page" eventId="event" team>{child}</CreatorPageEventGate>);});
 expect(mockLoad).not.toHaveBeenCalled();expect(child).toHaveBeenCalledWith({pageId:'page',kind:'community',name:'Published page',ownerId:'owner',isPublished:true,entry:'team'},mockScope,{id:'event',status:'Live'});
});
it('unavailable teammate access never falls back to private owner reads',async()=>{
 mockTeam.mockRejectedValue(Error('Page unavailable'));const child=jest.fn(()=>null);
 await act(async()=>{tree=create(<CreatorPageEventGate pageId="page" eventId="event" team>{child}</CreatorPageEventGate>);});expect(mockLoad).not.toHaveBeenCalled();expect(mockEvent).not.toHaveBeenCalled();expect(child).not.toHaveBeenCalled();
});
it('a teammate cannot open an event outside the selected page',async()=>{
 mockTeam.mockResolvedValue({pageId:'page',kind:'community',name:'Page',ownerId:'owner',events:[{id:'other'}]});const child=jest.fn(()=>null);
 await act(async()=>{tree=create(<CreatorPageEventGate pageId="page" eventId="event" team>{child}</CreatorPageEventGate>);});expect(mockEvent).not.toHaveBeenCalled();expect(child).not.toHaveBeenCalled();
});
