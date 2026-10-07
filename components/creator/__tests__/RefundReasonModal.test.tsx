import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Modal,TextInput,TouchableOpacity} from 'react-native';
import {RefundReasonModal} from '../RefundReasonModal';
let tree:ReactTestRenderer;
const submit=jest.fn(),cancel=jest.fn();
const props={visible:true,amountLabel:'$24.00',scopeLabel:'Juniper’s seat',submitting:false,onSubmit:submit,onCancel:cancel};
const button=()=>tree.root.findAllByType(TouchableOpacity).find(x=>x.props.accessibilityLabel==='Confirm refund')!;
async function mount(){await act(async()=>{tree=create(<RefundReasonModal {...props}/>);});act(()=>tree.root.findByType(TextInput).props.onChangeText('Duplicate purchase'));}
beforeEach(()=>{jest.clearAllMocks();submit.mockResolvedValue(false);});afterEach(()=>act(()=>tree?.unmount()));
it('retains the reason after an unsuccessful submission',async()=>{await mount();await act(async()=>button().props.onPress());expect(tree.root.findByType(TextInput).props.value).toBe('Duplicate purchase');expect(cancel).not.toHaveBeenCalled();});
it('locks immediate repeat taps and OS dismissal until the receipt resolves',async()=>{let resolve!:(v:boolean)=>void;submit.mockReturnValue(new Promise<boolean>(r=>{resolve=r;}));await mount();act(()=>{button().props.onPress();button().props.onPress();tree.root.findByType(Modal).props.onRequestClose();});expect(submit).toHaveBeenCalledTimes(1);expect(cancel).not.toHaveBeenCalled();await act(async()=>resolve(false));expect(tree.root.findByType(TextInput).props.value).toBe('Duplicate purchase');});
it('clears only after confirmed success',async()=>{submit.mockResolvedValue(true);await mount();await act(async()=>button().props.onPress());expect(tree.root.findByType(TextInput).props.value).toBe('');});
it('shows recovery and prevents input and cancellation during submission',async()=>{await mount();act(()=>tree.update(<RefundReasonModal {...props} submitting problem="Checking the purchase"/>));expect(tree.root.findByType(TextInput).props.editable).toBe(false);act(()=>tree.root.findByType(Modal).props.onRequestClose());expect(cancel).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Checking the purchase');});
