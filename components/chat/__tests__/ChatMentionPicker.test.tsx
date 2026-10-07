import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Text, TouchableOpacity } from 'react-native';
import { ChatMentionPicker } from '../ChatMentionPicker';
import { AfterglowFonts } from '../../../constants/Typography';

let tree:ReactTestRenderer;
afterEach(()=>act(()=>tree?.unmount()));
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
const hasText=(text:string)=>tree.root.findAllByType(Text).some(n=>n.props.children===text);
const defaults=()=>({members:[],fonts:AfterglowFonts,onSelect:jest.fn(),onClose:jest.fn(),onRetry:jest.fn()});

it('distinguishes loading, unavailable and no matching members',()=>{
  const props=defaults();
  act(()=>{tree=create(<ChatMentionPicker {...props} loading/>);});
  expect(hasText('Loading people…')).toBe(true);
  expect(hasText('No matching people in this chat.')).toBe(false);
  act(()=>tree.update(<ChatMentionPicker {...props} error/>));
  expect(hasText('The member list couldn’t load.')).toBe(true);
  act(()=>button('Retry chat members').props.onPress());
  expect(props.onRetry).toHaveBeenCalledTimes(1);
  act(()=>tree.update(<ChatMentionPicker {...props}/>));
  expect(hasText('No matching people in this chat.')).toBe(true);
});

it('keeps cached members selectable when refreshing fails',()=>{
  const props=defaults(), members=[{id:'mary',first_name:'Mary Jane'}];
  act(()=>{tree=create(<ChatMentionPicker {...props} members={members} error/>);});
  expect(hasText('The member list couldn’t refresh.')).toBe(true);
  act(()=>button('Mention Mary Jane').props.onPress());
  expect(props.onSelect).toHaveBeenCalledWith(members[0]);
  act(()=>button('Close mentions').props.onPress());
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('supplies every member to the scrollable list and permits selecting past the old six-person cap',()=>{
  const props=defaults(), members=Array.from({length:45},(_,i)=>({id:String(i),first_name:`Friend${i}`}));
  act(()=>{tree=create(<ChatMentionPicker {...props} members={members}/>);});
  expect(tree.root.findByType(FlatList).props.data).toHaveLength(45);
  act(()=>button('Mention Friend8').props.onPress());
  expect(props.onSelect).toHaveBeenCalledWith(members[8]);
});
