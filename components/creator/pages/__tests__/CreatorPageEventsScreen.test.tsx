jest.mock('../../../ProfileButton',()=>()=>null);
import React from 'react';
import MenuCard from '../../../menu/MenuCard';
import {BrandedAlert} from '../../../BrandedAlert';
jest.mock('../../../menu/MenuCard',()=>({__esModule:true,default:()=>null}));import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {Dimensions,ScrollView,Pressable,Text,TextInput} from 'react-native';
const mockTemplates=jest.fn(),mockDeleteTemplate=jest.fn();
jest.mock('../../../../lib/creatorPageEventTemplateLibrary',()=>({listCreatorEventTemplates:(...a:unknown[])=>mockTemplates(...a),deleteCreatorEventTemplate:(...a:unknown[])=>mockDeleteTemplate(...a),creatorTemplateRoute:(t:any)=>`/creator/page-event-reuse?pageId=${t.source_page_id}&sourceEventId=${t.source_event_id}&templateId=${t.id}`}));
const mockLoad=jest.fn(),mockCreate=jest.fn(),mockDismissTo=jest.fn(),mockPush=jest.fn(),mockStorage=new Map<string,string>();let mockCurrent=true;
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0f920000-0000-4000-8000-000000000011',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';
let mockScope={userId:user,isCurrent:()=>mockCurrent};
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockScope.userId,epoch:1,isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageTeamWorkspace',()=>({loadCreatorPageTeamWorkspace:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../../../../lib/creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{},createCreatorPageEventDraft:(...a:unknown[])=>mockCreate(...a)}));
jest.mock('../../../../lib/creatorEvents',()=>({EVENT_CATEGORIES:['community','music']}));
jest.mock('expo-router',()=>({router:{dismissTo:(...a:unknown[])=>mockDismissTo(...a),push:(...a:unknown[])=>mockPush(...a),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:async(k:string)=>mockStorage.get(k)??null,setItem:async(k:string,v:string)=>{mockStorage.set(k,v);},removeItem:async(k:string)=>{mockStorage.delete(k);}}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0f920000-0000-4000-8000-000000000011'}));
jest.mock('../../../events/EventMediaImage',()=>({EventMediaImage:require('react-native').View}));
import {formatEventDateLA} from '../../../../lib/laDate';
import CreatorPageEventsScreen,{eventSection} from '../CreatorPageEventsScreen';import {PageAction,PageFrame} from '../PageFrame';
function renderedText(node:any):string{return typeof node==='string'?node:Array.isArray(node)?node.map(renderedText).join(' '):node?.children?renderedText(node.children):'';}
let tree:ReactTestRenderer;const actions=()=>[...tree.root.findAllByType(PageAction),...tree.root.findAllByType(MenuCard).flatMap(menu=>menu.props.rows.map((row:any)=>({props:{title:row.label,onPress:row.onPress}})))];const action=(title:string)=>actions().find(n=>n.props.title===title)!;
async function flush(){for(let n=0;n<5;n++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>{tree=create(<CreatorPageEventsScreen pageId={page}/>);});await flush();act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Drafts')[0].props.onPress());}
async function start(){act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Meet at sunset'));act(()=>tree.root.findByProps({accessibilityLabel:'Category: community'}).props.onPress());}
beforeEach(()=>{jest.clearAllMocks();mockDismissTo.mockReset();mockStorage.clear();mockCurrent=true;mockTemplates.mockResolvedValue([]);mockDeleteTemplate.mockResolvedValue(undefined);mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[]});mockCreate.mockResolvedValue(event);});
afterEach(()=>act(()=>tree?.unmount()));
it('loads the narrow page workspace without automatically creating an event',async()=>{await mount();expect(renderedText(tree.toJSON())).toContain('Sunset page');expect(mockCreate).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);});
it('returns to the existing same-page team screen without adding another management cycle',async()=>{
 let stack=['/creator/pages',`/creator/page-events?id=${page}`,`/creator/page-team?id=${page}`,`/creator/page-events?id=${page}`];
 mockDismissTo.mockImplementation(path=>{stack=stack.slice(0,stack.lastIndexOf(path)+1);});
 await mount();act(()=>action('Page & team').props.onPress());
 expect(mockDismissTo).toHaveBeenCalledWith(`/creator/page-team?id=${page}`);expect(mockPush).not.toHaveBeenCalled();
 expect(stack).toEqual(['/creator/pages',`/creator/page-events?id=${page}`,`/creator/page-team?id=${page}`]);expect(mockCreate).not.toHaveBeenCalled();
 mockDismissTo.mockClear();mockCurrent=false;act(()=>action('Page & team').props.onPress());expect(mockDismissTo).not.toHaveBeenCalled();
});
it('prepares one private event and opens the original editor with its selected page context',async()=>{await mount();await start();act(()=>tree.root.findByProps({accessibilityLabel:'Category: community'}).props.onPress());act(()=>tree.root.findByProps({accessibilityLabel:'Category: music'}).props.onPress());await act(async()=>{await action('Continue').props.onPress();});expect(mockCreate).toHaveBeenCalledWith({pageId:page,eventId:event,title:'Meet at sunset',category:'music',categories:['music']},mockScope);expect(mockPush).toHaveBeenCalledWith(`/creator/event-form?id=${event}&pageId=${page}&team=1`);expect(mockStorage.size).toBe(0);});
it('synchronous action locking prevents duplicate creation on a repeated callback',async()=>{await mount();await start();const save=action('Continue').props.onPress;await act(async()=>{await Promise.all([save(),save()]);});expect(mockCreate).toHaveBeenCalledTimes(1);});
it('checks an unknown creation read-only before an explicit same-ID retry',async()=>{await mount();await start();mockCreate.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await action('Continue').props.onPress();});expect(mockStorage.size).toBe(1);expect(mockPush).not.toHaveBeenCalled();await act(async()=>{await action('Check draft').props.onPress();});expect(mockCreate).toHaveBeenCalledTimes(1);expect(action('Continue saved draft')).toBeDefined();await act(async()=>{await action('Continue saved draft').props.onPress();});expect(mockCreate).toHaveBeenCalledTimes(2);expect(mockCreate.mock.calls[1][0]).toEqual(mockCreate.mock.calls[0][0]);});
it('revoked or unreadable access hides cached event contents with a reachable check',async()=>{mockLoad.mockResolvedValue({pageId:page,name:'Private page name',kind:'organization',ownerId:'owner',events:[{id:event,title:'Private draft title',status:'Draft',category:'community'}]});await mount();mockLoad.mockRejectedValue(Error('Revoked'));await act(async()=>{await tree.root.findByType(PageFrame).props.onRefresh();});expect(renderedText(tree.toJSON())).not.toContain('Private draft title');expect(renderedText(tree.toJSON())).not.toContain('Private page name');expect(action('Check page events')).toBeDefined();expect(action('Check draft')).toBeUndefined();});
it('capability loss at the creation preflight prevents even a persisted new draft',async()=>{await mount();await start();mockLoad.mockRejectedValue(Error('Permission changed'));await act(async()=>{await action('Continue').props.onPress();});expect(mockCreate).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);});
it('event cards carry exact event and page IDs into the editor',async()=>{mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Draft',category:'community'}]});await mount();act(()=>tree.root.findByProps({accessibilityLabel:'Open Saved event, private draft'}).props.onPress());expect(mockPush).toHaveBeenCalledWith(`/creator/event-form?id=${event}&pageId=${page}&team=1`);});

it('teammate views only a Live saved event in Scene without changing its original edit route',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Live',category:'community'},{id:'draft',title:'Private gathering',status:'Draft',category:'music'}]});await mount();
 act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Live')[0].props.onPress());
 expect(actions().filter(n=>n.props.title==='View in Scene')).toHaveLength(1);
 act(()=>action('View in Scene').props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/event/${event}`);
 act(()=>tree.root.findByProps({accessibilityLabel:'Open Saved event, Live'}).props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/creator/event-form?id=${event}&pageId=${page}&team=1`);
 expect(mockCreate).not.toHaveBeenCalled();
});
it('a retired teammate cannot navigate through an old public-event callback',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Live',category:'community'}]});await mount();
 act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Live')[0].props.onPress());
 const press=action('View in Scene').props.onPress;mockCurrent=false;act(()=>press());expect(mockPush).not.toHaveBeenCalled();
});

