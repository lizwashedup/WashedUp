import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {TextInput,TouchableOpacity} from 'react-native';
const mockLoad=jest.fn(),mockPick=jest.fn(),mockKeepPhoto=jest.fn(),mockUploadPhoto=jest.fn(),mockClearPhoto=jest.fn();
jest.mock('../../../lib/creatorAddonPhoto',()=>({keepCreatorAddonPhoto:(...a:unknown[])=>mockKeepPhoto(...a),uploadCreatorAddonPhoto:(...a:unknown[])=>mockUploadPhoto(...a),clearCreatorAddonPhoto:(...a:unknown[])=>mockClearPhoto(...a)}));
const mockMemory=new Map<string,string>();
const mockWrite=jest.fn(async(k:string,v:string)=>{mockMemory.set(k,v);});
const mockRemove=jest.fn(async(k:string)=>{mockMemory.delete(k);});
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:async(k:string)=>mockMemory.get(k)??null,setItem:(...args:[string,string])=>mockWrite(...args),removeItem:(k:string)=>mockRemove(k)}}));
jest.mock('../../../lib/creatorAddonEditor',()=>({...jest.requireActual('../../../lib/creatorAddonEditor'),loadCreatorAddon:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/creatorEvents',()=>({pickAndUploadEventImage:(...a:unknown[])=>mockPick(...a)}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('expo-crypto',()=>({randomUUID:jest.fn().mockReturnValueOnce('44444444-4444-4444-8444-444444444444').mockReturnValue('44444444-4444-4444-8444-444444444444')}));
import {AddonEditorSheet} from '../AddonEditorSheet';
import {CreatorAddonRejected,CreatorAddonChanged} from '../../../lib/creatorAddonEditor';
let current=true,tree:ReactTestRenderer;
const scope={userId:'33333333-3333-4333-8333-333333333333',isCurrent:()=>current};
const row={id:'55555555-5555-4555-8555-555555555555',event_id:'11111111-1111-4111-8111-111111111111',name:'Picnic',price_cents:1200,description:null,image_url:null,quantity_cap:10,per_order_max:2,sold_count:0,status:'draft' as const,sales_open_at:null,sales_close_at:null,variations:[{id:'old-choice',label:'Vegan'}]};
const save=jest.fn(),close=jest.fn();
const props={visible:true,eventId:'11111111-1111-4111-8111-111111111111',scope,addon:null,busy:false,onSave:save,onClose:close};
const field=(name:string)=>tree.root.findAllByType(TextInput).find(x=>x.props.accessibilityLabel===name)!;
const button=(name:string)=>tree.root.findAllByType(TouchableOpacity).find(x=>x.props.accessibilityLabel===name)!;
const text=()=>JSON.stringify(tree.toJSON());
async function mount(extra:any=null){await act(async()=>{tree=create(<AddonEditorSheet {...props} addon={extra}/>);});}
beforeEach(()=>{jest.clearAllMocks();mockMemory.clear();current=true;mockLoad.mockResolvedValue(row);save.mockResolvedValue(undefined);mockKeepPhoto.mockResolvedValue({id:'66666666-6666-4666-8666-666666666666',uri:'file:///kept-photo.jpg'});mockUploadPhoto.mockResolvedValue('https://example.test/extra.jpg');mockClearPhoto.mockResolvedValue(undefined);});
afterEach(()=>act(()=>tree?.unmount()));
it('loads saved options before editing and retains existing IDs when labels change',async()=>{
 await mount(row);expect(field('Option 1').props.value).toBe('Vegan');act(()=>field('Option 1').props.onChangeText('Plant-based'));
 await act(async()=>button('Save extra').props.onPress());expect(save.mock.calls[0][0].variations).toEqual([{id:'old-choice',label:'Plant-based'}]);expect(save.mock.calls[0][1]).toBe('55555555-5555-4555-8555-555555555555');
});
it('read failure cannot become an empty-options overwrite, then retry loads the saved row',async()=>{
 mockLoad.mockRejectedValueOnce(Error('offline'));await mount(row);expect(button('Save extra')).toBeUndefined();expect(field('Extra name')).toBeUndefined();expect(text()).toContain('couldn’t be loaded');
 const retry=tree.root.findAllByType(TouchableOpacity).find(x=>x.findAllByType(require('react-native').Text).some(t=>t.props.children==='Try again'))!;
 await act(async()=>retry.props.onPress());expect(field('Option 1').props.value).toBe('Vegan');expect(button('Save extra').props.disabled).toBe(false);
});
it('keeps a new extra ID and draft through save failure; options and row go in one submission',async()=>{
 save.mockRejectedValueOnce(Error('offline'));await mount();act(()=>field('Extra name').props.onChangeText('Beach lunch'));act(()=>button('Add an option').props.onPress());expect(button('Save extra').props.disabled).toBe(true);act(()=>field('Option 1').props.onChangeText('Vegetarian'));
 await act(async()=>button('Save extra').props.onPress());expect(text()).toContain('Your draft is kept');expect(field('Option 1').props.value).toBe('Vegetarian');
 await act(async()=>button('Save extra').props.onPress());expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);expect(save.mock.calls[1][0].status).toBe('draft');expect(save.mock.calls[1][0].variations[0].label).toBe('Vegetarian');
});
it('prevents double saves and blocks closing while saving',async()=>{
 let finish!:(v:unknown)=>void;save.mockReturnValue(new Promise(r=>{finish=r;}));await mount(row);const press=button('Save extra').props.onPress;let pending:Promise<void>;
 act(()=>{pending=press();void press();button('Close extra editor').props.onPress();});await act(async()=>{await Promise.resolve();});expect(save).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();await act(async()=>{finish(undefined);await pending;});
});
it.each(['-1','abc','1.234'])('does not turn malformed price %s into another amount',async price=>{
 await mount(row);act(()=>field('Extra price').props.onChangeText(price));expect(button('Save extra').props.disabled).toBe(true);expect(save).not.toHaveBeenCalled();
});
it('retires a late read after account change',async()=>{
 let finish!:(v:any)=>void;mockLoad.mockReturnValue(new Promise(r=>{finish=r;}));await mount(row);current=false;await act(async()=>finish(row));expect(field('Extra name')).toBeUndefined();expect(save).not.toHaveBeenCalled();
});

it('restores incomplete values and photo after close and remount without a save',async()=>{
 await mount();act(()=>{field('Extra name').props.onChangeText('Beach lunch');field('Extra price').props.onChangeText('1.');button('Add an option').props.onPress();});
 mockPick.mockImplementationOnce(async(_guard,upload)=>upload('file:///selected.jpg'));await act(async()=>button('Add extra photo').props.onPress());
 await act(async()=>button('Close extra editor').props.onPress());expect(close).toHaveBeenCalledTimes(1);act(()=>tree.unmount());await mount();expect(button('Change extra photo')).toBeDefined();
 expect(field('Extra name').props.value).toBe('Beach lunch');expect(field('Extra price').props.value).toBe('1.');expect(field('Option 1').props.value).toBe('');expect(save).not.toHaveBeenCalled();
});
it('reopening an uncertain save restores immutable fields and checks the original ID without replay',async()=>{
 save.mockRejectedValueOnce(Error('lost'));await mount();act(()=>field('Extra name').props.onChangeText('Blanket'));
 await act(async()=>button('Save extra').props.onPress());const first=save.mock.calls[0];
 act(()=>field('Extra name').props.onChangeText('Changed'));expect(field('Extra name').props.value).toBe('Blanket');expect(field('Extra name').props.editable).toBe(false);
 await act(async()=>button('Close extra editor').props.onPress());act(()=>tree.unmount());await mount();expect(save).toHaveBeenCalledTimes(1);
 await act(async()=>button('Check extra save').props.onPress());expect(save.mock.calls[1]).toEqual([first[0],first[1],false,null,expect.objectContaining({beforeDispatch:expect.any(Function)})]);expect(mockMemory.size).toBe(0);
});
it('refuses dispatch and closing after device writes fail, then retries the original request',async()=>{
 await mount();mockWrite.mockRejectedValue(Error('storage'));act(()=>field('Extra name').props.onChangeText('Blanket'));
 await act(async()=>button('Save extra').props.onPress());expect(save).not.toHaveBeenCalled();await act(async()=>button('Close extra editor').props.onPress());expect(close).not.toHaveBeenCalled();
 mockWrite.mockImplementation(async(k,v)=>{mockMemory.set(k,v);});await act(async()=>button('Save extra').props.onPress());expect(save).toHaveBeenCalledTimes(1);
});
it('a saved extra with failed device cleanup finishes without another save',async()=>{
 mockRemove.mockRejectedValueOnce(Error('storage'));await mount();act(()=>field('Extra name').props.onChangeText('Blanket'));await act(async()=>button('Save extra').props.onPress());expect(close).not.toHaveBeenCalled();expect(save).toHaveBeenCalledTimes(1);
 act(()=>tree.unmount());await mount();await act(async()=>button('Save extra').props.onPress());expect(save).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(mockMemory.size).toBe(0);
});

it('an immediate unmount waits for every queued field write before restoring',async()=>{
 await mount();let unblock!:()=>void;const gate=new Promise<void>(r=>{unblock=r;});mockWrite.mockImplementationOnce(async(k,v)=>{await gate;mockMemory.set(k,v);});
 act(()=>{field('Extra name').props.onChangeText('First');field('Extra name').props.onChangeText('Latest');field('Extra price').props.onChangeText('12.');tree.unmount();});
 await mount();expect(field('Extra name')).toBeUndefined();await act(async()=>unblock());expect(field('Extra name').props.value).toBe('Latest');expect(field('Extra price').props.value).toBe('12.');
});

it('a known refusal restores editable retained fields with the original ID',async()=>{
 save.mockImplementationOnce(async(_draft,_id,_write,_baseline,dispatch)=>{expect(dispatch.previouslyDispatched).toBe(false);expect(await dispatch.beforeDispatch()).toBe(true);throw new CreatorAddonRejected('Review the quantity.');});
 await mount();act(()=>field('Extra name').props.onChangeText('Blanket'));await act(async()=>button('Save extra').props.onPress());expect(field('Extra name').props.editable).toBe(true);expect(text()).toContain('Review the quantity.');const id=save.mock.calls[0][1];
 act(()=>field('Available quantity').props.onChangeText('10'));await act(async()=>button('Save extra').props.onPress());expect(save.mock.calls[1][1]).toBe(id);expect(save.mock.calls[1][0].quantity_cap).toBe(10);expect(save.mock.calls[1][4].previouslyDispatched).toBe(false);
});
it('a reopened dispatched attempt carries uncertainty into retry',async()=>{
 save.mockImplementationOnce(async(_draft,_id,_write,_baseline,dispatch)=>{await dispatch.beforeDispatch();throw Error('lost reply');});await mount();act(()=>field('Extra name').props.onChangeText('Blanket'));await act(async()=>button('Save extra').props.onPress());act(()=>tree.unmount());await mount();await act(async()=>button('Save extra').props.onPress());expect(save.mock.calls[1][4].previouslyDispatched).toBe(true);
});
it('using a fresh conflicting saved version is explicit and does not write',async()=>{
 const changed={...row,name:'Team blanket',variations:[{id:'kept-choice',label:'Blue'}]};save.mockImplementationOnce(async(_draft,_id,_write,_baseline,dispatch)=>{await dispatch.beforeDispatch();throw new CreatorAddonChanged(changed as any);});await mount(row);act(()=>field('Extra name').props.onChangeText('My blanket'));await act(async()=>button('Save extra').props.onPress());expect(field('Extra name').props.value).toBe('My blanket');
 await act(async()=>button('Use saved extra').props.onPress());expect(field('Extra name').props.value).toBe('Team blanket');expect(field('Option 1').props.value).toBe('Blue');expect(field('Extra name').props.editable).toBe(true);expect(save).toHaveBeenCalledTimes(1);
});

it('keeps the previous image and original selected photo through upload failure and return',async()=>{
 const withPhoto={...row,image_url:'https://example.test/old.jpg'};mockLoad.mockResolvedValue(withPhoto);mockPick.mockImplementationOnce(async(_guard,upload)=>upload('file:///selected.jpg'));mockUploadPhoto.mockRejectedValueOnce(Error('Connection lost'));
 await mount(withPhoto);await act(async()=>button('Change extra photo').props.onPress());expect(button('Save extra').props.disabled).toBe(true);expect(text()).toContain('Connection lost');expect(text()).toContain('https://example.test/old.jpg');const original=mockUploadPhoto.mock.calls[0][1];
 await act(async()=>button('Close extra editor').props.onPress());act(()=>tree.unmount());await mount(withPhoto);expect(mockUploadPhoto).toHaveBeenCalledTimes(1);await act(async()=>button('Retry extra photo').props.onPress());expect(mockUploadPhoto.mock.calls[1][1]).toEqual(original);expect(mockPick).toHaveBeenCalledTimes(1);expect(mockClearPhoto).toHaveBeenCalledTimes(1);expect(button('Save extra').props.disabled).toBe(false);
});
it('does not upload before the selected original is durably retained',async()=>{
 await mount();mockPick.mockImplementationOnce(async(_guard,upload)=>upload('file:///selected.jpg'));mockWrite.mockRejectedValueOnce(Error('full'));await act(async()=>button('Add extra photo').props.onPress());expect(mockUploadPhoto).not.toHaveBeenCalled();expect(button('Retry extra photo')).toBeDefined();
});

it('can skip an unconfirmed optional photo while preserving the previous photo and fields',async()=>{
 const withPhoto={...row,image_url:'https://example.test/old.jpg'};mockLoad.mockResolvedValue(withPhoto);mockPick.mockImplementationOnce(async(_guard,upload)=>upload('file:///selected.jpg'));mockUploadPhoto.mockRejectedValueOnce(Error('lost'));
 await mount(withPhoto);await act(async()=>button('Change extra photo').props.onPress());await act(async()=>button('Skip selected extra photo').props.onPress());expect(button('Retry extra photo')).toBeUndefined();expect(button('Save extra').props.disabled).toBe(false);await act(async()=>button('Save extra').props.onPress());expect(save.mock.calls[0][0].image_url).toBe(withPhoto.image_url);expect(save.mock.calls[0][0].name).toBe(withPhoto.name);
});
