import React from 'react';
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Alert,TextInput,TouchableOpacity} from 'react-native';
const mockPurchase=jest.fn(),mockRefundAccess=jest.fn(),mockPreview=jest.fn(),mockExecute=jest.fn(),mockCheckRefund=jest.fn();
const mockExtras=jest.fn();const mockAccess=jest.fn();const mockAttendees=jest.fn();const mockMoney=jest.fn();const mockQuestions=jest.fn();let mockScope={userId:'creator',isCurrent:()=>true};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a)}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:({title,onPress}:any)=>require('react').createElement(require('react-native').TouchableOpacity,{accessibilityLabel:title,onPress}),pageStyles:{body:{}}}));
jest.mock('../../../lib/purchaseExtras',()=>({readPurchaseExtras:(...a:any[])=>mockExtras(...a)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'order'}),router:{push:jest.fn()}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getPurchaseDetail:(...a:any[])=>mockPurchase(...a),getRefundAccess:(...a:any[])=>mockRefundAccess(...a),previewRefund:(...a:any[])=>mockPreview(...a),executeRefund:(...a:any[])=>mockExecute(...a),checkRefundAttempt:(...a:any[])=>mockCheckRefund(...a)}));
jest.mock('../../../lib/ticketAttendees',()=>({...jest.requireActual('../../../lib/ticketAttendees'),getEventAttendees:(...a:any[])=>mockAttendees(...a),getEventMoneySummary:(...a:any[])=>mockMoney(...a),getEventQuestions:(...a:any[])=>mockQuestions(...a)}));
jest.mock('../MoneySummaryCard',()=>({MoneySummaryCard:()=>require('react').createElement(require('react-native').Text,null,'Detailed sales breakdown')}));
let mockRealReasonModal=false;
jest.mock('../RefundReasonModal',()=>({RefundReasonModal:(props:any)=>mockRealReasonModal?require('react').createElement(jest.requireActual('../RefundReasonModal').RefundReasonModal,props):null}));
import Screen from '../../../app/creator/purchase/[id]';
let tree:ReactTestRenderer,client:QueryClient;const content=()=>JSON.stringify(tree.toJSON());
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
beforeEach(()=>{mockRealReasonModal=false;jest.clearAllMocks();[mockPurchase,mockRefundAccess,mockPreview,mockExecute,mockCheckRefund,mockExtras,mockAccess,mockAttendees,mockMoney,mockQuestions].forEach(mock=>mock.mockReset());mockPurchase.mockResolvedValue({orderId:'order',eventId:'event',eventTitle:'Sunset picnic',buyerName:'Juniper',tierName:'Entry',qty:2,totalCents:2400,refundedCents:0,status:'paid',createdAt:'2026-09-16T12:00:00Z'});mockRefundAccess.mockResolvedValue({canRefund:true,isDelegate:true});mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:1});mockExecute.mockResolvedValue({ok:false,message:'Try again later.'});mockCheckRefund.mockResolvedValue({state:'none'});jest.spyOn(Alert,'alert').mockImplementation(()=>{});mockScope={userId:'creator',isCurrent:()=>true};mockAccess.mockResolvedValue(true);mockMoney.mockResolvedValue(null);mockQuestions.mockResolvedValue([]);mockAttendees.mockResolvedValue([1,2].map(i=>({positionId:'seat'+i,orderId:'order',positionIndex:i,referenceCode:'WU-'+i,buyerName:'Juniper',tierName:'Entry',orderStatus:'paid',voided:false,checkedIn:false,refundedCents:0})));mockExtras.mockResolvedValue(new Map([['order',[{id:'extra',name:'Picnic lunch',quantity:2,unitPriceCents:1200,optionLabel:'Vegan picnic'}]]]));});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();});