it('keeps uncropped artwork beside the original event link and shows LA date with quiet status',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Sunset gathering',status:'Draft',category:'music',image_url:'https://example.test/poster.webp',event_date:'2027-01-10'}]});await mount();
 const image=tree.root.findByProps({accessibilityLabel:'Sunset gathering artwork'});
 expect(image.props.eventId).toBe(event);expect(image.props.contentFit).toBe('contain');
 const link=tree.root.findByProps({accessibilityLabel:'Open Sunset gathering, private draft'});
 expect(link.findAllByProps({accessibilityLabel:'Sunset gathering artwork'})).toHaveLength(0);
 expect(renderedText(tree.toJSON())).toContain(formatEventDateLA('2027-01-10'));
 act(()=>link.props.onPress());expect(mockPush).toHaveBeenCalledWith(`/creator/event-form?id=${event}&pageId=${page}&team=1`);
});
it('distinguishes an unscheduled event from an older response without date metadata',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Draft',category:'music'}]});await mount();
 expect(renderedText(tree.toJSON())).not.toContain('Date to come');
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Draft',category:'music',event_date:null,image_url:null}]});await act(async()=>{await tree.root.findByType(PageFrame).props.onRefresh();});
 expect(renderedText(tree.toJSON())).toContain('Date to come');
});

