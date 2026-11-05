import React from 'react';
import { act, create } from 'react-test-renderer';
import { Pressable, Text, TextInput, ScrollView } from 'react-native';
import PostPlanSurveyV3 from '../PostPlanSurveyV3';
import type { SurveyProps, SurveyMember } from '../../../PostPlanSurvey';
const mockRpc=jest.fn(),mockAuth=jest.fn(),mockHandled=jest.fn(),mockComplete=jest.fn();
let mockPeople=true;
jest.mock('../../../../lib/supabase',()=>({supabase:{rpc:(...args:any[])=>mockRpc(...args),auth:{getUser:()=>mockAuth()}}}));
jest.mock('../../../PostPlanSurvey',()=>({markPostPlanSurveyHandled:(...args:any[])=>mockHandled(...args)}));
jest.mock('../../../../lib/haptics',()=>({hapticSelection:jest.fn(),hapticSuccess:jest.fn()}));
jest.mock('../../../../constants/FeatureFlags',()=>({get YOURS_PAGE_ENABLED(){return mockPeople;}}));
jest.mock('../../a11y/useReduceMotion',()=>({useReduceMotion:()=>true}));
jest.mock('../../primitives/YoursAvatar',()=>()=>null);
jest.mock('expo-image',()=>({Image:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:({children}:any)=>children,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
const member=(id:string,name:string,extra:Partial<SurveyMember>={}):SurveyMember=>({id,first_name_display:name,profile_photo_url:null,is_stranger:false,is_creator:false,keep_state:'none',...extra});
let props:SurveyProps,tree:ReturnType<typeof create>;
function mount(extra:Partial<SurveyProps>={}){props={visible:true,userId:'me',plan:{id:'plan',title:'A walk',image_url:null,circle_id:null,is_featured:false,any_stranger_joined:false,creator_user_id:'alex'},members:[member('me','Me'),member('alex','Alex',{is_creator:true}),member('bea','Bea'),member('cal','Cal')],onComplete:mockComplete,...extra};act(()=>{tree=create(<PostPlanSurveyV3 {...props}/>);});}
function update(){act(()=>tree.update(<PostPlanSurveyV3 {...props}/>));}
function control(label:string){return tree.root.findAll(n=>typeof n.props.onPress==='function').find(n=>n.props.accessibilityLabel===label || n.findAllByType(Text).some(t=>t.props.children===label))!;}
function press(label:string){act(()=>{const node=control(label);if(!node)throw new Error('Missing control: '+label);node.props.onPress();});}
function words(){return tree.root.findAllByType(Text).map(t=>t.props.children).join(' ');}
function reports(){return mockRpc.mock.calls.filter(([name])=>name==='report_no_show');}
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return {promise,resolve};}
async function flush(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});}
function attendance(){press('Really good');press('Continue');}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockPeople=true;mockRpc.mockReset().mockResolvedValue({data:null,error:null});mockAuth.mockReset().mockResolvedValue({data:{user:{id:'me'}},error:null});mockHandled.mockResolvedValue(undefined);});
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllTimers();jest.useRealTimers();});

