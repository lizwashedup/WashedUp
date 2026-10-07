import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Alert,Text,TouchableOpacity} from 'react-native';
const mockPages=jest.fn(),mockCheckRefund=jest.fn();
const mockOrders=jest.fn(),mockPreview=jest.fn(),mockRefund=jest.fn(),mockNote=jest.fn(),mockProfiles=jest.fn(),mockPush=jest.fn(),mockStash=jest.fn(),mockAccountRetry=jest.fn();
let mockScope:any,mockAccount:any;
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,focused:true,account:mockAccount})}));
jest.mock('expo-router',()=>({router:{push:(...a:any[])=>mockPush(...a),back:jest.fn()}}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getMyOrders:(...a:any[])=>mockOrders(...a),previewRefund:(...a:any[])=>mockPreview(...a),executeRefund:(...a:any[])=>mockRefund(...a),checkRefundAttempt:(...a:any[])=>mockCheckRefund(...a),getConfirmationMessage:(...a:any[])=>mockNote(...a)}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/publishedPageIdentity',()=>({loadPublishedEventPageIdentities:(...a:any[])=>mockPages(...a)}));
jest.mock('../../../lib/organizerProfile',()=>({getOrganizerProfiles:(...a:any[])=>mockProfiles(...a)}));
jest.mock('../../../lib/pendingLink',()=>({stashPendingDestination:(...a:any[])=>mockStash(...a)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('react-native-qrcode-svg',()=>({__esModule:true,default:()=>null}));
import Screen from '../../../app/tickets';
const order={id:'order',event_id:'event',qty:1,total_cents:1200,status:'paid',created_at:'2026-09-17',event_title:'Sunday together',event_date:'2027-01-10',event_community_id:null,event_public_name:'Sunday Table',event_host_user_id:null,seats:[{id:'seat',position_index:1,reference_code:'WU-PRIVATE',voided:false,checkedIn:false}]};
let tree:ReactTestRenderer,client:QueryClient;
const content=()=>JSON.stringify(tree.toJSON());
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,15));});
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label||n.findAllByType(Text).some(t=>t.props.children===label))!;
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();}
async function redraw(){await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await settle();}
beforeEach(()=>{jest.clearAllMocks();mockCheckRefund.mockReset().mockResolvedValue({state:'none'});mockPages.mockReset().mockResolvedValue(new Map());mockScope={userId:'buyer',isCurrent:()=>true};mockAccount={isLoading:false,isCurrent:()=>true,retry:mockAccountRetry};mockOrders.mockResolvedValue([order]);mockPreview.mockResolvedValue({allowed:false,canSelfRefund:false});mockNote.mockResolvedValue(null);mockProfiles.mockResolvedValue(new Map());mockStash.mockResolvedValue(undefined);});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();jest.restoreAllMocks();});
it('distinguishes failed load from an empty wallet and recovers the original codes',async()=>{
 mockOrders.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('Your tickets couldn’t be loaded.');expect(content()).not.toContain('no tickets yet');
 await act(async()=>button('Retry tickets').props.onPress());await settle();expect(content()).toContain('WU-PRIVATE');expect(mockOrders.mock.calls[0][0].userId).toBe('buyer');
});
it('shows the existing invitation only after a confirmed empty read',async()=>{mockOrders.mockResolvedValue([]);await mount();expect(content()).toContain('no tickets yet');expect(content()).toContain('find plans');});
it('removes previous buyer data immediately and ignores its late read after account change',async()=>{
 let finish:any;mockOrders.mockReturnValueOnce(new Promise(r=>finish=r));await mount();mockScope.isCurrent=()=>false;mockScope={userId:'other',isCurrent:()=>true};mockOrders.mockResolvedValue([]);await redraw();await act(async()=>finish([order]));expect(content()).not.toContain('WU-PRIVATE');expect(content()).not.toContain('Sunday together');
});
it('retains saved ticket codes during a failed refresh and hides refund actions',async()=>{
 mockPreview.mockRejectedValueOnce(Error('preview offline'));await mount();mockOrders.mockRejectedValueOnce(Error('wallet offline'));
 await act(async()=>button('Check refund status').props.onPress());await settle();expect(content()).toContain('WU-PRIVATE');expect(content()).toContain('Your tickets couldn’t be refreshed.');expect(button('refund this purchase')).toBeUndefined();
});
it('preserves event navigation but refuses a captured action after retirement',async()=>{
 await mount();const open=button('Open event: Sunday together').props.onPress;act(()=>open());expect(mockPush).toHaveBeenCalledWith('/event/event');mockPush.mockClear();mockScope.isCurrent=()=>false;act(()=>open());expect(mockPush).not.toHaveBeenCalled();
});
it('signed-out return saves the wallet destination and avoids private reads',async()=>{
 mockScope=null;await mount();expect(content()).toContain('Sign in with the account');expect(mockOrders).not.toHaveBeenCalled();await act(async()=>button('Sign in').props.onPress());expect(mockStash).toHaveBeenCalledWith('/tickets');expect(mockPush).toHaveBeenCalledWith('/phone-entry');
});
it('account read failure offers identity retry rather than an empty wallet',async()=>{
 mockScope=null;mockAccount.error=Error('offline');await mount();expect(content()).toContain('Your account could not be checked.');act(()=>button('Try again').props.onPress());expect(mockAccountRetry).toHaveBeenCalled();expect(mockOrders).not.toHaveBeenCalled();
});
it('scopes preview and a single confirmed refund to the buyer, retaining unknown-result recovery',async()=>{
 mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1});let reject:any;mockRefund.mockReturnValue(new Promise((_,r)=>reject=r));const alert=jest.spyOn(Alert,'alert');await mount();
 act(()=>button('refund this purchase').props.onPress());const confirm=alert.mock.calls.at(-1)![2]![1].onPress!;
 await act(async()=>{confirm();confirm();});expect(mockRefund).toHaveBeenCalledTimes(1);expect(mockRefund.mock.calls[0][2].userId).toBe('buyer');
 await act(async()=>reject(Error('lost response')));expect(content()).toContain('The refund result isn’t confirmed. Check status refreshes your tickets.');expect(content()).toContain('WU-PRIVATE');
 mockPreview.mockResolvedValue({allowed:false,canSelfRefund:false});await act(async()=>button('Check refund status').props.onPress());expect(mockRefund).toHaveBeenCalledTimes(1);expect(button('refund this purchase')).toBeUndefined();
});
it('does not dispatch a confirmation from the previous account',async()=>{
 mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1});const alert=jest.spyOn(Alert,'alert');await mount();act(()=>button('refund this purchase').props.onPress());const confirm=alert.mock.calls.at(-1)![2]![1].onPress!;mockScope.isCurrent=()=>false;await act(async()=>confirm());expect(mockRefund).not.toHaveBeenCalled();
});
it('keeps refunded seats and their original code without previewing another refund',async()=>{
 mockOrders.mockResolvedValue([{...order,status:'refunded',seats:[{...order.seats[0],voided:true}]}]);await mount();expect(content()).toContain('WU-PRIVATE');expect(content()).toContain("this one was refunded and won't scan");expect(mockPreview).not.toHaveBeenCalled();
});

