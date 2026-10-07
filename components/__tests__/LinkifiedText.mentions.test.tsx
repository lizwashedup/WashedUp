import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import LinkifiedText from '../LinkifiedText';
import { openUrl } from '../../lib/url';
import { addChatMentionReference } from '../../lib/chatMentionIdentity';

jest.mock('../../lib/url',()=>({...jest.requireActual('../../lib/url'),openUrl:jest.fn()}));
let tree:ReactTestRenderer;
afterEach(()=>act(()=>tree?.unmount()));

it('highlights a compound name without converting the same name in a URL into a mention',()=>{
  const url='https://example.test/@Mary?destination=some-long-destination-path';
  act(()=>{tree=create(<LinkifiedText text={`@Mary Jane, see ${url}`} mentionNames={new Set(['Mary Jane','Mary'])} fullUrls/>);});
  const texts=tree.root.findAllByType(Text);
  expect(texts.filter(n=>n.props.children==='@Mary Jane')).toHaveLength(1);
  expect(texts.filter(n=>n.props.children==='@Mary')).toHaveLength(0);
  const link=texts.find(n=>typeof n.props.onPress==='function')!;
  expect(link.props.children).toBe(url);
  act(()=>link.props.onPress());expect(openUrl).toHaveBeenCalledWith(url);
});

it('retains compact link presentation for existing non-chat callers',()=>{
  const url='https://example.test/a-long-destination-that-still-opens-in-full';
  act(()=>{tree=create(<LinkifiedText text={url}/>);});
  const link=tree.root.findAllByType(Text).find(n=>typeof n.props.onPress==='function')!;
  expect(link.props.children).toBe(`${url.slice(0,42)}…`);
  act(()=>link.props.onPress());expect(openUrl).toHaveBeenCalledWith(url);
});

it('opens the exact selected identity for identical names and does not trigger the enclosing message',()=>{
  const text='@Alex and @Alex';
  const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const document=addChatMentionReference(text,addChatMentionReference(text,null,first,'Alex',0),second,'Alex',10);
  const onMentionPress=jest.fn(),stopPropagation=jest.fn();
  act(()=>{tree=create(<LinkifiedText text={text} mentionDocument={document} onMentionPress={onMentionPress}/>);});
  const links=tree.root.findAllByType(Text).filter(n=>n.props.accessibilityRole==='link');
  expect(links).toHaveLength(2);
  act(()=>links[1].props.onPress({stopPropagation}));
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(onMentionPress).toHaveBeenCalledWith(second);
});

it('does not infer a person when authoritative metadata is invalid or has been cleared',()=>{
  const text='@Alex hello',onMentionPress=jest.fn();
  const document=addChatMentionReference(text,null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alex',0);
  act(()=>{tree=create(<LinkifiedText text="@Alex changed" mentionNames={new Set(['Alex'])} mentionDocument={document} onMentionPress={onMentionPress}/>);});
  expect(tree.root.findAllByType(Text).filter(n=>n.props.onPress)).toHaveLength(0);
  act(()=>tree.update(<LinkifiedText text={text} mentionNames={new Set(['Alex'])} mentionDocument={null} onMentionPress={onMentionPress}/>));
  expect(tree.root.findAllByType(Text).filter(n=>n.props.onPress)).toHaveLength(0);
});