it('connects same-page management without granting access from a stale visit',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Saved event',status:'Live',category:'music'}]});await mount();
 act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Live')[0].props.onPress());
 const press=action('Manage event').props.onPress;act(()=>press());expect(mockPush).toHaveBeenLastCalledWith(`/creator/event-summary?id=${event}&pageId=${page}`);
 mockPush.mockClear();mockCurrent=false;act(()=>press());expect(mockPush).not.toHaveBeenCalled();
});

it('successful refresh updates events without leaving an internal success banner',async()=>{
 await mount();await act(async()=>{await tree.root.findByType(PageFrame).props.onRefresh();});
 expect(renderedText(tree.toJSON())).not.toContain('Saved event status checked');
 expect(action('Check draft')).toBeUndefined();expect(action('New event').props.disabled).toBe(false);
});

it('keeps past events reachable and opens saved templates through their original provenance',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'community',ownerId:'owner',events:[{id:event,title:'Our first gathering',status:'Completed',category:'music'}]});
 mockTemplates.mockResolvedValue([{id:'template',name:'Sunday format',source_page_id:page,source_event_id:event}]);await mount();
 const tab=(name:string)=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel===name)[0];
 act(()=>tab('Past').props.onPress());expect(tree.root.findByProps({accessibilityLabel:'Open Our first gathering, Completed'})).toBeDefined();
 await act(async()=>tab('Templates').props.onPress());await flush();
 act(()=>action('Sunday format').props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/creator/page-event-reuse?pageId=${page}&sourceEventId=${event}&templateId=template`);
 expect(mockCreate).not.toHaveBeenCalled();const old=action('Sunday format').props.onPress;mockCurrent=false;mockPush.mockClear();act(()=>old());expect(mockPush).not.toHaveBeenCalled();
});
it('past grouping retains cancelled history and never turns an old private draft into a live event',()=>{
 expect(eventSection({status:'Cancelled'})).toBe('Past');expect(eventSection({status:'Archived'})).toBe('Past');expect(eventSection({status:'Live',event_date:'2000-01-01'})).toBe('Past');expect(eventSection({status:'Draft',event_date:'2000-01-01'})).toBe('Drafts');
});


it('restores template deletion only after a separate confirmation without deleting its source event',async()=>{
 const template={id:'template',name:'Sunday format',source_page_id:page,source_event_id:event,user_id:user};
 mockTemplates.mockResolvedValue([template]);await mount();
 await act(async()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Templates')[0].props.onPress());await flush();
 act(()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Delete template: Sunday format'&&typeof n.props.onPress==='function')[0].props.onPress());
 expect(mockDeleteTemplate).not.toHaveBeenCalled();const alert=tree.root.findByType(BrandedAlert);expect(alert.props.visible).toBe(true);
 mockTemplates.mockResolvedValue([]);act(()=>{alert.props.buttons.find((button:any)=>button.text==='Delete template').onPress();alert.props.onClose();});await flush();
 expect(mockDeleteTemplate).toHaveBeenCalledTimes(1);expect(mockDeleteTemplate).toHaveBeenCalledWith(template,mockScope);
 expect(mockCreate).not.toHaveBeenCalled();expect(renderedText(tree.toJSON())).toContain('No templates yet');expect(renderedText(tree.toJSON())).not.toContain('Sunday format');
});

it('returns to the new private draft after the editor focus visit retires',async()=>{
 await mount();act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Live')[0].props.onPress());
 await start();await act(async()=>{await action('Continue').props.onPress();});
 mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[{id:event,title:'Meet at sunset',status:'Draft',category:'community'}]});
 mockScope={...mockScope};await act(async()=>tree.update(<CreatorPageEventsScreen pageId={page}/>));await flush();
 expect(tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Drafts')[0].props.accessibilityState.selected).toBe(true);
 expect(tree.root.findByProps({accessibilityLabel:'Open Meet at sunset, private draft'})).toBeDefined();
});

it.each(['Live','Completed'] as const)('follows the opened event to its confirmed %s section after return',async status=>{
 const row={id:event,title:'Meet at sunset',status:'Draft',category:'community'};
 mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[row]});await mount();
 act(()=>tree.root.findByProps({accessibilityLabel:'Manage Meet at sunset'}).props.onPress());
 mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[{...row,status}]});
 mockScope={...mockScope};await act(async()=>tree.update(<CreatorPageEventsScreen pageId={page}/>));await flush();
 expect(tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel===(status==='Live'?'Live':'Past'))[0].props.accessibilityState.selected).toBe(true);
 expect(tree.root.findByProps({accessibilityLabel:'Manage Meet at sunset'})).toBeDefined();
});

it('returns to the newly saved duplicate rather than the source event',async()=>{
 const original={id:event,title:'Original',status:'Live',category:'community'};
 mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[original]});await mount();
 act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Live')[0].props.onPress());
 const duplicate={...original,id:'copy',title:'New copy',status:'Draft'};
 require('../../../../lib/creatorEventReturn').rememberSavedCreatorEvent(page,duplicate.id,mockScope);
 mockLoad.mockResolvedValue({pageId:page,name:'Sunset page',kind:'organization',ownerId:'owner',events:[original,duplicate]});mockScope={...mockScope};await act(async()=>tree.update(<CreatorPageEventsScreen pageId={page}/>));await flush();
 expect(tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Drafts')[0].props.accessibilityState.selected).toBe(true);expect(tree.root.findByProps({accessibilityLabel:'Manage New copy'})).toBeDefined();
});

it('announces the displayed Ended status for dated Live events in Past and retains the exact editor route',async()=>{
 mockLoad.mockResolvedValue({pageId:page,name:'Page',kind:'organization',ownerId:'owner',events:[{id:event,title:'Saved organization event',status:'Live',event_date:'2000-01-01',category:'community'}]});
 await mount();act(()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Past')[0].props.onPress());
 const entry=tree.root.findByProps({accessibilityLabel:'Open Saved organization event, Ended'});
 expect(entry.findAllByType(Text).some(n=>n.props.children==='Ended')).toBe(true);
 expect(tree.root.findAllByProps({accessibilityLabel:'Open Saved organization event, Live'})).toHaveLength(0);
 act(()=>entry.props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/creator/event-form?id=${event}&pageId=${page}&team=1`);
});

it('remeasures mounted event identity, tabs and empty copy while preserving selection and controls',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,fontScale:1}}));
 try{await mount();const screen=tree.root.findByType(CreatorPageEventsScreen),scroll=tree.root.findByType(ScrollView),next=action('New event');
 const values=['ORGANIZATION','Sunset page','Your events','Room for your next idea','No drafts yet. Start an event and finish the details at your own pace.'];const leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===v)!;let leaves=values.map(leaf);expect(leaves.every(Boolean)).toBe(true);
 const tab=()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&n.props.accessibilityLabel==='Drafts')[0];const selected=tab();
 for(const fontScale of [1.35,1]){act(()=>Dimensions.set({window:{...previous,fontScale}}));values.forEach((v,i)=>expect(leaf(v)).not.toBe(leaves[i]));leaves=values.map(leaf);expect(tree.root.findByType(CreatorPageEventsScreen)).toBe(screen);expect(tree.root.findByType(ScrollView)).toBe(scroll);expect(action('New event')).toBe(next);expect(tab()).toBe(selected);expect(tab().props.accessibilityState.selected).toBe(true);}
 expect(mockCreate).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
