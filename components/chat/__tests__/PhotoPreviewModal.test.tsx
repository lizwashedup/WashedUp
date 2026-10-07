import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ScrollView,TextInput,View,StyleSheet} from 'react-native';
import PhotoPreviewModal from '../PhotoPreviewModal';
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider: require('react-native').View, SafeAreaView:require('react-native').View}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
let tree:ReactTestRenderer;
afterEach(()=>act(()=>tree?.unmount()));
it('gives the photo page the measured available height and keeps original uncertain caption readable',()=>{
 const send=jest.fn();const props={visible:true,assets:[{uri:'file:///photo.jpg'}],sending:false,initialCaption:'Original caption',onSend:send,onCancel:jest.fn()};
 act(()=>{tree=create(<PhotoPreviewModal {...props}/>);});
 const pager=tree.root.findByType(ScrollView);act(()=>pager.props.onLayout({nativeEvent:{layout:{height:460,width:320}}}));
 const page=tree.root.findAllByType(View).find(n=>StyleSheet.flatten(n.props.style)?.height===460);
 expect(page).toBeDefined();expect(tree.root.findByType(TextInput).props.editable).toBe(true);
 act(()=>tree.update(<PhotoPreviewModal {...props} captionLocked errorMessage="Delivery isn’t confirmed."/>));
 expect(tree.root.findByType(TextInput).props).toMatchObject({value:'Original caption',editable:false});
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry photos'&&typeof n.props.onPress==='function')[0];act(()=>retry.props.onPress());expect(send).toHaveBeenCalledWith('Original caption');
});

it('allows choosing each photo while preserving the shared caption',()=>{
 const props={visible:true,assets:[{uri:'file:///first.jpg'},{uri:'file:///second.jpg'}],sending:false,initialCaption:'Together',onSend:jest.fn(),onCancel:jest.fn()};
 act(()=>{tree=create(<PhotoPreviewModal {...props}/>);});
 const pick=()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Preview photo 2 of 2'&&typeof n.props.onPress==='function')[0];
 expect(pick().props.accessibilityState.selected).toBe(false);act(()=>pick().props.onPress());
 expect(pick().props.accessibilityState.selected).toBe(true);expect(tree.root.findByType(TextInput).props.value).toBe('Together');
 act(()=>tree.update(<PhotoPreviewModal {...props} assets={[props.assets[0]]}/>));
 expect(JSON.stringify(tree.toJSON())).toContain('1 photo');expect(tree.root.findByType(TextInput).props.value).toBe('Together');
});
