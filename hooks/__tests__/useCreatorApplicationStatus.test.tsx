import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {useCreatorApplicationStatus} from '../useCreatorApplicationStatus';
const mockRead=jest.fn();let mockAccount='cedar',mockEpoch=1,mockFocused=true,mockError:Error|null=null;
jest.mock('../../lib/operatorApplications',()=>({fetchMyGrants:(...args:any[])=>mockRead(...args)}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('../useObservedUser',()=>({useObservedUser:()=>{const id=mockAccount,epoch=mockEpoch;const isCurrent=require('react').useCallback(()=>mockAccount===id&&mockEpoch===epoch,[id,epoch]);return{viewerId:id,epoch,isLoading:false,error:mockError,retry:async()=>{},isCurrent};}}));
let result:ReturnType<typeof useCreatorApplicationStatus>,tree:ReactTestRenderer;
function Harness(){result=useCreatorApplicationStatus();return null;}
const held=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};};
beforeEach(()=>{jest.clearAllMocks();mockAccount='cedar';mockEpoch=1;mockFocused=true;mockError=null;mockRead.mockResolvedValue([]);});afterEach(()=>act(()=>tree?.unmount()));
it('does not expose the previous account grant while the next read is pending or after a retired receipt',async()=>{
 mockRead.mockResolvedValueOnce([{track:'community_leader',status:'approved'}]);await act(async()=>{tree=create(<Harness/>);});expect(result.grants[0].status).toBe('approved');
 const next=held();mockRead.mockReturnValueOnce(next.promise);mockAccount='other';mockEpoch++;await act(async()=>tree.update(<Harness/>));expect(result.grants).toEqual([]);expect(result.isLoading).toBe(true);
 mockAccount='cedar';mockEpoch++;mockRead.mockResolvedValueOnce([{track:'community_leader',status:'revoked'}]);await act(async()=>tree.update(<Harness/>));await act(async()=>next.resolve([{track:'event_host',status:'approved'}]));expect(result.grants).toEqual([{track:'community_leader',status:'revoked'}]);expect(mockRead.mock.calls.map(c=>c[0])).toEqual(['cedar','other','cedar']);
});
it('refreshes the same account on each focus visit and hides retired status during the check',async()=>{
 mockRead.mockResolvedValueOnce([{status:'applied'}]);await act(async()=>{tree=create(<Harness/>);});mockFocused=false;await act(async()=>tree.update(<Harness/>));expect(result.current()).toBe(false);const next=held();mockRead.mockReturnValueOnce(next.promise);mockFocused=true;await act(async()=>tree.update(<Harness/>));expect(result.grants).toEqual([]);await act(async()=>next.resolve([{status:'approved'}]));expect(result.grants).toEqual([{status:'approved'}]);
});
it('exposes a failed read for explicit recovery without inventing a decision',async()=>{
 mockRead.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([{status:'needs_more_info'}]);await act(async()=>{tree=create(<Harness/>);});expect(result.error).toBe('offline');expect(result.grants).toEqual([]);await act(async()=>{await result.refresh();});expect(result.error).toBeFalsy();expect(result.grants).toEqual([{status:'needs_more_info'}]);
});
it('bounds a stalled status read while retiring its late UI result',async()=>{
 jest.useFakeTimers({doNotFake:['queueMicrotask']});try{const pending=held();mockRead.mockReturnValueOnce(pending.promise);await act(async()=>{tree=create(<Harness/>);});await act(async()=>{jest.advanceTimersByTime(12000);});expect(result.isLoading).toBe(false);expect(result.error).toBeTruthy();await act(async()=>pending.resolve([{status:'approved'}]));expect(result.grants).toEqual([]);}finally{jest.useRealTimers();}
});
