import React from 'react';
import { act, create } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { LegacyCommunityRoomDirectory } from '../LegacyCommunityRoomDirectory';
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'regular',semibold:'semibold'}})}));
it('labels recovery separately, checks even when a stale joined card is cached, and keeps Main separate',()=>{
 const join=jest.fn(),open=jest.fn(),main=jest.fn();let tree:any;
 act(()=>{tree=create(<LegacyCommunityRoomDirectory rooms={[{id:'topic',name:'Coffee',joined:true}]} joiningTopicId={null} checkingTopicIds={['topic']} onJoinTopic={join} onOpenTopic={open} onOpenMain={main}/>)});
 const buttons=tree.root.findAllByType(TouchableOpacity);
 act(()=>buttons.find((n:any)=>n.props.accessibilityLabel==='Check Coffee membership').props.onPress());
 expect(join).toHaveBeenCalledWith('topic');expect(open).not.toHaveBeenCalled();
 act(()=>buttons.find((n:any)=>n.props.accessibilityLabel==='Open Community chat').props.onPress());expect(main).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
it('disables only the working room and gives its read-only check a distinct busy label',()=>{
 let tree:any;act(()=>{tree=create(<LegacyCommunityRoomDirectory rooms={[{id:'topic',name:'Coffee',joined:false}]} joiningTopicId="topic" checkingTopicIds={['topic']} onJoinTopic={jest.fn()} onOpenTopic={jest.fn()} onOpenMain={jest.fn()}/>)});
 const button=tree.root.findAllByType(TouchableOpacity).find((n:any)=>n.props.accessibilityLabel==='Checking Coffee');expect(button.props.disabled).toBe(true);expect(button.props.accessibilityState.busy).toBe(true);act(()=>tree.unmount());
});
