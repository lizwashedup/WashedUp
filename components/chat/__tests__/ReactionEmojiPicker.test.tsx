import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactionEmojiPicker from '../ReactionEmojiPicker';
import { FlashList } from '@shopify/flash-list';
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('@shopify/flash-list',()=>({FlashList:({data,renderItem}:any)=>{const React=require('react');const {View}=require('react-native');return <View>{data.map((item:any,index:number)=><React.Fragment key={item}>{renderItem({item,index})}</React.Fragment>)}</View>;}}));
let tree:ReactTestRenderer;
const pick=jest.fn(),close=jest.fn();
const props={visible:true,onSelect:pick,onClose:close};
const button=(name:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===name && typeof node.props.onPress==='function')[0]!;
const input=()=>tree.root.findByType(TextInput);
async function mount(){await act(async()=>{tree=create(<ReactionEmojiPicker {...props}/>);});}
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();});
afterEach(()=>{act(()=>tree?.unmount());jest.restoreAllMocks();});
it('searches descriptive names and only dispatches a chosen reaction once per opening',async()=>{
 await mount();act(()=>input().props.onChangeText('thumbs up'));
 const choose=button('React with thumbs up').props.onPress;act(()=>{choose();choose();});
 expect(pick).toHaveBeenCalledTimes(1);expect(pick).toHaveBeenCalledWith('👍');
 expect(JSON.parse((await AsyncStorage.getItem('chat_emoji_recents'))!)).toEqual(['👍']);
});
it('ignores a saved callback after the picker closes and permits another selection when reopened',async()=>{
 await mount();const choose=button('React with grinning face').props.onPress;
 await act(async()=>tree.update(<ReactionEmojiPicker {...props} visible={false}/>));act(()=>choose());expect(pick).not.toHaveBeenCalled();
 await act(async()=>tree.update(<ReactionEmojiPicker {...props}/>));act(()=>button('React with grinning face').props.onPress());expect(pick).toHaveBeenCalledTimes(1);
});
it.each(['{}','null','[false,3,"not-an-emoji","❤️","❤️"]'])('handles malformed or duplicate recents: %s',async value=>{
 await AsyncStorage.setItem('chat_emoji_recents',value);await mount();act(()=>button('recent emoji').props.onPress());
 expect(tree.root.findByType(FlashList).props.data).toEqual(value.startsWith('[')?['❤️']:[]);
});
it('does not let an older recent-history read overwrite a newly selected reaction',async()=>{
 let resolve!:(value:string)=>void;jest.spyOn(AsyncStorage,'getItem').mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
 await mount();act(()=>button('React with grinning face').props.onPress());await act(async()=>resolve('["❤️"]'));
 act(()=>button('recent emoji').props.onPress());expect(tree.root.findByType(FlashList).props.data).toEqual(['😀']);
});
it('offers named search/close controls and scrollable 44-point selected categories',async()=>{
 await mount();expect(input().props.accessibilityLabel).toBe('Search emoji');
 const category=button('smileys emotion emoji');expect(category.props.accessibilityState.selected).toBe(true);expect(StyleSheet.flatten(category.props.style).width).toBeGreaterThanOrEqual(44);
 expect(tree.root.findAllByType(ScrollView).some(node=>node.props.horizontal)).toBe(true);
 const closeButtons=tree.root.findAll(node=>node.props.accessibilityLabel==='Close reactions' && typeof node.props.onPress==='function');act(()=>closeButtons[1].props.onPress());expect(close).toHaveBeenCalledTimes(1);
 expect(tree.root.findByType(Modal).props.onRequestClose).toEqual(expect.any(Function));
});

it('retires selection immediately when Close is pressed',async()=>{
 await mount();const choose=button('React with grinning face').props.onPress;
 act(()=>{button('Close reactions').props.onPress();choose();});expect(close).toHaveBeenCalledTimes(1);expect(pick).not.toHaveBeenCalled();
});
it('preserves an existing skin-tone reaction in recents',async()=>{
 await AsyncStorage.setItem('chat_emoji_recents','["👍🏽"]');await mount();act(()=>button('recent emoji').props.onPress());
 expect(tree.root.findByType(FlashList).props.data).toEqual(['👍🏽']);act(()=>button('React with thumbs up').props.onPress());expect(pick).toHaveBeenCalledWith('👍🏽');
});
