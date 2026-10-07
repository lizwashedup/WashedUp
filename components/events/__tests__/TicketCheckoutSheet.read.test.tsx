import React from 'react';
import { TouchableOpacity, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockAttemptRead=jest.fn(), mockAttemptPrepare=jest.fn(), mockAttemptOrder=jest.fn(), mockAttemptFinish=jest.fn(),mockAttemptStop=jest.fn();
const attempt={version:1,key:'stable-checkout-key',userId:'buyer',eventId:'event-a',tierId:'tier-a',qty:1,promoCode:null,addons:[],fingerprint:'a'.repeat(64),hasAnswers:false};
jest.mock('../../../lib/ticketCheckoutAttempt',()=>({...jest.requireActual('../../../lib/ticketCheckoutAttempt'),stopCheckoutAttempt:(...a:unknown[])=>mockAttemptStop(...a),readCheckoutAttempt:(...a:unknown[])=>mockAttemptRead(...a),prepareCheckoutAttempt:(...a:unknown[])=>mockAttemptPrepare(...a),findCheckoutAttemptOrder:(...a:unknown[])=>mockAttemptOrder(...a),finishCheckoutAttempt:(...a:unknown[])=>mockAttemptFinish(...a)}));
const mockTiers = jest.fn(), mockRemaining = jest.fn(), mockQuestions = jest.fn(), mockAddons = jest.fn(), mockVariations = jest.fn(), mockQuote = jest.fn(), mockPending = jest.fn(), mockStart = jest.fn();
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn() } } }));
jest.mock('../../../lib/ticketing', () => ({ ...jest.requireActual('../../../lib/ticketing'), getTiers: (...args: unknown[]) => mockTiers(...args), readPublicTierRemaining: (...args: unknown[]) => mockRemaining(...args), getQuestions: (...args: unknown[]) => mockQuestions(...args), startTicketCheckout: (...args: unknown[]) => mockStart(...args) }));
jest.mock('../../../lib/ticketPromosAddons', () => ({ listBuyerAddons: (...args: unknown[]) => mockAddons(...args), getAddonVariationsMap: (...args: unknown[]) => mockVariations(...args), addonRemaining: () => null, quoteCheckout: (...args: unknown[]) => mockQuote(...args) }));
jest.mock('../../../lib/pendingLink',()=>({pendingCheckoutForEvent:(...args:unknown[])=>mockPending(...args),stashPendingCheckout:jest.fn()}));
jest.mock('../../../lib/url',()=>({openUrl:jest.fn()}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSuccess: jest.fn(), hapticError: jest.fn() }));
jest.mock('../EventMediaImage', () => ({ EventMediaImage: () => null }));
jest.mock('../../tickets/QuestionForm', () => ({ QuestionForm: ({questions}:any) => require('react').createElement(require('react-native').Text,{}, questions.map((q:any)=>q.prompt).join(' ')), buildCheckoutAnswers: () => [], missingRequiredPrompts: () => [], cellKey: () => '' }));
import { TicketCheckoutSheet } from '../TicketCheckoutSheet';
const props = { owner: { userId:'buyer', isCurrent: () => true }, visible: true, eventId: 'event-a', onClose: jest.fn(), onOrderReady: jest.fn(), eventTitle: 'Dinner together', eventImage: null, eventDateLabel: null, eventVenue: null, creatorName: null, creatorAvatar: null };
const tier = { id: 'tier-a', name: 'General admission', price_cents: 2500, quantity_cap: null, status: 'on_sale', visibility: 'visible', per_order_min: 1, per_order_max: 10 };
let tree: ReactTestRenderer;
const content = () => JSON.stringify(tree.toJSON());
const tierButton = () => tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === 'General admission'));
async function mount() { await act(async () => { tree = create(<TicketCheckoutSheet {...props} />); }); }
beforeEach(() => { jest.clearAllMocks(); mockAttemptRead.mockResolvedValue(null);mockAttemptPrepare.mockResolvedValue(attempt);mockAttemptOrder.mockResolvedValue(null);mockAttemptFinish.mockResolvedValue(undefined); mockTiers.mockResolvedValue([tier]); mockRemaining.mockResolvedValue(null); mockQuestions.mockResolvedValue([]); mockAddons.mockResolvedValue([]); mockVariations.mockResolvedValue(new Map()); mockQuote.mockResolvedValue(null); mockPending.mockResolvedValue(null); mockStart.mockResolvedValue({kind:'error',message:'Fixture checkout refused'}); });
afterEach(() => { act(() => tree?.unmount()); });
it('shows a retry for failed reads and restores the existing tier selector after recovery', async () => {
 mockTiers.mockRejectedValueOnce(new Error('offline')); await mount();
 expect(content()).toContain('Tickets could not be loaded.'); expect(tierButton()).toBeUndefined();
 await act(async () => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Retry loading tickets')!.props.onPress());
 expect(mockTiers).toHaveBeenLastCalledWith('event-a', true); expect(tierButton()!.props.disabled).toBe(false);
});
it('blocks a tier when the event-wide capacity is exhausted', async () => {
 mockRemaining.mockResolvedValue(0); await mount(); expect(tierButton()!.props.disabled).toBe(true);
});
it('blocks a group tier when the event-wide remainder cannot meet its minimum', async () => {
 mockTiers.mockResolvedValue([{ ...tier, per_order_min: 3 }]); mockRemaining.mockResolvedValue(2);
 await mount(); expect(tierButton()!.props.disabled).toBe(true);
});
it('ignores an older event read that finishes after the sheet changes events', async () => {
 let resolve!: (value: unknown[]) => void;
 mockTiers.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await mount();
 await act(async () => tree.update(<TicketCheckoutSheet {...props} eventId="event-b" />));
 await act(async () => resolve([{ ...tier, name: 'Old event ticket' }]));
 expect(content()).not.toContain('Old event ticket'); expect(tierButton()).toBeDefined();
});

const labelled = (label:string) => tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
const textButton = (label:string) => tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children===label))!;
const checkout = () => tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>typeof t.props.children==='string' && /^(pay |reserve$|Continue)/.test(t.props.children)))!;
const deferred = () => { let resolve!:(value:any)=>void; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; };
it.each([0,2500])('keeps %s-cent checkout blocked when questions fail and retries without discarding quantity', async price=>{
 mockTiers.mockResolvedValue([{...tier,price_cents:price,per_order_min:2}]);mockQuestions.mockRejectedValueOnce(new Error('offline'));
 await mount(); expect(checkout().props.disabled).toBe(true);expect(content()).toContain('Checkout details could not be loaded.');
 await act(async()=>labelled('more tickets').props.onPress());
 await act(async()=>labelled('Retry checkout details').props.onPress());
 expect(mockQuestions).toHaveBeenLastCalledWith('event-a',true);expect(checkout().props.disabled).toBe(false);
 expect(tree.root.findAllByType(Text).some(t=>t.props.children===3)).toBe(true);
});
it('keeps paid checkout blocked until extras recover, without blocking a free reservation',async()=>{
 mockAddons.mockRejectedValue(new Error('offline'));await mount();expect(checkout().props.disabled).toBe(true);
 mockTiers.mockResolvedValue([{...tier,price_cents:0}]);await act(async()=>tree.update(<TicketCheckoutSheet {...props} eventId="free-event"/>));
 expect(checkout().props.disabled).toBe(false);
});
it('retires late questions and extras when the event changes',async()=>{
 const oldQuestions=deferred(),oldAddons=deferred();mockQuestions.mockReturnValueOnce(oldQuestions.promise);mockAddons.mockReturnValueOnce(oldAddons.promise);
 await mount();await act(async()=>tree.update(<TicketCheckoutSheet {...props} eventId="event-b"/>));
 await act(async()=>{oldQuestions.resolve([{prompt:'Old dietary question'}]);oldAddons.resolve([{id:'old-extra',name:'Old picnic basket',price_cents:900}]);});
 expect(content()).not.toContain('Old dietary question');expect(content()).not.toContain('Old picnic basket');expect(checkout().props.disabled).toBe(false);
});
it('retires a promo response after quantity changes and prevents simultaneous apply requests',async()=>{
 const response=deferred();mockQuote.mockReturnValue(response.promise);await mount();act(()=>textButton('have a code?').props.onPress());
 act(()=>tree.root.findByType(TextInput).props.onChangeText('SUNSET'));const apply=textButton('apply').props.onPress;
 act(()=>{void apply();void apply();});expect(mockQuote).toHaveBeenCalledTimes(1);expect(checkout().props.disabled).toBe(true);
 act(()=>labelled('more tickets').props.onPress());
 await act(async()=>response.resolve({ok:true,promoValid:true,totalCents:100,isFree:false}));
 expect(content()).not.toContain('SUNSET applied');expect(checkout().props.disabled).toBe(false);expect(mockQuote).toHaveBeenCalledWith('tier-a',1,'SUNSET',[]);
});
it('does not deliver an old account quote to the next account visit',async()=>{
 const response=deferred();mockQuote.mockReturnValue(response.promise);await mount();act(()=>textButton('have a code?').props.onPress());
 act(()=>tree.root.findByType(TextInput).props.onChangeText('OLD'));act(()=>{void textButton('apply').props.onPress();});
 await act(async()=>tree.update(<TicketCheckoutSheet {...props} owner={{userId:'next-buyer',isCurrent:()=>true}}/>));
 await act(async()=>response.resolve({ok:true,promoValid:true,totalCents:100,isFree:false}));
 expect(content()).not.toContain('OLD');expect(checkout().props.disabled).toBe(false);
});
it('uses the event capacity as the uncapped-tier quantity ceiling',async()=>{
 mockRemaining.mockResolvedValue(2);await mount();act(()=>labelled('more tickets').props.onPress());
 expect(labelled('more tickets').props.disabled).toBe(true);expect(labelled('fewer tickets').props.disabled).toBe(false);
});
it('does not select a visible tier outside its sales window',async()=>{
 mockTiers.mockResolvedValue([{...tier,sales_open_at:new Date(Date.now()+60000).toISOString()}]);await mount();
 expect(tierButton()).toBeUndefined();expect(checkout()).toBeUndefined();expect(content()).toContain('tickets are not on sale right now.');
});