it('starts unanswered, with three explicit choices and no presumed attendance',()=>{
 mount();attendance();expect(words()).toContain('Did these people attend?');
 const choices=tree.root.findAll(n=>typeof n.props.onPress==='function' && n.props.accessibilityRole==='radio');expect(choices).toHaveLength(9);expect(choices.every(n=>n.props.accessibilityState.checked===false)).toBe(true);
 expect(words()).not.toContain('marked as there');expect(words()).not.toContain('went');expect(reports()).toEqual([]);
});
it('submits only the final explicitly selected no-show and shows the count before submission',async()=>{
 mount();attendance();press('Alex: Didn’t show up');expect(words()).toContain('1 person marked ‘Didn’t show up.’');
 press('Alex: Was there');expect(control('Alex: Was there').props.accessibilityState.checked).toBe(true);expect(control('Alex: Didn’t show up').props.accessibilityState.checked).toBe(false);
 press('Alex: Not sure');press('Bea: Didn’t show up');expect(reports()).toEqual([]);press('Continue');await flush();
 expect(reports()).toEqual([['report_no_show',{p_event_id:'plan',p_no_show_user_id:'bea'}]]);
 expect(words()).toContain('Want to keep in touch?');expect(control('Keep in touch with Alex')).toBeDefined();expect(control('Keep in touch with Cal')).toBeDefined();expect(control('Keep in touch with Bea')).toBeUndefined();
});
it('unanswered and Not sure never create attendance or no-show writes for those people',async()=>{
 mount();attendance();press('Alex: Not sure');press('Continue');await flush();expect(reports()).toEqual([]);expect(mockRpc.mock.calls.map(([name])=>name)).toEqual(['upsert_plan_feedback']);expect(control('Keep in touch with Alex')).toBeDefined();
});
it('skips selected but unsubmitted answers without reports and retains keep-in-touch choices',async()=>{
 mount();attendance();press('Alex: Didn’t show up');press('Skip attendance');await flush();expect(reports()).toEqual([]);expect(control('Keep in touch with Alex')).toBeDefined();
});
it('Not now always exits without submitting selected answers',async()=>{
 mount();attendance();press('Alex: Didn’t show up');press('Not now');await flush();expect(reports()).toEqual([]);expect(mockHandled).toHaveBeenCalledWith('plan');expect(mockComplete).toHaveBeenCalledTimes(1);
});
it('reports failures visibly and retries only reports without a success receipt',async()=>{
 let fail=true;mockRpc.mockImplementation((name,args)=>Promise.resolve(name==='report_no_show' && args.p_no_show_user_id==='bea' && fail ? {error:new Error('offline')} : {data:null,error:null}));
 mount();attendance();press('Alex: Didn’t show up');press('Bea: Didn’t show up');press('Continue');await flush();
 expect(words()).toContain('Some no-show reports couldn’t be submitted');expect(control('Alex: Was there').props.disabled).toBe(true);expect(mockComplete).not.toHaveBeenCalled();
 fail=false;press('Try again');await flush();expect(reports().map(([,args])=>args.p_no_show_user_id)).toEqual(['alex','bea','bea']);expect(words()).toContain('Want to keep in touch?');
});
it('blocks duplicate submissions synchronously and keeps skipping available while pending',async()=>{
 const pending=deferred();mockRpc.mockImplementation(name=>name==='report_no_show'?pending.promise:Promise.resolve({data:null,error:null}));
 mount();attendance();press('Alex: Didn’t show up');const submit=control('Continue').props.onPress;act(()=>{submit();submit();});await flush();expect(reports()).toHaveLength(1);expect(control('Continue').props.disabled).toBe(true);
 press('Skip remaining attendance reports');expect(words()).toContain('Want to keep in touch?');pending.resolve({data:null,error:new Error('late')});await flush();expect(words()).not.toContain('Some no-show reports');expect(mockComplete).not.toHaveBeenCalled();
});
it('bounds a stalled report, keeps the submitted choice stable, and makes retry available',async()=>{
 mockRpc.mockImplementation(name=>name==='report_no_show'?new Promise(()=>{}):Promise.resolve({data:null,error:null}));mount();attendance();const oldAnswer=control('Alex: Was there').props.onPress;press('Alex: Didn’t show up');press('Continue');await flush();
 await act(async()=>{await jest.advanceTimersByTimeAsync(8000);});expect(control('Try again')).toBeDefined();act(()=>oldAnswer());expect(control('Alex: Didn’t show up').props.accessibilityState.checked).toBe(true);
});
it('leaving during authentication prevents reports and a late response from reopening the flow',async()=>{
 const auth=deferred();mockAuth.mockReturnValue(auth.promise);mount();attendance();press('Alex: Didn’t show up');press('Continue');press('Not now');auth.resolve({data:{user:{id:'me'}},error:null});await flush();expect(reports()).toEqual([]);expect(mockComplete).toHaveBeenCalledTimes(1);
});
it('requires the expected reporter account before dispatch',async()=>{
 mockAuth.mockResolvedValue({data:{user:{id:'other'}},error:null});mount();attendance();press('Alex: Didn’t show up');press('Continue');await flush();expect(reports()).toEqual([]);expect(control('Try again')).toBeDefined();
});
it('resets answers on reopening or changing the plan',()=>{
 mount();attendance();press('Alex: Didn’t show up');props.visible=false;update();props.visible=true;update();attendance();expect(control('Alex: Didn’t show up').props.accessibilityState.checked).toBe(false);
 props.plan={...props.plan,id:'another'};update();attendance();expect(control('Alex: Didn’t show up').props.accessibilityState.checked).toBe(false);
});
it.each(['featured','closed-circle','solo'])('preserves attendance exclusion for %s',kind=>{
 mount();props.plan={...props.plan,is_featured:kind==='featured',circle_id:kind==='closed-circle'?'circle':null};if(kind==='solo')props.members=[member('me','Me')];update();attendance();expect(words()).not.toContain('Did these people attend?');expect(reports()).toEqual([]);
});
it('an open Circle asks only about strangers and its creator, preserving relationship eligibility',()=>{
 mount();props.plan={...props.plan,circle_id:'circle',any_stranger_joined:true};props.members=[member('me','Me'),member('alex','Alex',{is_creator:true}),member('bea','Bea'),member('cal','Cal',{is_stranger:true,keep_state:'blocked'})];update();attendance();expect(control('Alex: Was there')).toBeDefined();expect(control('Bea: Was there')).toBeUndefined();expect(control('Cal: Was there')).toBeDefined();press('Skip attendance');expect(control('Keep in touch with Alex')).toBeDefined();expect(control('Keep in touch with Cal')).toBeUndefined();
});
it('deduplicates rating and keep-in-touch submissions without treating unknown attendance as confirmation',async()=>{
 mockRpc.mockImplementation(name=>Promise.resolve({data:name==='add_or_accept_person'?'requested':null,error:null}));mount();press('Really good');const next=control('Continue').props.onPress;act(()=>{next();next();});expect(mockRpc.mock.calls.filter(([name])=>name==='upsert_plan_feedback')).toHaveLength(1);
 press('Skip attendance');const add=control('Add them').props.onPress;act(()=>{add();add();});await flush();act(()=>add());await flush();expect(mockRpc.mock.calls.filter(([name])=>name==='add_or_accept_person')).toHaveLength(3);expect(reports()).toEqual([]);expect(words()).toContain("Request sent. They'll see it.");
});
it('keeps exit available when feedback or keep-in-touch requests fail',async()=>{
 mockRpc.mockRejectedValue(new Error('offline'));mount();attendance();press('Skip attendance');press('Add them');await flush();expect(words()).toContain("Couldn't add everyone just now.");press('Not now');expect(mockComplete).toHaveBeenCalledTimes(1);
});
it('can submit attendance and close when the People feature is disabled',async()=>{
 mockPeople=false;mount();attendance();press('Alex: Didn’t show up');press('Continue');await flush();expect(reports()).toHaveLength(1);expect(mockComplete).toHaveBeenCalledTimes(1);
});