const page={pageId:'page',kind:'organization',name:'Sunset Social Club',photoUrl:'https://example.test/published.jpg'};
it('carries the exact published page instead of the creator account name',async()=>{
 mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page}]]));await mount();expect(content()).toContain('Sunset Social Club');expect(content()).not.toContain('Sunday Table');expect(mockProfiles).not.toHaveBeenCalled();expect(mockPages.mock.calls[0][0]).toEqual(['event']);expect(mockPages.mock.calls[0][1].userId).toBe('buyer');
});
it('keeps codes available while creator identity is pending and unavailable, without account fallback',async()=>{
 let resolve:any;mockPages.mockReturnValueOnce(new Promise(r=>resolve=r));await mount();expect(content()).toContain('WU-PRIVATE');expect(content()).not.toContain('Sunday Table');
 await act(async()=>resolve(new Map([['event',{pageId:'page',page:null}]])));expect(content()).not.toContain('Sunday Table');expect(content()).toContain('WU-PRIVATE');
});
it('recovers a failed creator read without hiding or replacing ticket codes',async()=>{
 mockPages.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('Creator details couldn’t be loaded.');expect(content()).toContain('WU-PRIVATE');expect(content()).not.toContain('Sunday Table');
 mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page}]]));await act(async()=>button('Retry creator details').props.onPress());expect(content()).toContain('Sunset Social Club');expect(content()).not.toContain('Creator details couldn’t be loaded.');
});
it('retains account bylines only for confirmed legacy events',async()=>{
 mockOrders.mockResolvedValue([{...order,event_public_name:null,event_host_user_id:'creator'}]);mockProfiles.mockResolvedValue(new Map([['creator',{display_name:'Original organizer',logo_url:null}]]));await mount();expect(content()).toContain('Original organizer');expect(mockProfiles).toHaveBeenCalledWith(['creator']);
});
it('rejects a community-page mismatch without substituting a profile or hiding codes',async()=>{
 mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page:{...page,kind:'community'}}]]));await mount();expect(content()).toContain('Creator details couldn’t be loaded.');expect(content()).not.toContain('Sunset Social Club');expect(content()).not.toContain('Sunday Table');expect(content()).toContain('WU-PRIVATE');
});

