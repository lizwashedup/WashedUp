import React from 'react';
import {Dimensions,Text} from 'react-native';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockPush=jest.fn(),mockRead=jest.fn(),mockRefresh=jest.fn();let mockActive=true,mockUser='alice';
const mockScope={userId:'alice',isCurrent:()=>mockActive};
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a)}}));
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockUser,error:null}})}));
jest.mock('../../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:(...a:unknown[])=>mockRead(...a)}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../../constants/Typography').AfterglowFallbackFonts})}));
jest.mock('../../../../lib/creatorSpaceEntry',()=>({loadCreatorSpaceEntry:jest.fn()}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('lucide-react-native',()=>({ChevronRight:()=>null,Mail:()=>null,Users:()=>null}));
import {CreatorSpaceEntry} from '../CreatorSpaceEntry';
let tree:ReactTestRenderer;
const data={title:'Your community',subtitle:'Sunday Table',route:'/creator/page?id=one',invitations:[]};
const button=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
function mount(){act(()=>{tree=create(<CreatorSpaceEntry userId={mockUser}/>);});}
beforeEach(()=>{jest.clearAllMocks();mockActive=true;mockUser='alice';mockRefresh.mockResolvedValue(undefined);mockRead.mockReturnValue({data,loading:false,error:null,refresh:mockRefresh});});
afterEach(()=>act(()=>tree?.unmount()));
it('opens the selected existing workspace and rejects retired callbacks',()=>{mount();const press=button('Your community: Sunday Table').props.onPress;act(()=>press());expect(mockPush).toHaveBeenCalledWith('/creator/page?id=one');mockPush.mockClear();mockActive=false;act(()=>press());expect(mockPush).not.toHaveBeenCalled();});
it('provides an exact pending invitation entry alongside the community',()=>{mockRead.mockReturnValue({data:{...data,invitations:[{pageId:'team',invitationId:'invite'}]}});mount();act(()=>button('Review invitation').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=team&invitationId=invite');expect(button('Your community: Sunday Table')).toBeDefined();});
it('uses the chooser during loading rather than a speculative workspace',()=>{mockRead.mockReturnValue({loading:true});mount();act(()=>button('Creator space').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/pages');});
it('does not show stale personalized details after a read failure and offers recovery',()=>{mockRead.mockReturnValue({data,error:'Offline',refresh:mockRefresh});mount();expect(button('Your community: Sunday Table')).toBeUndefined();act(()=>button('Try again to load creator space').props.onPress());expect(mockRefresh).toHaveBeenCalledTimes(1);act(()=>button('Creator space').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/pages');});
it('does not borrow a previous account’s scope while the observer catches up',()=>{mockUser='bob';mockRead.mockReturnValue({loading:true});mount();expect(mockRead.mock.calls[0][0]).toBeNull();expect(button('Creator space').props.disabled).toBe(true);act(()=>button('Creator space').props.onPress());expect(mockPush).not.toHaveBeenCalled();});

it('remeasures Creator space title and subtitle without replacing its route, entry or read scope',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try {
  mount();const entry=tree.root.findByType(CreatorSpaceEntry);const open=button('Your community: Sunday Table');const reads=mockRead.mock.calls.length;
  const leaf=(value:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===value)!;
  let title=leaf('Your community'),subtitle=leaf('Sunday Table');
  for(const fontScale of [1.35,1]) {act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));expect(leaf('Your community')).not.toBe(title);expect(leaf('Sunday Table')).not.toBe(subtitle);expect(tree.root.findByType(CreatorSpaceEntry)).toBe(entry);expect(button('Your community: Sunday Table')).toBe(open);expect(mockRead).toHaveBeenCalledTimes(reads);title=leaf('Your community');subtitle=leaf('Sunday Table');}
  act(()=>open.props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page?id=one');
 } finally {act(()=>Dimensions.set({window:previous}));}
});
