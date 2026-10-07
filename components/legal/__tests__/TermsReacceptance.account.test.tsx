import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TermsReacceptance } from '../TermsReacceptance';
const mockStatus=jest.fn(),mockAccept=jest.fn();
let mockLive='juniper:1';
const snapshot=(id:string|undefined,epoch:number)=>({viewerId:id,epoch,error:null,isLoading:false,retry:jest.fn(async()=>{}),isCurrent:()=>mockLive===`${id}:${epoch}`});
let mockAccount=snapshot('juniper',1);
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>mockAccount}));
jest.mock('../../../lib/participationTerms',()=>({getMemberTermsStatus:()=>mockStatus(),recordMemberTermsAcceptance:()=>mockAccept()}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
let tree:ReactTestRenderer,client:QueryClient;
const view=(enabled=true)=><QueryClientProvider client={client}><TermsReacceptance enabled={enabled}/></QueryClientProvider>;
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
async function mount(){await act(async()=>{tree=create(view());});await flush();}
async function change(id:string|undefined,epoch:number,enabled=!!id){mockLive=`${id}:${epoch}`;mockAccount=snapshot(id,epoch);await act(async()=>{tree.update(view(enabled));});await flush();}
const visible=()=>tree.root.findAllByType(Modal).some(n=>n.props.visible);
const accept=()=>tree.root.findAllByType(TouchableOpacity).at(-1)!;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
beforeEach(()=>{mockLive='juniper:1';mockAccount=snapshot('juniper',1);mockStatus.mockReset();mockAccept.mockReset();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{act(()=>tree?.unmount());client.clear();});
it('reads Cedar independently after warm logout/login even when Juniper cached no acceptance',async()=>{
 mockStatus.mockResolvedValueOnce({needsAcceptance:false}).mockResolvedValue({needsAcceptance:true});await mount();expect(visible()).toBe(false);
 await change(undefined,2,false);await change('cedar',3);expect(mockStatus).toHaveBeenCalledTimes(2);expect(visible()).toBe(true);expect(mockAccept).not.toHaveBeenCalled();
});
it('does not use a pending former-account status for the newly signed-in account',async()=>{
 const old=deferred<{needsAcceptance:boolean}>();mockStatus.mockReturnValueOnce(old.promise).mockResolvedValue({needsAcceptance:true});await mount();
 await change('cedar',2);expect(visible()).toBe(true);expect(mockStatus).toHaveBeenCalledTimes(2);
 await act(async()=>old.resolve({needsAcceptance:false}));await flush();expect(visible()).toBe(true);expect(mockAccept).not.toHaveBeenCalled();
});
it('starts a fresh status read on account ABA and ignores the first visit late response',async()=>{
 const old=deferred<{needsAcceptance:boolean}>();mockStatus.mockReturnValueOnce(old.promise).mockResolvedValueOnce({needsAcceptance:false}).mockResolvedValue({needsAcceptance:true});await mount();
 await change('cedar',2);await change('juniper',3);expect(mockStatus).toHaveBeenCalledTimes(3);expect(visible()).toBe(true);
 await act(async()=>old.resolve({needsAcceptance:false}));await flush();expect(visible()).toBe(true);
});
it('late old acceptance cannot hide or keep the new account busy',async()=>{
 const old=deferred<boolean>();mockStatus.mockResolvedValue({needsAcceptance:true});mockAccept.mockReturnValueOnce(old.promise);await mount();
 act(()=>{void accept().props.onPress();});await change('cedar',2);expect(visible()).toBe(true);expect(accept().props.disabled).toBe(false);
 await act(async()=>old.resolve(true));await flush();expect(visible()).toBe(true);expect(accept().props.disabled).toBe(false);expect(mockAccept).toHaveBeenCalledTimes(1);
});
it('a retained affirmative action retires immediately when the observer account changes before rerender',async()=>{
 mockStatus.mockResolvedValue({needsAcceptance:true});await mount();const old=accept().props.onPress;mockLive='cedar:2';await act(async()=>old());expect(mockAccept).not.toHaveBeenCalled();
});
it('local acceptance never carries from one account to another',async()=>{
 mockStatus.mockResolvedValue({needsAcceptance:true});mockAccept.mockResolvedValue(true);await mount();await act(async()=>accept().props.onPress());await flush();expect(visible()).toBe(false);
 await change('cedar',2);expect(visible()).toBe(true);expect(mockAccept).toHaveBeenCalledTimes(1);
});
it('records only one explicit acceptance while pending and keeps the confirmed normal flow',async()=>{
 const pending=deferred<boolean>();mockStatus.mockResolvedValue({needsAcceptance:true});mockAccept.mockReturnValue(pending.promise);await mount();expect(mockAccept).not.toHaveBeenCalled();const press=accept().props.onPress;
 act(()=>{void press();void press();});expect(mockAccept).toHaveBeenCalledTimes(1);expect(accept().props.disabled).toBe(true);
 await act(async()=>pending.resolve(true));await flush();expect(visible()).toBe(false);
});
it('preserves the no-interstitial result from the existing failed-read policy',async()=>{
 mockStatus.mockResolvedValue({needsAcceptance:false});await mount();expect(visible()).toBe(false);expect(mockAccept).not.toHaveBeenCalled();
});
it('an old acceptance response cannot hide a later visit to the same account after ABA',async()=>{
 const old=deferred<boolean>();mockStatus.mockResolvedValue({needsAcceptance:true});mockAccept.mockReturnValueOnce(old.promise);await mount();act(()=>{void accept().props.onPress();});
 await change('cedar',2);await change('juniper',3);expect(visible()).toBe(true);
 await act(async()=>old.resolve(true));await flush();expect(visible()).toBe(true);expect(accept().props.disabled).toBe(false);
});
it('a retired acceptance completion cannot unlock the new account pending acceptance',async()=>{
 const old=deferred<boolean>(),next=deferred<boolean>();mockStatus.mockResolvedValue({needsAcceptance:true});mockAccept.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);await mount();act(()=>{void accept().props.onPress();});
 await change('cedar',2);const press=accept().props.onPress;act(()=>{void press();});expect(mockAccept).toHaveBeenCalledTimes(2);
 await act(async()=>old.resolve(true));expect(visible()).toBe(true);expect(accept().props.disabled).toBe(true);act(()=>{void press();});expect(mockAccept).toHaveBeenCalledTimes(2);
 await act(async()=>next.resolve(false));expect(visible()).toBe(true);expect(accept().props.disabled).toBe(false);expect(JSON.stringify(tree.toJSON())).toContain('that did not go through');
});