const modal=()=>tree.root.findByType(require('../RefundReasonModal').RefundReasonModal);
async function openRefund(){await act(async()=>{await tree.root.findAllByType(TouchableOpacity).find(x=>x.props.accessibilityLabel==='Refund purchase')!.props.onPress();});}
it('admits exact event authority before showing purchase or querying seats',async()=>{mockAccess.mockResolvedValue(false);await mount();expect(content()).not.toContain('Sunset picnic');expect(mockAttendees).not.toHaveBeenCalled();expect(mockAccess.mock.calls[0][0]).toBe('event');});
it('keeps failed purchase lookup distinct from missing data',async()=>{mockPurchase.mockRejectedValue(Error('offline'));await mount();expect(content()).toContain('couldn’t be loaded');expect(mockAttendees).not.toHaveBeenCalled();});
it('shows independent seat failure while retaining purchase identity',async()=>{mockAttendees.mockRejectedValue(Error('offline'));await mount();expect(content()).toContain('Sunset picnic');expect(content()).toContain('Tickets couldn’t be refreshed');expect(tree.root.findAllByType(TouchableOpacity).some(x=>x.props.accessibilityLabel==='Refund purchase')).toBe(false);});
it('closes a consumed delegate confirmation after an unknown result and sends the reviewed snapshot',async()=>{await mount();await openRefund();expect(modal().props.visible).toBe(true);await act(async()=>{expect(await modal().props.onSubmit('Duplicate purchase')).toBe(false);});expect(modal().props.visible).toBe(false);expect(mockExecute.mock.calls[0][1]).toMatchObject({reviewedAmountCents:2400,reviewedPositionCount:1,reason:'Duplicate purchase'});});
it('requires another confirmation when the amount changes',async()=>{await mount();await openRefund();mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();expect(modal().props.amountLabel).toContain('12.00');});
it('rejects a changed purchase event before refund execution',async()=>{await mount();await openRefund();mockPurchase.mockResolvedValue({orderId:'order',eventId:'different'});await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();});
it('retires confirmations after account or visit changes',async()=>{await mount();await openRefund();mockScope.isCurrent=()=>false;await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();});
it('does not retain purchase content after switching accounts',async()=>{await mount();expect(content()).toContain('Sunset picnic');mockScope={userId:'other',isCurrent:()=>true};mockAccess.mockResolvedValue(false);await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await settle();expect(content()).not.toContain('Sunset picnic');});