it('does not dispatch checkout after the account retires during the pending-order read',async()=>{
 const response=deferred();mockPending.mockReturnValueOnce(response.promise);await mount();
 act(()=>{void checkout().props.onPress();});
 await act(async()=>tree.update(<TicketCheckoutSheet {...props} owner={{userId:'next-buyer',isCurrent:()=>true}}/>));
 await act(async()=>response.resolve(null));
 expect(mockStart).not.toHaveBeenCalled();expect(checkout().props.disabled).toBe(false);
});
it('does not open an old account order when its in-flight checkout returns',async()=>{
 const response=deferred();mockStart.mockReturnValueOnce(response.promise);await mount();
 await act(async()=>{void checkout().props.onPress();});expect(mockStart).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<TicketCheckoutSheet {...props} owner={{userId:'next-buyer',isCurrent:()=>true}}/>));
 await act(async()=>response.resolve({kind:'free',orderId:'old-account-order'}));
 expect(props.onOrderReady).not.toHaveBeenCalled();expect(checkout().props.disabled).toBe(false);
});

it('never dispatches when saving the attempt fails',async()=>{
 mockAttemptPrepare.mockRejectedValueOnce(new Error('Disk full'));await mount();
 await act(async()=>checkout().props.onPress());expect(mockStart).not.toHaveBeenCalled();
 expect(content()).toContain('We couldn’t confirm checkout');
});
it('uses the persisted key again after an uncertain response',async()=>{
 await mount();await act(async()=>checkout().props.onPress());
 expect(mockStart.mock.calls[0][2].checkoutKey).toBe(attempt.key);
 await act(async()=>checkout().props.onPress());expect(mockStart.mock.calls[1][2].checkoutKey).toBe(attempt.key);
 expect(mockAttemptFinish).not.toHaveBeenCalled();
});
it('recovers a completed purchase on reopen without dispatching another checkout',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockAttemptOrder.mockResolvedValue({id:'paid-order',status:'paid',event_id:'event-a',tier_id:'tier-a',qty:1});
 await mount();await act(async()=>labelled('Check saved checkout').props.onPress());
 expect(mockStart).not.toHaveBeenCalled();expect(props.onOrderReady).toHaveBeenCalledWith('paid-order');expect(mockAttemptFinish).toHaveBeenCalledTimes(1);
});
it('keeps recovery reachable when the saved tier is no longer on sale',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockTiers.mockResolvedValue([]);await mount();
 expect(checkout()).toBeUndefined();expect(labelled('Check saved checkout').props.disabled).toBe(false);
 await act(async()=>labelled('Check saved checkout').props.onPress());expect(mockAttemptFinish).not.toHaveBeenCalled();
});
it('blocks new checkout when the recovery record cannot be read',async()=>{
 mockAttemptRead.mockRejectedValueOnce(new Error('Corrupt'));await mount();expect(checkout().props.disabled).toBe(true);
 await act(async()=>labelled('Check saved checkout').props.onPress());expect(checkout().props.disabled).toBe(false);expect(mockStart).not.toHaveBeenCalled();
});

