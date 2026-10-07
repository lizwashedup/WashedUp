import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {useEventRsvpRecovery} from '../useEventRsvpRecovery';
import {changeRsvpWithRecovery,checkRsvpRecovery} from '../../lib/eventRsvpRecovery';
jest.mock('../../lib/eventRsvpRecovery',()=>({changeRsvpWithRecovery:jest.fn(),checkRsvpRecovery:jest.fn()}));
let state:ReturnType<typeof useEventRsvpRecovery>,tree:ReactTestRenderer,active=true;
let owner={userId:'member',isCurrent:()=>active};const confirmed=jest.fn(),settled=jest.fn();
function View(){state=useEventRsvpRecovery('event',owner,confirmed,settled);return null;}
beforeEach(()=>{jest.clearAllMocks();active=true;owner={userId:'member',isCurrent:()=>active};jest.mocked(checkRsvpRecovery).mockResolvedValue({kind:'ready'});});
afterEach(()=>act(()=>tree?.unmount()));
const mount=async()=>{await act(async()=>{tree=create(<View/>);});};
it('recovers on return without dispatching and keeps unresolved actions blocked',async()=>{
 jest.mocked(checkRsvpRecovery).mockResolvedValue({kind:'unknown',attempt:{} as any});await mount();expect(state.blocked).toBe(true);expect(changeRsvpWithRecovery).not.toHaveBeenCalled();
 jest.mocked(checkRsvpRecovery).mockResolvedValue({kind:'confirmed',status:'going'});await act(async()=>{await state.check();});expect(state.blocked).toBe(false);expect(confirmed).toHaveBeenCalledTimes(1);
});
it('prevents rapid duplicate actions and ignores retired-view callbacks',async()=>{
 await mount();let finish:any;jest.mocked(changeRsvpWithRecovery).mockImplementation(()=>new Promise(r=>{finish=r;}));
 let pending:any;act(()=>{pending=state.change(true);void state.change(true);});expect(changeRsvpWithRecovery).toHaveBeenCalledTimes(1);active=false;
 await act(async()=>{finish({kind:'confirmed',status:'going'});await pending;});expect(confirmed).not.toHaveBeenCalled();
});
it('keeps failures recoverable without claiming attendance',async()=>{
 await mount();jest.mocked(changeRsvpWithRecovery).mockRejectedValue(Error('Your attendance change was not accepted. Try again.'));await act(async()=>{await state.change(false);});expect(state.phase).toBe('error');expect(state.blocked).toBe(true);expect(confirmed).not.toHaveBeenCalled();
 await act(async()=>{await state.check();});expect(state.phase).toBe('ready');
});

it('refreshes current attendance after settlement without celebrating an unconfirmed change',async()=>{
 jest.mocked(checkRsvpRecovery).mockResolvedValue({kind:'settled',status:'going'});await mount();expect(state.blocked).toBe(false);expect(settled).toHaveBeenCalledTimes(1);expect(confirmed).not.toHaveBeenCalled();expect(changeRsvpWithRecovery).not.toHaveBeenCalled();
});
