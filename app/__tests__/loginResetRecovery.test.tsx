import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import {Text,TextInput,TouchableOpacity,Modal,Platform} from 'react-native';
import Login from '../(auth)/login';
import {BrandedAlert} from '../../components/BrandedAlert';
const mockLogin=jest.fn(),mockReset=jest.fn();
const mockFocusContext=React.createContext(true); let mockFocused=true;
import {postAuthTransitionRef} from '../../lib/navState';
jest.mock('../../lib/supabase',()=>({supabase:{auth:{signInWithPassword:(...a:any[])=>mockLogin(...a),resetPasswordForEmail:(...a:any[])=>mockReset(...a)}}}));
jest.mock('../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../components/BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('expo-router',()=>({router:{replace:jest.fn(),back:jest.fn(),canGoBack:()=>true},useFocusEffect:(cb:any)=>{const R=require('react');const f=R.useContext(mockFocusContext);R.useEffect(()=>f?cb():undefined,[f,cb])}}));
jest.mock('expo-image',()=>({Image:()=>null}));
jest.mock('react-native-safe-area-context',()=>require('react-native-safe-area-context/jest/mock').default);
let tree:ReactTestRenderer;
const screen=()=> <mockFocusContext.Provider value={mockFocused}><Login/></mockFocusContext.Provider>;
const redraw=async()=>{act(()=>tree.update(screen()));await flush()};
const flush=async()=>{await act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()})};
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===({'log in':'Log in','send reset link':'Send reset link'} as Record<string,string>)[label] && !!n.props.accessibilityLabel || n.findAllByType(Text).some(t=>t.props.children===label))!;
const deferred=()=>{let resolve!:(v:any)=>void;return {promise:new Promise(r=>resolve=r),resolve:(v:any)=>resolve(v)}};
const openReset=()=>{act(()=>button('forgot password?').props.onPress());act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.placeholder==='email address'&&n.props.returnKeyType==='done')!.props.onChangeText('fixture@example.invalid'))};
beforeEach(()=>{jest.clearAllMocks();mockFocused=true;postAuthTransitionRef.active=false;mockLogin.mockResolvedValue({error:null});mockReset.mockResolvedValue({error:null});act(()=>{tree=create(screen())});});
afterEach(()=>act(()=>tree.unmount()));
it('dispatches only one email reset for a rapid duplicate tap',async()=>{openReset();const p=deferred();mockReset.mockReturnValue(p.promise);const cb=button('send reset link').props.onPress;act(()=>{cb();cb()});await flush();expect(mockReset).toHaveBeenCalledTimes(1);p.resolve({error:null});await flush();});
it('does not reopen confirmation after cancelling an outstanding reset',async()=>{openReset();const p=deferred();mockReset.mockReturnValue(p.promise);act(()=>{button('send reset link').props.onPress()});act(()=>button('cancel').props.onPress());p.resolve({error:null});await flush();expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false)});
it('waits for the reset sheet dismissal before showing confirmation',async()=>{openReset();await act(async()=>{await button('send reset link').props.onPress()});expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);act(()=>tree.root.findByType(Modal).props.onDismiss());expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true)});
it('handles a thrown reset failure with retry feedback',async()=>{openReset();mockReset.mockRejectedValueOnce(new Error('offline'));let caught:any;await act(async()=>{try{await button('send reset link').props.onPress()}catch(e){caught=e}});expect(caught).toBeUndefined();expect(tree.root.findAllByType(Text).some(n=>String(n.props.children).includes('try again'))).toBe(true)});

const fillLogin=()=>act(()=>{const inputs=tree.root.findAllByType(TextInput);inputs.find(n=>n.props.placeholder==='email address'&&n.props.returnKeyType==='next')!.props.onChangeText('fixture@example.invalid');inputs.find(n=>n.props.placeholder==='password')!.props.onChangeText('fictional-test-only')});
it('dispatches only one sign-in for keyboard and button submit',async()=>{fillLogin();const p=deferred();mockLogin.mockReturnValue(p.promise);act(()=>{button('log in').props.onPress();tree.root.findAllByType(TextInput).find(n=>n.props.placeholder==='password')!.props.onSubmitEditing()});await flush();expect(mockLogin).toHaveBeenCalledTimes(1);p.resolve({error:null});await flush()});
it('handles a thrown sign-in failure with retry feedback',async()=>{fillLogin();mockLogin.mockRejectedValueOnce(new Error('offline'));let caught:any;await act(async()=>{try{await button('log in').props.onPress()}catch(e){caught=e}});expect(caught).toBeUndefined();expect(tree.root.findAllByType(Text).some(n=>String(n.props.children).includes('try again'))).toBe(true)});
it('does not arm a transition from a sign-in response after unmount',async()=>{fillLogin();const p=deferred();mockLogin.mockReturnValue(p.promise);act(()=>{button('log in').props.onPress()});act(()=>tree.unmount());p.resolve({error:null});await flush();expect(postAuthTransitionRef.active).toBe(false)});