describe('wallet refund wait recovery',()=>{
 const allowed={allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1};
 const pending=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
 const flush=()=>act(async()=>{await jest.advanceTimersByTimeAsync(1);});
 const deadline=()=>act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});
 const confirmation=(alert:jest.SpyInstance)=>{act(()=>button('refund this purchase').props.onPress());return alert.mock.calls.at(-1)![2] as any[];};
 const codes=()=>{expect(content()).toContain('WU-PRIVATE');expect(tree.root.findAllByProps({accessibilityLabel:'ticket code WU-PRIVATE'}).length).toBeGreaterThan(0);};
 async function render(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await flush();}
 async function update(){await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await flush();}
 beforeEach(()=>{jest.useFakeTimers();mockRefund.mockReset();mockPreview.mockReset().mockResolvedValue(allowed);});
 afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});

 it('bounds a hanging write, retires its service scope and ignores late success while retaining codes',async()=>{
  const write=pending<any>();mockRefund.mockReturnValue(write.promise);const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;
  act(()=>{void confirm();void confirm();});expect(mockRefund).toHaveBeenCalledTimes(1);const scope=mockRefund.mock.calls[0][2];expect(scope.isCurrent()).toBe(true);
  await deadline();expect(button('Check refund status')?.props.disabled).toBe(false);codes();expect(scope.isCurrent()).toBe(false);
  await act(async()=>write.resolve({ok:true,pending:false,refundAmountCents:1200,positionsVoided:1}));
  expect(alert.mock.calls.filter(call=>call[0]==='refund on its way')).toHaveLength(0);expect(mockOrders).toHaveBeenCalledTimes(1);
  act(()=>void confirm());expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('bounds an initial preview hang and explicitly retries without a refund',async()=>{
  const preview=pending<any>();mockPreview.mockReturnValueOnce(preview.promise);await render();await deadline();codes();expect(button('Check refund status')?.props.disabled).toBe(false);
  await act(async()=>button('Check refund status').props.onPress());await flush();expect(button('refund this purchase')).toBeTruthy();expect(mockRefund).not.toHaveBeenCalled();
  await act(async()=>preview.resolve({allowed:false,canSelfRefund:false}));expect(button('refund this purchase')).toBeTruthy();
 });

 it('bounds a hanging status preview and leaves Check available without replay',async()=>{
  mockRefund.mockRejectedValueOnce(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();await act(async()=>confirmation(alert)[1].onPress());
  const preview=pending<any>();mockPreview.mockReturnValueOnce(preview.promise);act(()=>void button('Check refund status').props.onPress());await flush();await deadline();
  expect(button('Check refund status')?.props.disabled).toBe(false);codes();expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('bounds a hanging wallet status read and retains the uncertain attempt after wallet retry',async()=>{
  mockRefund.mockRejectedValueOnce(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();await act(async()=>confirmation(alert)[1].onPress());
  const read=pending<any>();mockOrders.mockReturnValueOnce(read.promise);act(()=>void button('Check refund status').props.onPress());await deadline();
  codes();expect(button('Retry tickets')?.props.disabled).toBe(false);expect(mockPreview).toHaveBeenCalledTimes(1);
  await act(async()=>button('Retry tickets').props.onPress());await flush();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')?.props.disabled).toBe(false);expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('does not treat a paid wallet and allowed preview as proof that an uncertain write never ran',async()=>{
  mockRefund.mockRejectedValueOnce(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;
  await act(async()=>confirm());await act(async()=>button('Check refund status').props.onPress());await flush();
  expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeTruthy();codes();
  await act(async()=>confirm());expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('invalidates cancelled and superseded confirmations and submits the exact reviewed snapshot once',async()=>{
  mockRefund.mockRejectedValue(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();const cancelled=confirmation(alert);act(()=>cancelled[0].onPress?.());
  await act(async()=>cancelled[1].onPress());expect(mockRefund).not.toHaveBeenCalled();
  const old=confirmation(alert),latest=confirmation(alert);await act(async()=>old[1].onPress());expect(mockRefund).not.toHaveBeenCalled();
  await act(async()=>latest[1].onPress());expect(mockRefund).toHaveBeenCalledTimes(1);expect(mockRefund.mock.calls[0].slice(0,2)).toEqual(['order',{reviewedAmountCents:1200,reviewedPositionCount:1}]);
 });

 it.each(['account','focus'])('ignores an in-flight result after %s retirement',async(kind)=>{
  const write=pending<any>();mockRefund.mockReturnValue(write.promise);const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;act(()=>void confirm());
  mockScope.isCurrent=()=>false;mockScope={userId:kind==='account'?'other':'buyer',isCurrent:()=>true};mockOrders.mockResolvedValue(kind==='account'?[]:[order]);await update();
  await act(async()=>write.resolve({ok:true,pending:false,refundAmountCents:1200,positionsVoided:1}));await act(async()=>confirm());
  expect(mockRefund).toHaveBeenCalledTimes(1);expect(alert.mock.calls.filter(call=>call[0]==='refund on its way')).toHaveLength(0);
  if(kind==='account')expect(content()).not.toContain('WU-PRIVATE');else{codes();expect(button('refund this purchase')).toBeUndefined();}
 });

 it('does not continue a status preview after its focused visit retires',async()=>{
  mockRefund.mockRejectedValueOnce(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();await act(async()=>confirmation(alert)[1].onPress());
  const read=pending<any>();mockOrders.mockReturnValueOnce(read.promise);act(()=>void button('Check refund status').props.onPress());mockScope.isCurrent=()=>false;
  await act(async()=>read.resolve([order]));expect(mockPreview).toHaveBeenCalledTimes(1);expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('locks duplicate Check taps synchronously and ignores a timed-out wallet read after fresh recovery',async()=>{
  mockRefund.mockRejectedValueOnce(Error('lost response'));const alert=jest.spyOn(Alert,'alert');await render();await act(async()=>confirmation(alert)[1].onPress());
  const read=pending<any>();mockOrders.mockReturnValueOnce(read.promise);const check=button('Check refund status').props.onPress;act(()=>{void check();void check();});expect(mockCheckRefund).toHaveBeenCalledTimes(1);await flush();expect(mockOrders).toHaveBeenCalledTimes(2);
  await deadline();await act(async()=>button('Retry tickets').props.onPress());await flush();codes();
  await act(async()=>read.resolve([{...order,seats:[{...order.seats[0],reference_code:'STALE-CODE'}]}]));codes();expect(content()).not.toContain('STALE-CODE');
  expect(button('Check refund status')?.props.disabled).toBe(false);expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 it('keeps a verified recording-pending receipt distinct from a timeout, then reads original voided codes',async()=>{
  mockRefund.mockResolvedValue({ok:true,pending:true,refundAmountCents:0,positionsVoided:0});const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;
  await act(async()=>confirm());await flush();expect(alert).toHaveBeenCalledWith('refund on its way','your refund is on its way. it can take a minute to show here.');expect(content()).toContain('The refund is on its way. Check status refreshes your tickets.');expect(content()).not.toContain('The refund result isn’t confirmed.');codes();
  mockOrders.mockResolvedValue([{...order,status:'refunded',seats:[{...order.seats[0],voided:true}]}]);await act(async()=>button('Check refund status').props.onPress());await flush();
  expect(content()).toContain('WU-PRIVATE');expect(content()).toContain("this one was refunded and won't scan");expect(tree.root.findAllByProps({accessibilityLabel:'ticket code WU-PRIVATE'})).toHaveLength(0);
  await act(async()=>confirm());expect(mockRefund).toHaveBeenCalledTimes(1);
 });

 describe('authoritative refusal review',()=>{
  const refused={ok:false,notStarted:true,message:'The refund details changed. Review the amount before confirming again.'};
  it('requires a fresh explicit read and new confirmation for exactly one retry at the newly shown amount',async()=>{
   mockRefund.mockResolvedValueOnce(refused).mockRejectedValueOnce(Error('second response lost'));const alert=jest.spyOn(Alert,'alert');await render();
   const oldOpen=button('refund this purchase').props.onPress,oldConfirm=confirmation(alert)[1].onPress;
   await act(async()=>oldConfirm());expect(content()).toContain('No refund was started.');expect(button('refund this purchase')).toBeUndefined();expect(mockPreview).toHaveBeenCalledTimes(1);
   const notices=alert.mock.calls.length;act(()=>oldOpen());await act(async()=>oldConfirm());expect(alert).toHaveBeenCalledTimes(notices);expect(mockRefund).toHaveBeenCalledTimes(1);
   mockPreview.mockResolvedValue({...allowed,refundAmountCents:900});await act(async()=>{await button('Check refund status').props.onPress();oldOpen();});await flush();expect(mockRefund).toHaveBeenCalledTimes(1);expect(alert.mock.calls.at(-1)![1]).toBe('refund $9.00 to your card?');
   await act(async()=>oldConfirm());expect(mockRefund).toHaveBeenCalledTimes(1);
   act(()=>oldOpen());expect(alert.mock.calls.at(-1)![1]).toBe('refund $9.00 to your card?');const fresh=alert.mock.calls.at(-1)![2]![1].onPress!;
   await act(async()=>{fresh();fresh();});expect(mockRefund).toHaveBeenCalledTimes(2);expect(mockRefund.mock.calls[1][1]).toEqual({reviewedAmountCents:900,reviewedPositionCount:1});codes();
  });
  it('cannot use an old opening or confirmation after the fresh preview denies eligibility',async()=>{
   mockRefund.mockResolvedValue(refused);const alert=jest.spyOn(Alert,'alert');await render();const oldOpen=button('refund this purchase').props.onPress,oldConfirm=confirmation(alert)[1].onPress;
   await act(async()=>oldConfirm());mockPreview.mockResolvedValue({...allowed,allowed:false,canSelfRefund:false});await act(async()=>button('Check refund status').props.onPress());await flush();
   const notices=alert.mock.calls.length;act(()=>oldOpen());await act(async()=>oldConfirm());expect(alert).toHaveBeenCalledTimes(notices);expect(mockRefund).toHaveBeenCalledTimes(1);expect(button('refund this purchase')).toBeUndefined();codes();
  });
  it('keeps generic false outcomes locked even when their message resembles a refusal',async()=>{
   mockRefund.mockResolvedValue({ok:false,message:refused.message});const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;
   await act(async()=>confirm());await act(async()=>button('Check refund status').props.onPress());await flush();await act(async()=>confirm());
   expect(content()).toContain('The refund result isn’t confirmed.');expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);codes();
  });
  it('does not release the original attempt from a refusal received after its deadline',async()=>{
   const write=pending<any>();mockRefund.mockReturnValue(write.promise);const alert=jest.spyOn(Alert,'alert');await render();act(()=>void confirmation(alert)[1].onPress());await deadline();
   await act(async()=>write.resolve(refused));await act(async()=>button('Check refund status').props.onPress());await flush();
   expect(content()).toContain('The refund result isn’t confirmed.');expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);codes();
  });
  it('keeps a refused attempt in review recovery when its fresh eligibility read fails',async()=>{
   mockRefund.mockResolvedValue(refused);const alert=jest.spyOn(Alert,'alert');await render();const confirm=confirmation(alert)[1].onPress;await act(async()=>confirm());
   mockPreview.mockRejectedValueOnce(Error('eligibility offline'));await act(async()=>button('Check refund status').props.onPress());await flush();await act(async()=>confirm());
   expect(content()).toContain('No refund was started.');expect(button('Check refund status')?.props.disabled).toBe(false);expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);
  });
 });
});

describe('saved refund continuity after reopening',()=>{
 it.each(['unknown','confirmed'] as const)('renders saved %s as recovery and keeps it read-only after Check',async pendingAttempt=>{
  mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1,pendingAttempt});
  await mount();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeTruthy();
  expect(content()).toContain(pendingAttempt==='confirmed'?'The refund is on its way.':'The refund result isn’t confirmed.');
  await act(async()=>button('Check refund status').props.onPress());await settle();
  expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).not.toHaveBeenCalled();expect(content()).toContain('WU-PRIVATE');
  act(()=>tree.unmount());client.clear();await mount();
  expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeTruthy();expect(mockRefund).not.toHaveBeenCalled();
 });
 it('rejects an earlier confirmation if a persisted attempt appears during preview refresh',async()=>{
  mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1});
  const alert=jest.spyOn(Alert,'alert');await mount();act(()=>button('refund this purchase').props.onPress());const confirm=alert.mock.calls.at(-1)![2]![1].onPress!;
  mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1,pendingAttempt:'unknown'});
  // Replacing the same-account visit retires the captured confirmation and
  // rebuilds the actual wallet from the durable service's preview contract.
  mockScope.isCurrent=()=>false;mockScope={userId:'buyer',isCurrent:()=>true};await redraw();
  await act(async()=>confirm());expect(mockRefund).not.toHaveBeenCalled();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeTruthy();
 });
});

describe('wallet exact saved refund status',()=>{
 const allowed={allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1};
 async function unknown(){mockPreview.mockResolvedValue(allowed);mockRefund.mockRejectedValueOnce(Error('lost'));const alert=jest.spyOn(Alert,'alert');await mount();act(()=>button('refund this purchase').props.onPress());await act(async()=>alert.mock.calls.at(-1)![2]![1].onPress!());return alert;}
 it.each(['not-started'])('keeps %s proof locked through a failed refresh and permits only a new confirmation after success',async state=>{
  await unknown();mockCheckRefund.mockResolvedValue({state,refundAmountCents:1200,positionsVoided:1,isCurrent:()=>true});mockOrders.mockRejectedValueOnce(Error('offline'));
  await act(async()=>button('Check refund status').props.onPress());await settle();expect(content()).toContain('WU-PRIVATE');expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);
  await act(async()=>button('Retry tickets').props.onPress());await settle();await act(async()=>button('Check refund status').props.onPress());await settle();expect(button('refund this purchase')).toBeDefined();expect(mockCheckRefund).toHaveBeenCalledTimes(2);expect(mockRefund).toHaveBeenCalledTimes(1);
 });
 it.each(['complete','not-started'])('does not apply a replaced %s receipt after ticket refresh',async state=>{
  await unknown();let current=true,resolve!:(value:any)=>void;mockCheckRefund.mockResolvedValue({state,refundAmountCents:1200,positionsVoided:1,isCurrent:()=>current});mockOrders.mockReturnValueOnce(new Promise(r=>resolve=r));
  let checking:Promise<void>;await act(async()=>{checking=button('Check refund status').props.onPress();});current=false;await act(async()=>{resolve([{...order,seats:order.seats.map(seat=>({...seat,voided:state==='complete'}))}]);await checking;});await settle();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeDefined();expect(mockRefund).toHaveBeenCalledTimes(1);
 });
 it('checks saved request before reading tickets, keeps duplicate Check taps inert and preserves confirmed copy',async()=>{
  await unknown();let resolve!:(v:any)=>void;mockCheckRefund.mockReturnValueOnce(new Promise(r=>resolve=r));const reads=mockOrders.mock.calls.length,check=button('Check refund status').props.onPress;let checking:Promise<void>;
  await act(async()=>{checking=check();check();});expect(mockOrders).toHaveBeenCalledTimes(reads);expect(mockCheckRefund).toHaveBeenCalledTimes(1);
  await act(async()=>{resolve({state:'confirmed',isCurrent:()=>true});await checking;});expect(content()).toContain('The refund is on its way.');expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);
 });
});


describe('wallet completed target reconciliation',()=>{
 async function checking(){
  mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1});
  mockRefund.mockRejectedValueOnce(Error('lost'));const alert=jest.spyOn(Alert,'alert');await mount();
  act(()=>button('refund this purchase').props.onPress());await act(async()=>alert.mock.calls.at(-1)![2]![1].onPress!());
  mockCheckRefund.mockResolvedValue({state:'complete',requestId:'B',refundAmountCents:1200,positionsVoided:1,target:{positionIndexes:null,reviewedPositionCount:1},isCurrent:()=>true});
 }
 it('keeps a completed receipt locked when the original ticket is still valid',async()=>{
  await checking();await act(async()=>button('Check refund status').props.onPress());await settle();
  expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeDefined();expect(mockRefund).toHaveBeenCalledTimes(1);
 });
 it('keeps a completed receipt locked when its count disagrees with the exact reviewed target',async()=>{
  await checking();mockCheckRefund.mockResolvedValue({state:'complete',requestId:'B',refundAmountCents:1200,positionsVoided:2,target:{positionIndexes:null,reviewedPositionCount:1},isCurrent:()=>true});
  mockOrders.mockResolvedValue([{...order,seats:[{...order.seats[0],voided:true}]}]);
  await act(async()=>button('Check refund status').props.onPress());await settle();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeDefined();
 });
 it('rejects a replacement ticket even if it has the same index and is voided',async()=>{
  await checking();mockOrders.mockResolvedValue([{...order,seats:[{...order.seats[0],id:'replacement',voided:true}]}]);
  await act(async()=>button('Check refund status').props.onPress());await settle();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeDefined();
  await act(async()=>button('Check refund status').props.onPress());await settle();expect(button('refund this purchase')).toBeUndefined();expect(button('Check refund status')).toBeDefined();
 });
 it('finishes a wholly refunded order without another paid-order preview',async()=>{
  await checking();const previews=mockPreview.mock.calls.length;
  mockOrders.mockResolvedValue([{...order,status:'refunded',seats:[{...order.seats[0],voided:true}]}]);
  await act(async()=>button('Check refund status').props.onPress());await settle();expect(mockPreview).toHaveBeenCalledTimes(previews);
  expect(content()).toContain('WU-PRIVATE');expect(content()).toContain("this one was refunded and won't scan");expect(button('refund this purchase')).toBeUndefined();expect(mockRefund).toHaveBeenCalledTimes(1);
 });
});

