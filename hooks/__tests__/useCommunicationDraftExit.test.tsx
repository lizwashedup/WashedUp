import React from 'react';
import {Alert} from 'react-native';
import {act,create} from 'react-test-renderer';
const mockPrevent=jest.fn(),mockDispatch=jest.fn();
jest.mock('@react-navigation/native',()=>({useNavigation:()=>({dispatch:mockDispatch}),usePreventRemove:(...args:any[])=>mockPrevent(...args)}));
import {useCommunicationDraftExit} from '../useCommunicationDraftExit';
const scope={userId:'owner',isCurrent:()=>true};const draft={loaded:true,saving:false,readError:false,error:'disk',save:jest.fn()};
function Screen(){useCommunicationDraftExit(scope,draft);return null;}
let tree:any;
beforeEach(()=>{jest.clearAllMocks();scope.isCurrent=()=>true;draft.error='disk';draft.save.mockResolvedValue(true);jest.spyOn(Alert,'alert').mockImplementation(()=>{});});
afterEach(()=>{act(()=>tree.unmount());jest.restoreAllMocks();});
function back(){act(()=>{tree=create(<Screen/>);});const [blocked,callback]=mockPrevent.mock.calls.at(-1);expect(blocked).toBe(true);act(()=>callback({data:{action:{type:'GO_BACK'}}}));return (Alert.alert as jest.Mock).mock.calls[0][2];}
it('keeps a failed draft when save-and-leave fails again',async()=>{draft.save.mockResolvedValue(false);const buttons=back();await act(async()=>buttons.find((b:any)=>b.text==='Save and leave').onPress());expect(mockDispatch).not.toHaveBeenCalled();});
it('only leaves after a confirmed save or explicit discard',async()=>{const buttons=back();await act(async()=>buttons.find((b:any)=>b.text==='Save and leave').onPress());expect(mockDispatch).toHaveBeenCalledWith({type:'GO_BACK'});});
it('a retired confirmation cannot navigate the new account',async()=>{const buttons=back();scope.isCurrent=()=>false;await act(async()=>buttons.find((b:any)=>b.text==='Leave without saving').onPress());expect(mockDispatch).not.toHaveBeenCalled();});