it('preserves rate-limit feedback and the reset email for retry',async()=>{
 openReset();mockReset.mockResolvedValueOnce({error:{message:'Rate limit: retry in 60 seconds'}});
 await act(async()=>{await button('send reset link').props.onPress()});
 expect(tree.root.findAllByType(Text).some(n=>String(n.props.children).includes('wait a minute'))).toBe(true);
 expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Password reset email')!.props.value).toBe('fixture@example.invalid');
 await act(async()=>{await button('send reset link').props.onPress()});expect(mockReset).toHaveBeenCalledTimes(2);
 expect(mockReset).toHaveBeenLastCalledWith('fixture@example.invalid',{redirectTo:'washedupapp://auth/callback'});
});
it('cannot reuse an old send callback after cancelling and reopening',async()=>{
 openReset();const oldSend=button('send reset link').props.onPress;act(()=>button('cancel').props.onPress());act(()=>tree.root.findByType(Modal).props.onDismiss());openReset();
 await act(async()=>{await oldSend()});expect(mockReset).not.toHaveBeenCalled();
});
it('keeps an outstanding reset locked across cancel and reopen until it settles',async()=>{
 openReset();const p=deferred();mockReset.mockReturnValueOnce(p.promise);act(()=>{button('send reset link').props.onPress()});act(()=>button('cancel').props.onPress());act(()=>tree.root.findByType(Modal).props.onDismiss());openReset();
 await act(async()=>{await button('send reset link').props.onPress()});expect(mockReset).toHaveBeenCalledTimes(1);
 p.resolve({error:null});await flush();expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);expect(button('send reset link').props.disabled).toBe(false);
 await act(async()=>{await button('send reset link').props.onPress()});expect(mockReset).toHaveBeenCalledTimes(2);
});
it('retires reset confirmation when the screen loses focus before dismissal',async()=>{
 openReset();await act(async()=>{await button('send reset link').props.onPress()});const dismiss=tree.root.findByType(Modal).props.onDismiss;
 mockFocused=false;await redraw();act(()=>dismiss());mockFocused=true;await redraw();expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});
it('keeps a sign-in locked across refocus and ignores its late local continuation',async()=>{
 fillLogin();const p=deferred();mockLogin.mockReturnValueOnce(p.promise);act(()=>{button('log in').props.onPress()});mockFocused=false;await redraw();mockFocused=true;await redraw();fillLogin();
 act(()=>{button('log in').props.onPress()});expect(mockLogin).toHaveBeenCalledTimes(1);p.resolve({error:null});await flush();expect(postAuthTransitionRef.active).toBe(false);expect(button('log in').props.disabled).toBe(false);
});
it('ignores a retained sign-in callback from the previous focus visit',async()=>{
 fillLogin();const oldLogin=button('log in').props.onPress;mockFocused=false;await redraw();mockFocused=true;await redraw();await act(async()=>{await oldLogin()});expect(mockLogin).not.toHaveBeenCalled();
});
it('shows Android reset confirmation after the hidden sheet state commits',async()=>{
 const os=Platform.OS;Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
 try{openReset();await act(async()=>{await button('send reset link').props.onPress()});expect(tree.root.findByType(Modal).props.visible).toBe(false);expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true)}
 finally{Object.defineProperty(Platform,'OS',{configurable:true,value:os})}
});

it('ignores an old sheet dismissal while a newer reset confirmation waits',async()=>{
 openReset();const oldDismiss=tree.root.findByType(Modal).props.onDismiss;act(()=>button('cancel').props.onPress());act(()=>oldDismiss());openReset();
 await act(async()=>{await button('send reset link').props.onPress()});act(()=>oldDismiss());expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);
 act(()=>tree.root.findByType(Modal).props.onDismiss());expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
});
