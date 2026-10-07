import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockLoad=jest.fn(),mockSave=jest.fn();let mockScope:any,mockCurrent=true;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{}})}));
jest.mock('../../../lib/eventSaleAlerts',()=>({saleAlertStatus:jest.requireActual('../../../lib/eventSaleAlerts').saleAlertStatus,loadSaleAlertPreference:(...a:unknown[])=>mockLoad(...a),saveSaleAlertPreference:(...a:unknown[])=>mockSave(...a),SaleAlertAccessDenied:class extends Error{}}));
import {SaleAlertAccessDenied} from '../../../lib/eventSaleAlerts';
import {EventSaleAlertPreference} from '../EventSaleAlertPreference';
let tree:ReactTestRenderer;const saved={eventId:'event',userId:'creator',enabled:false,revision:null,updatedAt:null,deliveryReady:false};
const render=()=> <EventSaleAlertPreference eventId="event"/>;
const control=()=>tree.root.findAll(x=>x.props.accessibilityLabel==='Email me for each ticket sale'&&typeof x.props.onValueChange==='function')[0];
const check=()=>tree.root.findAll(x=>x.props.accessibilityLabel==='Check sale alert status'&&typeof x.props.onPress==='function')[0].props.onPress();
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockScope={userId:'creator',isCurrent:()=>mockCurrent};mockLoad.mockResolvedValue(saved);mockSave.mockImplementation(async(s:any,enabled:boolean)=>({...s,enabled,revision:'saved'}));});
afterEach(()=>act(()=>tree?.unmount()));
it('requires an explicit personal choice and preserves buyer confirmation explanation',async()=>{
 await act(async()=>{tree=create(render());});expect(mockSave).not.toHaveBeenCalled();expect(control().props.value).toBe(false);
 await act(async()=>control().props.onValueChange(true));expect(mockSave).toHaveBeenCalledWith(saved,true,mockScope);expect(control().props.value).toBe(true);
 expect(JSON.stringify(tree.toJSON())).toContain('Buyer confirmations stay on');expect(JSON.stringify(tree.toJSON())).toContain('Sale emails are not active yet');
});
it('read failure is recoverable without showing a fabricated default',async()=>{
 mockLoad.mockRejectedValueOnce(Error('Offline'));await act(async()=>{tree=create(render());});expect(control()).toBeUndefined();await act(async()=>check());expect(control().props.value).toBe(false);
});
it('lost save acknowledgement disables another change until read recovery',async()=>{
 await act(async()=>{tree=create(render());});mockSave.mockRejectedValueOnce(Error('Lost'));await act(async()=>control().props.onValueChange(true));expect(control().props.disabled).toBe(true);
 mockLoad.mockResolvedValue({...saved,enabled:true,revision:'saved'});await act(async()=>check());expect(control().props.value).toBe(true);expect(mockSave).toHaveBeenCalledTimes(1);
});
it('guards repeated callbacks during a pending save',async()=>{
 await act(async()=>{tree=create(render());});let resolve:any;mockSave.mockImplementationOnce(()=>new Promise(r=>resolve=r));const toggle=control().props.onValueChange;act(()=>{toggle(true);toggle(true);});expect(mockSave).toHaveBeenCalledTimes(1);await act(async()=>resolve({...saved,enabled:true,revision:'saved'}));
});
it('revoked access hides the previously available personal control',async()=>{
 await act(async()=>{tree=create(render());});mockSave.mockRejectedValueOnce(new SaleAlertAccessDenied());await act(async()=>control().props.onValueChange(true));expect(tree.toJSON()).toBeNull();
});
it('late saves never populate a different account',async()=>{
 await act(async()=>{tree=create(render());});let resolve:any;mockSave.mockImplementationOnce(()=>new Promise(r=>resolve=r));act(()=>control().props.onValueChange(true));mockCurrent=false;mockScope={userId:'other',isCurrent:()=>true};mockLoad.mockResolvedValue({...saved,userId:'other'});await act(async()=>{tree.update(render());resolve({...saved,enabled:true,revision:'saved'});});expect(control().props.value).toBe(false);
});

it('keeps a saved choice without claiming delivery to an unverified email',async()=>{
 mockLoad.mockResolvedValue({...saved,enabled:true,emailVerified:false});await act(async()=>{tree=create(render());});
 expect(control().props.value).toBe(true);expect(JSON.stringify(tree.toJSON())).toContain('verified account email');
 expect(JSON.stringify(tree.toJSON())).not.toContain('Sale emails are on for your account.');
 mockLoad.mockResolvedValue({...saved,enabled:true,emailVerified:true,deliveryReady:true});
 const refresh=tree.root.findAll(x=>x.props.accessibilityLabel==='Refresh sale alert status'&&typeof x.props.onPress==='function')[0];
 await act(async()=>refresh.props.onPress());expect(JSON.stringify(tree.toJSON())).toContain('Sale emails are on for your account.');expect(mockSave).not.toHaveBeenCalled();
});