describe('bounded creator refund recovery',()=>{
  beforeEach(()=>jest.useFakeTimers());
  afterEach(()=>jest.useRealTimers());
  const flush=()=>act(async()=>{await jest.advanceTimersByTimeAsync(1);});
  const deadline=()=>act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});
  const never=()=>new Promise<any>(()=>{});
  async function mountBounded(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await flush();await flush();}
  function beginReview(){
    return tree.root.findAllByType(TouchableOpacity).find(x=>x.props.accessibilityLabel==='Refund purchase')!.props.onPress();
  }
  it('bounds an initial review wait and retires its scope before explicit recovery',async()=>{
    await mountBounded();mockPreview.mockImplementationOnce(never);let pending:Promise<any>;act(()=>{pending=beginReview();});await flush();const owned=mockPreview.mock.calls.at(-1)[2];await deadline();
    expect(content()+JSON.stringify((Alert.alert as jest.Mock).mock.calls)).toContain('Refund preview unavailable');expect(owned.isCurrent()).toBe(false);await pending!;expect(mockExecute).not.toHaveBeenCalled();
  });
  it('does not replay a generic failed dispatch from its retained delegate callback',async()=>{
    await mountBounded();await act(async()=>{await beginReview();});const submit=modal().props.onSubmit;await act(async()=>{await submit('Duplicate purchase');});await act(async()=>{await submit('Duplicate purchase');});
    expect(mockExecute).toHaveBeenCalledTimes(1);expect(modal().props.visible).toBe(false);expect(content()).toContain('Check status');expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');
  });
  const action=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(x=>x.props.accessibilityLabel===label)!;
  const confirmation=()=>((Alert.alert as jest.Mock).mock.calls.at(-1)[2] as any[]).find(b=>b.style==='destructive').onPress;
  const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return {promise,resolve};};
  it('bounds dispatched work, ignores late success, and checks paid tickets without replay',async()=>{
    const pending=deferred();await mountBounded();await act(async()=>{await beginReview();});mockExecute.mockReturnValueOnce(pending.promise);const submit=modal().props.onSubmit;let result:Promise<boolean>;act(()=>{result=submit('Duplicate purchase');});await flush();const writeScope=mockExecute.mock.calls[0][2];await deadline();
    expect(await result!).toBe(false);expect(writeScope.isCurrent()).toBe(false);expect(modal().props.visible).toBe(false);expect(content()).toContain('isn’t confirmed');
    const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockPreview).toHaveBeenCalledTimes(previews);expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');
    await act(async()=>{pending.resolve({ok:true,pending:false,refundAmountCents:2400,positionsVoided:1});await submit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);expect(content()).toContain('Check status');expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls)).not.toContain('refund sent');
  });
  it('bounds a status read and retains original tickets with explicit read-only recovery',async()=>{
    await mountBounded();await act(async()=>{await beginReview();});await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});mockAttendees.mockImplementationOnce(never);let pending:Promise<any>;const check=action('Check status').props.onPress;
    act(()=>{pending=check();check();});await flush();const readScope=mockAttendees.mock.calls.at(-1)[1];await deadline();await pending!;expect(readScope.isCurrent()).toBe(false);expect(content()).toContain('Tickets couldn’t be refreshed');expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');expect(mockExecute).toHaveBeenCalledTimes(1);expect(action('Check status')).toBeDefined();
    await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockExecute).toHaveBeenCalledTimes(1);expect(content()).toContain('Check status');expect(content()).not.toContain('Tickets couldn’t be refreshed');
  });
  it('requires fresh explicit review after an authoritative refusal and sends exactly the new snapshot',async()=>{
    mockExecute.mockResolvedValueOnce({ok:false,notStarted:true,message:'refund details changed; review the amount again'});await mountBounded();await act(async()=>{await beginReview();});const oldSubmit=modal().props.onSubmit;
    await act(async()=>{await oldSubmit('Duplicate purchase');});expect(modal().props.visible).toBe(false);expect(content()).toContain('No refund was started');expect(action('Review refund')).toBeDefined();
    mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:2});await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);
    await act(async()=>{await action('Review refund').props.onPress();});expect(modal().props.visible).toBe(true);expect(modal().props.amountLabel).toContain('12.00');expect(mockExecute).toHaveBeenCalledTimes(1);const freshSubmit=modal().props.onSubmit;
    await act(async()=>{await oldSubmit('Duplicate purchase');await freshSubmit('Duplicate purchase');await freshSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(2);expect(mockExecute.mock.calls[1][1]).toMatchObject({kind:'buyer_request',positionIndexes:null,reviewedAmountCents:1200,reviewedPositionCount:2,reason:'Duplicate purchase'});
  });
  it('does not treat a late authoritative refusal after a deadline as permission to retry',async()=>{
    const pending=deferred();mockExecute.mockReturnValueOnce(pending.promise);await mountBounded();await act(async()=>{await beginReview();});act(()=>{void modal().props.onSubmit('Duplicate purchase');});await flush();await deadline();await act(async()=>pending.resolve({ok:false,notStarted:true,message:'not your order'}));
    expect(content()).toContain('Check status');expect(content()).not.toContain('No refund was started');expect(action('Review refund')).toBeUndefined();expect(mockExecute).toHaveBeenCalledTimes(1);
  });
  it('retires a superseded owner confirmation even if the old amount becomes eligible again',async()=>{
    mockRefundAccess.mockResolvedValue({canRefund:true,isDelegate:false});await mountBounded();await act(async()=>{await beginReview();});const oldConfirm=confirmation();mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});await act(async()=>{await oldConfirm();});const freshConfirm=confirmation();
    mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:1});await act(async()=>{await oldConfirm();});expect(mockExecute).not.toHaveBeenCalled();await act(async()=>{await freshConfirm();});expect(mockExecute).not.toHaveBeenCalled();expect((Alert.alert as jest.Mock).mock.calls.at(-1)[0]).toContain('24.00');await act(async()=>{const confirm=confirmation();await confirm();await confirm();});expect(mockExecute).toHaveBeenCalledTimes(1);
  });
  it('retires a superseded delegate confirmation and keeps the new reviewed count',async()=>{
    await mountBounded();await act(async()=>{await beginReview();});const oldSubmit=modal().props.onSubmit;mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:2});await act(async()=>{await oldSubmit('Duplicate purchase');});const freshSubmit=modal().props.onSubmit;
    await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();await act(async()=>{await freshSubmit('Duplicate purchase');});expect(mockExecute.mock.calls[0][1]).toMatchObject({reviewedAmountCents:2400,reviewedPositionCount:2});
  });
  it('bounds authority revalidation and requires a new review after the consumed confirmation',async()=>{
    await mountBounded();await act(async()=>{await beginReview();});const submit=modal().props.onSubmit;const stalled=deferred();mockRefundAccess.mockReturnValueOnce(stalled.promise);act(()=>{void submit('Duplicate purchase');});await flush();const readScope=mockRefundAccess.mock.calls.at(-1)[1];await deadline();expect(readScope.isCurrent()).toBe(false);expect(mockExecute).not.toHaveBeenCalled();expect(modal().props.visible).toBe(false);
    await act(async()=>{stalled.resolve({canRefund:true,isDelegate:true});await submit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();await act(async()=>{await beginReview();});expect(modal().props.visible).toBe(true);
  });
  it.each(['account','visit','unmount'])('retires pending execution after %s ownership ends',async(kind)=>{
    const pending=deferred();mockExecute.mockReturnValueOnce(pending.promise);await mountBounded();await act(async()=>{await beginReview();});const submit=modal().props.onSubmit;act(()=>{void submit('Duplicate purchase');});await flush();const writeScope=mockExecute.mock.calls[0][2];const alerts=(Alert.alert as jest.Mock).mock.calls.length;
    if(kind==='unmount')act(()=>tree.unmount());else {mockScope.isCurrent=()=>false;mockScope={userId:kind==='account'?'other':'creator',isCurrent:()=>true};await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await flush();}
    await act(async()=>{pending.resolve({ok:true,pending:false,refundAmountCents:2400,positionsVoided:1});await submit('Duplicate purchase');});expect(writeScope.isCurrent()).toBe(false);expect(mockExecute).toHaveBeenCalledTimes(1);expect((Alert.alert as jest.Mock).mock.calls.length).toBe(alerts);
  });
  it('keeps a confirmed recording-pending receipt locked during a paid status refresh',async()=>{
    mockExecute.mockResolvedValueOnce({ok:true,pending:true,refundAmountCents:2400,positionsVoided:1});await mountBounded();await act(async()=>{await beginReview();});await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});expect(content()).toContain('finishing up');await act(async()=>{await action('Check status').props.onPress();});await flush();expect(content()).toContain('Check status');expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown','confirmed'])('uses a persisted %s marker from the preview without offering another confirmation',async(pendingAttempt)=>{
    mockPreview.mockResolvedValue({allowed:false,refundAmountCents:0,positionCount:0,pendingAttempt});await mountBounded();await act(async()=>{await beginReview();});expect(modal().props.visible).toBe(false);expect(content()).toContain('Check status');expect(mockExecute).not.toHaveBeenCalled();
    mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:1});await act(async()=>{await action('Check status').props.onPress();});await flush();expect(content()).toContain('Check status');expect(mockPreview).toHaveBeenCalledTimes(1);expect(mockExecute).not.toHaveBeenCalled();
  });
  it('refuses a confirmation if revalidation discovers a persisted pending attempt',async()=>{
    await mountBounded();await act(async()=>{await beginReview();});const submit=modal().props.onSubmit;mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:1,pendingAttempt:'unknown'});await act(async()=>{await submit('Duplicate purchase');await submit('Duplicate purchase');});expect(mockExecute).not.toHaveBeenCalled();expect(modal().props.visible).toBe(false);expect(content()).toContain('Check status');
  });

  it('retains disclosure and blocks captured whole-purchase and other-seat entries after unknown dispatch',async()=>{
    await mountBounded();const whole=action('Refund purchase').props.onPress,other=action('Refund ticket WU-2').props.onPress;
    await act(async()=>{await action('Refund ticket WU-1').props.onPress();});await act(async()=>{await modal().props.onSubmit('Duplicate purchase');});expect(mockExecute.mock.calls[0][1].positionIndexes).toEqual([1]);
    const previews=mockPreview.mock.calls.length;await act(async()=>{await whole();await other();await action('Check status').props.onPress();});await flush();await act(async()=>{await whole();await other();});expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);expect(content()).toContain(require('../../../lib/ticketing').REFUND_DISCLOSURE);expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');
  });
  it('bounds a stalled purchase review before any authority or preview continuation',async()=>{
    await mountBounded();const stalled=deferred();mockPurchase.mockReturnValueOnce(stalled.promise);const accessCount=mockRefundAccess.mock.calls.length;act(()=>{void beginReview();});await flush();const owned=mockPurchase.mock.calls.at(-1)[1];await deadline();expect(owned.isCurrent()).toBe(false);await act(async()=>stalled.resolve({orderId:'order',eventId:'event'}));expect(mockRefundAccess).toHaveBeenCalledTimes(accessCount);expect(mockPreview).not.toHaveBeenCalled();expect(mockExecute).not.toHaveBeenCalled();
  });

  describe('saved refund request status',()=>{
    async function unknownRefund(open=beginReview){await mountBounded();await act(async()=>{await open();});const submit=modal().props.onSubmit;await act(async()=>{await submit('Duplicate purchase');});return submit;}
    it('recovers an exact partial receipt before freshly reviewing the remaining seat',async()=>{
      const originalRows=await mockAttendees();mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});const oldSubmit=await unknownRefund(()=>action('Refund ticket WU-1').props.onPress());expect(mockExecute.mock.calls[0][1]).toMatchObject({positionIndexes:[1],reviewedAmountCents:1200,reviewedPositionCount:1});mockCheckRefund.mockResolvedValue({state:'complete',refundAmountCents:1200,positionsVoided:1});mockAttendees.mockResolvedValue(originalRows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));
      mockPurchase.mockResolvedValue({...await mockPurchase(),refundedCents:1200});
      const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockCheckRefund).toHaveBeenCalledWith('order',expect.objectContaining({userId:'creator'}));expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);expect(action('Check status')).toBeUndefined();expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');
      await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});await act(async()=>{await beginReview();});expect(modal().props.amountLabel).toContain('12.00');await act(async()=>{await modal().props.onSubmit('Remaining ticket');});expect(mockExecute.mock.calls[1][1]).toMatchObject({kind:'buyer_request',positionIndexes:null,reviewedAmountCents:1200,reviewedPositionCount:1,reason:'Remaining ticket'});
    });
    it.each(['none','unknown'])('does not unlock from %s even when refreshed tickets remain eligible',async(state)=>{
      const oldSubmit=await unknownRefund();mockCheckRefund.mockResolvedValue({state});await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockCheckRefund).toHaveBeenCalledTimes(1);expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(modal().props.visible).toBe(false);await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    it('requires a fresh explicit review after a verified saved refusal',async()=>{
      const oldSubmit=await unknownRefund();mockCheckRefund.mockResolvedValue({state:'not-started'});const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockCheckRefund).toHaveBeenCalledTimes(1);expect(content()).toContain('No refund was started');expect(action('Review refund')).toBeDefined();expect(modal().props.visible).toBe(false);expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);
      await act(async()=>{await oldSubmit('Duplicate purchase');});mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});await act(async()=>{await action('Review refund').props.onPress();});expect(modal().props.amountLabel).toContain('12.00');await act(async()=>{await modal().props.onSubmit('Fresh review');});expect(mockExecute.mock.calls[1][1]).toMatchObject({positionIndexes:null,reviewedAmountCents:1200,reviewedPositionCount:1,reason:'Fresh review'});
    });
    it.each(['complete','not-started'])('keeps the barrier when tickets fail to refresh after %s',async(state)=>{
      const originalRows=await mockAttendees();await unknownRefund(()=>action('Refund ticket WU-1').props.onPress());mockCheckRefund.mockResolvedValue({state,refundAmountCents:1200,positionsVoided:1});if(state==='complete')mockAttendees.mockResolvedValue(originalRows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));mockAttendees.mockRejectedValueOnce(Error('offline'));await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockCheckRefund).toHaveBeenCalledTimes(1);expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(content()).toContain('Tickets couldn’t be refreshed');expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');expect(mockExecute).toHaveBeenCalledTimes(1);
      await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockCheckRefund).toHaveBeenCalledTimes(2);expect(action('Check status')).toBeUndefined();if(state==='not-started')expect(action('Review refund')).toBeDefined();expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    it('keeps a recovered confirmed receipt locked with known-result copy',async()=>{
      await unknownRefund();mockCheckRefund.mockResolvedValueOnce({state:'confirmed'});await act(async()=>{await action('Check status').props.onPress();});await flush();expect(content()).toContain('went through and is finishing up');expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();await act(async()=>{await action('Check status').props.onPress();});await flush();expect(content()).toContain('went through and is finishing up');expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    it('checks first, suppresses duplicate taps, and waits for refreshed tickets before unlocking',async()=>{
      const originalRows=await mockAttendees();await unknownRefund(()=>action('Refund ticket WU-1').props.onPress());const status=deferred(),tickets=deferred(),readCount=mockAttendees.mock.calls.length;mockCheckRefund.mockReturnValueOnce(status.promise);mockAttendees.mockReturnValueOnce(tickets.promise);const check=action('Check status').props.onPress;let pending:Promise<any>;act(()=>{pending=check();check();});await flush();expect(mockCheckRefund).toHaveBeenCalledTimes(1);expect(mockAttendees).toHaveBeenCalledTimes(readCount);
      await act(async()=>status.resolve({state:'complete',refundAmountCents:1200,positionsVoided:1}));await flush();expect(mockAttendees).toHaveBeenCalledTimes(readCount+1);expect(action('Checking…')).toBeDefined();expect(modal().props.visible).toBe(false);expect(mockExecute).toHaveBeenCalledTimes(1);await act(async()=>{tickets.resolve(originalRows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));await pending!;});await flush();expect(action('Check status')).toBeUndefined();await act(async()=>{await check();});expect(mockCheckRefund).toHaveBeenCalledTimes(1);
    });
    it('bounds status waiting and rejects a late complete receipt before any refresh',async()=>{
      await unknownRefund();const status=deferred(),reads=mockAttendees.mock.calls.length;mockCheckRefund.mockReturnValueOnce(status.promise);act(()=>{void action('Check status').props.onPress();});await flush();const owned=mockCheckRefund.mock.calls[0][1];await deadline();expect(owned.isCurrent()).toBe(false);expect(action('Check status')).toBeDefined();expect(content()).toContain('Refund status couldn’t be checked');await act(async()=>status.resolve({state:'complete',refundAmountCents:1200,positionsVoided:1}));expect(mockAttendees).toHaveBeenCalledTimes(reads);expect(mockExecute).toHaveBeenCalledTimes(1);expect(content()).toContain('WU-1');
    });
    it.each(['account','visit','unmount'])('rejects status completion after %s retirement',async(kind)=>{
      await unknownRefund();const status=deferred();mockCheckRefund.mockReturnValueOnce(status.promise);const check=action('Check status').props.onPress;act(()=>{void check();});await flush();const owned=mockCheckRefund.mock.calls[0][1];if(kind==='unmount')act(()=>tree.unmount());else{mockScope.isCurrent=()=>false;mockScope={userId:kind==='account'?'other':'creator',isCurrent:()=>true};await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await flush();}const reads=mockAttendees.mock.calls.length;
      await act(async()=>{status.resolve({state:'complete',refundAmountCents:1200,positionsVoided:1});await check();});expect(owned.isCurrent()).toBe(false);expect(mockCheckRefund).toHaveBeenCalledTimes(1);expect(mockAttendees).toHaveBeenCalledTimes(reads);expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    describe('saved receipt ownership race',()=>{
      it.each(['complete','not-started'])('keeps recovery when a %s receipt retires during ticket refresh',async(state)=>{
        const rows=await mockAttendees();const oldSubmit=await unknownRefund();let receiptCurrent=true;const tickets=deferred();mockCheckRefund.mockResolvedValue({state,requestId:'original-request',target:{positionIndexes:[1],reviewedPositionCount:1},refundAmountCents:1200,positionsVoided:1,isCurrent:()=>receiptCurrent});mockAttendees.mockReturnValueOnce(tickets.promise);let pending:Promise<any>;
        act(()=>{pending=action('Check status').props.onPress();});await flush();expect(action('Checking…')).toBeDefined();receiptCurrent=false;await act(async()=>{tickets.resolve(state==='complete'?rows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row):rows);await pending!;});await flush();expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(action('Refund purchase')).toBeUndefined();expect(content()).toContain('isn’t confirmed');expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');expect(modal().props.visible).toBe(false);await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);
      });
      it.each(['complete','not-started'])('keeps recovery when a cached %s receipt is already retired',async(state)=>{
        const rows=await mockAttendees();const oldSubmit=await unknownRefund();if(state==='complete')mockAttendees.mockResolvedValue(rows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));mockCheckRefund.mockResolvedValue({state,requestId:'original-request',target:{positionIndexes:[1],reviewedPositionCount:1},refundAmountCents:1200,positionsVoided:1,isCurrent:()=>false});await act(async()=>{await action('Check status').props.onPress();});await flush();expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(action('Refund purchase')).toBeUndefined();expect(modal().props.visible).toBe(false);await act(async()=>{await oldSubmit('Duplicate purchase');});expect(mockExecute).toHaveBeenCalledTimes(1);
      });
    });

  });


  describe('current saved refund target',()=>{
    async function oldSeatRecovery(withFourth=false){
      const two=await mockAttendees();const rows=[...two,{...two[1],positionId:'seat3',positionIndex:3,referenceCode:'WU-3'}];
      if(withFourth)rows.push({...rows[2],positionId:'seat4',positionIndex:4,referenceCode:'WU-4'});
      mockAttendees.mockResolvedValue(rows);mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});
      await mountBounded();await act(async()=>{await action('Refund ticket WU-1').props.onPress();});await act(async()=>{await modal().props.onSubmit('Only the first ticket');});
      return rows;
    }
    it.each(['live','wrong-count','replaced','missing'])('keeps newer whole-purchase completion locked with %s refreshed evidence',async(problem)=>{
      const rows=await oldSeatRecovery();
      const refreshed=rows.filter((row:any)=>problem!=='missing'||row.positionIndex!==3).map((row:any)=>({...row,voided:true,refundedCents:1200,orderStatus:'refunded',...(problem==='live'&&row.positionIndex===3?{voided:false,refundedCents:0,orderStatus:'paid'}:{}),...(problem==='replaced'&&row.positionIndex===3?{positionId:'different-position'}:{})}));
      mockAttendees.mockResolvedValue(refreshed);mockCheckRefund.mockResolvedValue({state:'complete',requestId:'new-request',target:{positionIndexes:null,reviewedPositionCount:2},positionsVoided:problem==='wrong-count'?1:2,refundAmountCents:2400,isCurrent:()=>true});
      const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();
      expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);
      if(problem==='replaced'||problem==='missing'){
        await act(async()=>{await action('Check status').props.onPress();});await flush();
        expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(mockExecute).toHaveBeenCalledTimes(1);
      }
    });
    it.each(['whole','seat'])('accepts newer %s completion only from its own count and original tickets',async(kind)=>{
      const rows=await oldSeatRecovery();const indexes=kind==='whole'?null:[2];
      mockAttendees.mockResolvedValue(rows.map((row:any)=>kind==='whole'||row.positionIndex<3?{...row,voided:true,refundedCents:1200,orderStatus:kind==='whole'?'refunded':'paid'}:row));
      mockCheckRefund.mockResolvedValue({state:'complete',requestId:'new-request',target:{positionIndexes:indexes,reviewedPositionCount:kind==='whole'?2:1},positionsVoided:kind==='whole'?2:1,refundAmountCents:kind==='whole'?2400:1200,isCurrent:()=>true});
      const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();
      expect(action('Check status')).toBeUndefined();expect(action('Review refund')).toBeUndefined();expect(content()).toContain('WU-1');expect(content()).toContain('WU-2');expect(content()).toContain('WU-3');expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    it.each(['missing-request','replaced','unavailable','subset'])('keeps an unverifiable newer refusal %s Check-only',async(problem)=>{
      // Four original seats leave a third eligible ticket outside [2,3].
      const rows=await oldSeatRecovery(problem==='subset');
      mockAttendees.mockResolvedValue(rows.map((row:any)=>({...row,...(row.positionIndex===1||problem==='unavailable'?{voided:true,refundedCents:1200}:{}),...(problem==='replaced'&&row.positionIndex===3?{referenceCode:'REPLACED'}:{})})));
      mockCheckRefund.mockResolvedValue({state:'not-started',...(problem==='missing-request'?{}:{requestId:'new-request'}),target:{positionIndexes:problem==='subset'?[2,3]:null,reviewedPositionCount:2},isCurrent:()=>true});
      const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();
      expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);
      if(problem==='replaced'){
        await act(async()=>{await action('Check status').props.onPress();});await flush();
        expect(action('Check status')).toBeDefined();expect(action('Review refund')).toBeUndefined();expect(mockExecute).toHaveBeenCalledTimes(1);
      }
    });
    it('reviews the exact newer single ticket and resets the old delegate reason',async()=>{
      mockRealReasonModal=true;
      const two=await mockAttendees();const rows=[...two,{...two[1],positionId:'seat3',positionIndex:3,referenceCode:'WU-3'}];mockAttendees.mockResolvedValue(rows);mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});
      await mountBounded();await act(async()=>{await action('Refund ticket WU-1').props.onPress();});
      const input=()=>tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Refund reason')!;
      act(()=>input().props.onChangeText('First ticket only.'));await act(async()=>{await action('Confirm refund').props.onPress();});await flush();
      mockAttendees.mockResolvedValue(rows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));mockCheckRefund.mockResolvedValue({state:'not-started',requestId:'new-request',target:{positionIndexes:[3],reviewedPositionCount:1},isCurrent:()=>true});
      await act(async()=>{await action('Check status').props.onPress();});await flush();await act(async()=>{await action('Review refund').props.onPress();});
      expect(mockPreview.mock.calls.at(-1)[1].positionIndexes).toEqual([3]);expect(input().props.value).toBe('');expect(action('Confirm refund').props.disabled).toBe(true);expect(mockExecute).toHaveBeenCalledTimes(1);
    });
    it('reviews newer remaining purchase after exact refusal instead of the old refunded seat',async()=>{
      const rows=await oldSeatRecovery();mockAttendees.mockResolvedValue(rows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));
      mockCheckRefund.mockResolvedValue({state:'not-started',requestId:'new-request',target:{positionIndexes:null,reviewedPositionCount:2},isCurrent:()=>true});
      const previews=mockPreview.mock.calls.length;await act(async()=>{await action('Check status').props.onPress();});await flush();expect(mockPreview).toHaveBeenCalledTimes(previews);expect(mockExecute).toHaveBeenCalledTimes(1);
      mockPreview.mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:2});await act(async()=>{await action('Review refund').props.onPress();});expect(mockPreview.mock.calls.at(-1)[1].positionIndexes).toBeNull();expect(modal().props.visible).toBe(true);expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('logical refund reason draft',()=>{
    beforeEach(()=>{mockRealReasonModal=true;mockPreview.mockResolvedValue({allowed:true,refundAmountCents:1200,positionCount:1});});
    const reasonInput=()=>tree.root.findAllByType(TextInput).find(input=>input.props.accessibilityLabel==='Refund reason')!;
    const confirmReason=()=>action('Confirm refund');
    const typeReason=(value:string)=>act(()=>reasonInput().props.onChangeText(value));
    const sendReason=async()=>{await act(async()=>confirmReason().props.onPress());await flush();};
    async function openFirstSeat(){await mountBounded();await act(async()=>{await action('Refund ticket WU-1').props.onPress();});}
    it('clears the completed first-seat reason when reviewing the remaining ticket',async()=>{
      const rows=await mockAttendees();await openFirstSeat();typeReason('Buyer requested WU-1 only.');expect(confirmReason().props.disabled).toBe(false);await sendReason();expect(mockExecute.mock.calls[0][1]).toMatchObject({positionIndexes:[1],reason:'Buyer requested WU-1 only.'});expect(modal().props.visible).toBe(false);
      mockCheckRefund.mockResolvedValue({state:'complete',refundAmountCents:1200,positionsVoided:1,isCurrent:()=>true});mockAttendees.mockResolvedValue(rows.map((row:any)=>row.positionIndex===1?{...row,voided:true,refundedCents:1200}:row));mockPurchase.mockResolvedValue({...await mockPurchase(),refundedCents:1200});
      await act(async()=>{await action('Check status').props.onPress();});await flush();await act(async()=>{await beginReview();});expect(reasonInput().props.value).toBe('');expect(confirmReason().props.disabled).toBe(true);await sendReason();expect(mockExecute).toHaveBeenCalledTimes(1);
      typeReason('Buyer now requests the remaining WU-2.');await sendReason();expect(mockExecute.mock.calls[1][1]).toMatchObject({positionIndexes:null,reviewedAmountCents:1200,reviewedPositionCount:1,reason:'Buyer now requests the remaining WU-2.'});
    });
    it.each(['execution','status'])('retains the typed reason for the exact same target after %s refusal',async(origin)=>{
      if(origin==='execution')mockExecute.mockResolvedValueOnce({ok:false,notStarted:true,message:'refund details changed; review the amount again'});
      await openFirstSeat();typeReason('Buyer requested WU-1 only.');await sendReason();expect(modal().props.visible).toBe(false);
      if(origin==='status'){mockCheckRefund.mockResolvedValueOnce({state:'not-started',isCurrent:()=>true});await act(async()=>{await action('Check status').props.onPress();});await flush();}
      mockPreview.mockResolvedValue({allowed:true,refundAmountCents:900,positionCount:1});await act(async()=>{await action('Review refund').props.onPress();});expect(reasonInput().props.value).toBe('Buyer requested WU-1 only.');expect(modal().props.amountLabel).toContain('9.00');expect(confirmReason().props.disabled).toBe(false);expect(mockExecute).toHaveBeenCalledTimes(1);await sendReason();expect(mockExecute.mock.calls[1][1]).toMatchObject({positionIndexes:[1],reviewedAmountCents:900,reviewedPositionCount:1,reason:'Buyer requested WU-1 only.'});
    });
    it('continues to use owner confirmation without a delegate reason',async()=>{
      mockRefundAccess.mockResolvedValue({canRefund:true,isDelegate:false});await openFirstSeat();expect(modal().props.visible).toBe(false);await act(async()=>{await confirmation()();});expect(mockExecute).toHaveBeenCalledTimes(1);expect(mockExecute.mock.calls[0][1]).toMatchObject({positionIndexes:[1],reviewedAmountCents:1200,reviewedPositionCount:1});expect(mockExecute.mock.calls[0][1].reason).toBeUndefined();
    });
  });

});