it('retains exact completed proof through failed refresh then shows original refunded tickets',async()=>{
 mockPreview.mockResolvedValue({allowed:true,canSelfRefund:true,refundAmountCents:1200,positionCount:1});
 mockRefund.mockRejectedValueOnce(Error('lost'));const alert=jest.spyOn(Alert,'alert');await mount();
 act(()=>button('refund this purchase').props.onPress());await act(async()=>alert.mock.calls.at(-1)![2]![1].onPress!());
 mockCheckRefund.mockResolvedValue({state:'complete',refundAmountCents:1200,positionsVoided:1,target:{positionIndexes:null,reviewedPositionCount:1},isCurrent:()=>true});
 mockOrders.mockRejectedValueOnce(Error('offline'));
 await act(async()=>button('Check refund status').props.onPress());await settle();expect(content()).toContain('WU-PRIVATE');expect(button('refund this purchase')).toBeUndefined();
 mockOrders.mockResolvedValue([{...order,status:'refunded',seats:[{...order.seats[0],voided:true}]}]);
 await act(async()=>button('Retry tickets').props.onPress());await settle();
 expect(content()).toContain('WU-PRIVATE');expect(content()).toContain("this one was refunded and won't scan");expect(mockRefund).toHaveBeenCalledTimes(1);expect(button('refund this purchase')).toBeUndefined();
});