it('keeps the focused comment in view as the keyboard resizes the body, without stealing later scrolling',()=>{
 mount();press('Not great');
 const input=tree.root.findByType(TextInput),body=tree.root.findByType(ScrollView);
 const scroll=jest.spyOn(body.instance,'scrollToEnd').mockImplementation(()=>{});
 act(()=>input.props.onFocus());expect(scroll).toHaveBeenCalledWith({animated:false});scroll.mockClear();
 act(()=>body.props.onLayout());expect(scroll).toHaveBeenCalledTimes(1);
 act(()=>input.props.onChangeText('Keep my comment'));act(()=>input.props.onBlur());scroll.mockClear();
 act(()=>body.props.onLayout());expect(scroll).not.toHaveBeenCalled();expect(tree.root.findByType(TextInput).props.value).toBe('Keep my comment');
 act(()=>input.props.onFocus());press('Continue');scroll.mockClear();
 act(()=>tree.root.findByType(ScrollView).props.onLayout());expect(scroll).not.toHaveBeenCalled();
 expect(mockRpc).toHaveBeenCalledWith('upsert_plan_feedback',expect.objectContaining({p_rating:'thumbs_down',p_comment:'Keep my comment'}));expect(words()).toContain('Did these people attend?');
});

it.each([null, undefined, 'unknown_receipt', { outcome: 'requested' }, ['requested'], ['now_connected']])('does not confirm a keep-in-touch result from malformed receipt %p', async data => {
 mockRpc.mockImplementation(name=>Promise.resolve({data:name==='add_or_accept_person'?data:null,error:null}));
 mount();attendance();press('Skip attendance');press('Add them');await flush();
 expect(words()).toContain("Couldn't add everyone just now.");
 expect(words()).not.toContain("Request sent. They'll see it.");
 expect(words()).not.toContain('You both said yes.');
 expect(mockComplete).not.toHaveBeenCalled();
 expect(mockRpc.mock.calls.filter(([name])=>name==='add_or_accept_person')).toHaveLength(3);
});
it('preserves confirmed requests while disclosing an unconfirmed person in the same submission', async()=>{
 mockRpc.mockImplementation((name,args)=>Promise.resolve({data:name==='add_or_accept_person'?(args.p_target==='alex'?'requested':null):null,error:null}));
 mount();attendance();press('Skip attendance');press('Add them');await flush();
 expect(words()).toContain("Request sent. They'll see it.");
 expect(words()).toContain("Couldn't add everyone just now.");
});
it('keeps the confirmed already-connected receipt as a quiet completion', async()=>{
 mockRpc.mockImplementation(name=>Promise.resolve({data:name==='add_or_accept_person'?'already_connected':null,error:null}));
 mount();attendance();press('Skip attendance');press('Add them');await flush();
 expect(mockComplete).toHaveBeenCalledTimes(1);
 expect(words()).not.toContain("Couldn't add everyone just now.");
});