it('keeps a confirmed order recoverable when saving its return pointer fails',async()=>{
 mockStart.mockResolvedValueOnce({kind:'free',orderId:'confirmed-order'});
 jest.requireMock('../../../lib/pendingLink').stashPendingCheckout.mockRejectedValueOnce(new Error('Disk full'));
 await mount();await act(async()=>checkout().props.onPress());
 expect(props.onOrderReady).not.toHaveBeenCalled();expect(mockAttemptFinish).not.toHaveBeenCalled();
 expect(content()).toContain('Check its status before continuing.');
});

it('allows choosing again only after the backend confirms the stop',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockAttemptStop.mockResolvedValue({state:'stopped',orderId:null});await mount();
 await act(async()=>labelled('Change ticket selection').props.onPress());
 expect(content()).not.toContain('You have a checkout to finish.');expect(checkout().props.disabled).toBe(false);expect(mockStart).not.toHaveBeenCalled();
});
it('keeps an uncertain change visible and recoverable',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockAttemptStop.mockRejectedValue(Error('Lost response'));await mount();
 await act(async()=>labelled('Change ticket selection').props.onPress());
 expect(content()).toContain('Your saved checkout is still here');expect(labelled('Change ticket selection')).toBeDefined();expect(mockStart).not.toHaveBeenCalled();
});
it('opens an already-started order instead of allowing a second selection',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockAttemptStop.mockResolvedValue({state:'pending',orderId:'existing-order'});await mount();
 await act(async()=>labelled('Change ticket selection').props.onPress());
 expect(props.onOrderReady).toHaveBeenCalledWith('existing-order');expect(mockStart).not.toHaveBeenCalled();
});

