import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRead=jest.fn(),mockSave=jest.fn();let mockScope:any,mockAccount:any,mockCurrent=true;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../../lib/eventMessagePreference',()=>({readEventMessagePreference:(...a:unknown[])=>mockRead(...a),saveEventMessagePreference:(...a:unknown[])=>mockSave(...a)}));
import {EventMessagePreference} from '../EventMessagePreference';
let tree:ReactTestRenderer;
const render=()=> <EventMessagePreference eventId="event" />;
const press=(label:string)=>tree.root.findAll(x=>x.props.accessibilityLabel===label&&typeof x.props.onPress==='function')[0].props.onPress();
const has=(label:string)=>tree.root.findAll(x=>x.props.accessibilityLabel===label).length>0;
const shows=(value:string)=>tree.root.findAll(x=>x.props.children===value).length>0;
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockScope={userId:'member',isCurrent:()=>mockCurrent};mockAccount={};mockRead.mockResolvedValue(false);mockSave.mockResolvedValue(undefined);});
afterEach(()=>{if(tree)act(()=>tree.unmount());});
it('reads the saved preference, explicitly mutes and restores only this event',async()=>{
 await act(async()=>{tree=create(render());});expect(mockRead).toHaveBeenCalledWith('event',mockScope);
 await act(async()=>press('Mute updates'));expect(mockSave).toHaveBeenLastCalledWith('event',true,mockScope);expect(has('Allow updates')).toBe(true);
 await act(async()=>press('Allow updates'));expect(mockSave).toHaveBeenLastCalledWith('event',false,mockScope);expect(has('Mute updates')).toBe(true);
});
it('unknown reads do not assume allowed and expose only status recovery',async()=>{
 mockRead.mockRejectedValueOnce(Error('Offline'));await act(async()=>{tree=create(render());});
 expect(has('Mute updates')).toBe(false);expect(has('Check status')).toBe(true);expect(mockSave).not.toHaveBeenCalled();
 mockRead.mockResolvedValue(true);await act(async()=>press('Check status'));expect(has('Allow updates')).toBe(true);
});
it('lost save acknowledgement recovers through read without repeating the write',async()=>{
 await act(async()=>{tree=create(render());});mockSave.mockRejectedValueOnce(Error('Lost response'));
 await act(async()=>press('Mute updates'));expect(has('Check status')).toBe(true);expect(has('Mute updates')).toBe(false);
 mockRead.mockResolvedValue(true);await act(async()=>press('Check status'));expect(mockSave).toHaveBeenCalledTimes(1);expect(has('Allow updates')).toBe(true);
});
it('locks repeated taps before a pending save resolves',async()=>{
 await act(async()=>{tree=create(render());});let resolve:any;mockSave.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const button=tree.root.findAll(x=>x.props.accessibilityLabel==='Mute updates'&&typeof x.props.onPress==='function')[0].props.onPress;
 act(()=>{button();button();});expect(mockSave).toHaveBeenCalledTimes(1);await act(async()=>resolve());
});
it('retired account callbacks cannot write or apply a late read',async()=>{
 let resolve:any;mockRead.mockImplementationOnce(()=>new Promise(r=>resolve=r));await act(async()=>{tree=create(render());});
 mockCurrent=false;mockScope=null;await act(async()=>{tree.update(render());resolve(true);});expect(tree.toJSON()).toBeNull();expect(mockSave).not.toHaveBeenCalled();
});
it('keeps essential notice exception visible without claiming delivery',async()=>{
 await act(async()=>{tree=create(render());});expect(shows('Essential cancellation, venue and time changes aren’t muted.')).toBe(true);
});

it('late saved preference never crosses to a different account',async()=>{
 await act(async()=>{tree=create(render());});let resolve:any;mockSave.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 act(()=>press('Mute updates'));mockCurrent=false;mockScope={userId:'other',isCurrent:()=>true};mockRead.mockResolvedValue(false);
 await act(async()=>{tree.update(render());resolve();});expect(has('Mute updates')).toBe(true);expect(has('Allow updates')).toBe(false);
});
