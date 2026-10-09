// Profile header owns its query provider; this suite exercises the surrounding journey.
jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { act, create } from 'react-test-renderer';
import Screen from '../../../app/community-rooms/[id]';
import { CommunityRoomDirectory } from '../CommunityRoomDirectory';
import { ChatContextHeader } from '../../chat/ChatContextHeader';
const mockPush=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn();let mockCanGoBack=true;
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'page'}),useRouter:()=>({push:mockPush,back:mockBack,replace:mockReplace,canGoBack:()=>mockCanGoBack}),useFocusEffect:(cb:any)=>require('react').useEffect(cb,[cb]),Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true,COMMUNITY_CHAT_GROUPING_ENABLED:true}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:jest.requireActual('../../../constants/Typography').AfterglowFonts})}));
jest.mock('../CommunityRoomDirectory',()=>({CommunityRoomDirectory:()=>null}));
beforeEach(()=>{jest.clearAllMocks();mockCanGoBack=true;});
it('opens the original broadcast or topic identity from the focused group directory',()=>{let tree:any;act(()=>{tree=create(<Screen/>);});const directory=tree.root.findByType(CommunityRoomDirectory);expect(directory.props.enabled).toBe(true);act(()=>directory.props.onOpen({id:'page',storage:'broadcast'}));expect(mockPush).toHaveBeenLastCalledWith('/community-thread/page');act(()=>directory.props.onOpen({id:'topic',storage:'topic'}));expect(mockPush).toHaveBeenLastCalledWith('/community-topic/topic');act(()=>tree.unmount());});
it('returns through the existing navigation history with a Chats fallback for cold entry',()=>{let tree:any;act(()=>{tree=create(<Screen/>);});const header=tree.root.findByType(ChatContextHeader);act(()=>header.props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);mockCanGoBack=false;act(()=>header.props.onBack());expect(mockReplace).toHaveBeenCalledWith('/(tabs)/chats');act(()=>header.props.onViewContext());expect(mockPush).toHaveBeenCalledWith('/community/page');act(()=>tree.unmount());});