it('discards the old quoted price after a confirmed selection change',async()=>{
 mockAttemptRead.mockResolvedValue(attempt);mockAttemptStop.mockResolvedValue({state:'stopped',orderId:null});
 mockQuote.mockResolvedValue({ok:true,promoValid:true,totalCents:100,isFree:false});await mount();
 const originalPrice=checkout().findAllByType(Text)[0].props.children.replace('Continue · ','pay ');
 act(()=>textButton('have a code?').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('SUNSET'));
 await act(async()=>textButton('apply').props.onPress());expect(textButton('Continue · $1.00')).toBeDefined();
 await act(async()=>labelled('Change ticket selection').props.onPress());
 expect(textButton('Continue · $1.00')).toBeUndefined();expect(textButton(originalPrice)).toBeDefined();
});

it('opens the original pending purchase instead of repeating changed quote/question validation',async()=>{
 mockAttemptOrder.mockResolvedValue({id:'original-pending-order',status:'pending',event_id:'event-a',tier_id:'tier-a',qty:1});await mount();
 await act(async()=>checkout().props.onPress());
 expect(props.onOrderReady).toHaveBeenCalledWith('original-pending-order');expect(mockStart).not.toHaveBeenCalled();expect(mockAttemptFinish).not.toHaveBeenCalled();
});

const extra={id:'extra-a',event_id:'event-a',name:'Picnic lunch',description:'Made fresh for the beach',price_cents:1200,quantity_cap:null,per_order_max:2,sold_count:0,status:'on_sale'};
function optionsFixture(){mockAddons.mockResolvedValue([extra]);mockVariations.mockResolvedValue(new Map([['extra-a',[{id:'vegetarian',label:'Vegetarian'},{id:'vegan',label:'Vegan'}]]]));}
it('requires an explicit option for a selected extra and carries it through saved attempt and checkout',async()=>{
 optionsFixture();await mount();act(()=>labelled('more Picnic lunch').props.onPress());expect(checkout().props.disabled).toBe(true);
 act(()=>labelled('Picnic lunch: Vegan').props.onPress());expect(checkout().props.disabled).toBe(false);expect(labelled('Picnic lunch: Vegan').props.accessibilityState.checked).toBe(true);
 await act(async()=>checkout().props.onPress());expect(mockAttemptPrepare.mock.calls[0][0].addons).toEqual([{add_on_id:'extra-a',qty:1,variation_id:'vegan'}]);expect(mockStart.mock.calls[0][2].addons).toEqual([{add_on_id:'extra-a',qty:1,variation_id:'vegan'}]);
});
it('restores the exact saved option instead of silently choosing the first one',async()=>{
 optionsFixture();mockAttemptRead.mockResolvedValue({...attempt,addons:[{add_on_id:'extra-a',qty:1,variation_id:'vegan'}]});await mount();expect(labelled('Picnic lunch: Vegan').props.accessibilityState.checked).toBe(true);expect(labelled('Picnic lunch: Vegetarian').props.accessibilityState.checked).toBe(false);
});
it('keeps the original no-option payload unchanged and respects extra quantity limits',async()=>{
 mockAddons.mockResolvedValue([extra]);await mount();act(()=>labelled('more Picnic lunch').props.onPress());act(()=>labelled('more Picnic lunch').props.onPress());expect(labelled('more Picnic lunch').props.disabled).toBe(true);
 await act(async()=>checkout().props.onPress());expect(mockStart.mock.calls[0][2].addons).toEqual([{add_on_id:'extra-a',qty:2}]);
});
it('does not submit invisible extras after choosing a free tier',async()=>{
 optionsFixture();mockTiers.mockResolvedValue([tier,{...tier,id:'free',name:'Free entry',price_cents:0}]);await mount();act(()=>labelled('more Picnic lunch').props.onPress());act(()=>labelled('Picnic lunch: Vegan').props.onPress());
 const free=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='Free entry'))!;act(()=>free.props.onPress());await act(async()=>checkout().props.onPress());expect(mockAttemptPrepare.mock.calls[0][0].addons).toEqual([]);expect(mockStart.mock.calls[0][2].addons).toEqual([]);
});
