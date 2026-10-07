import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockPick=jest.fn(),mockChange=jest.fn();
jest.mock('../../../lib/eventContent',()=>({BLOCKS_MAX:30,GALLERY_SOFT_CAP:20,TEXT_BLOCK_MAX:5000,eventContentPublicUrl:(p:string)=>p,pickAndUploadEventContentImages:(...a:unknown[])=>mockPick(...a)}));
jest.mock('../VideoBlockUploader',()=>({VideoBlockUploader:()=>null,VIDEO_LIMITS_LINE:'Limits'}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:require('react-native').View}));
jest.mock('expo-image',()=>({Image:require('react-native').View}));
jest.mock('../../../lib/haptics',()=>({hapticLight:()=>{},hapticError:()=>{}}));
jest.mock('../../keyboard/KeyboardDoneBar',()=>({KEYBOARD_DONE_ACCESSORY_ID:'done'}));
jest.mock('lucide-react-native',()=>({ArrowDown:()=>null,ArrowUp:()=>null,ImagePlus:()=>null,MessageCircleQuestion:()=>null,Plus:()=>null,Video:()=>null,X:()=>null}));
import {VideoBlockUploader} from '../VideoBlockUploader';
import {DescriptionBlocksEditor} from '../DescriptionBlocksEditor';
let tree:ReactTestRenderer;let finish:(v:any)=>void;let guard:any;let blocks:any[];
const photo=()=>tree.root.findAll(n=>typeof n.props.onPress==='function'&&n.findAll(x=>x.props.children==='photos').length>0)[0];
async function mount(){await act(async()=>{tree=create(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard}/>);});}
async function start(){await act(async()=>{void photo().props.onPress();});}
beforeEach(()=>{jest.clearAllMocks();blocks=[{type:'text',content:'Original'}];guard={assertCurrent:jest.fn(),check:jest.fn().mockResolvedValue(undefined)};mockPick.mockImplementation(()=>new Promise(r=>{finish=r;}));});
afterEach(()=>act(()=>tree?.unmount()));
it('preserves edits made while the image upload is pending',async()=>{await mount();await start();blocks=[{type:'text',content:'Newer story'},{type:'faq'}];act(()=>tree.update(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard}/>));await act(async()=>{finish({paths:['event/photo.jpg'],problems:[]});});expect(mockChange).toHaveBeenLastCalledWith([...blocks,{type:'image',path:'event/photo.jpg'}]);});
it('locks repeated photo callbacks before React renders busy state',async()=>{await mount();const click=photo().props.onPress;await act(async()=>{void click();void click();});expect(mockPick).toHaveBeenCalledTimes(1);});
it('does not adopt an upload after a page/account guard retires',async()=>{await mount();await start();guard.check.mockRejectedValue(Error('Revoked'));await act(async()=>{finish({paths:['event/photo.jpg'],problems:[]});});expect(mockChange).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Photos were not added');});
it('does not adopt an old result after the target event changes',async()=>{await mount();await start();act(()=>tree.update(<DescriptionBlocksEditor eventId="other" blocks={[]} onChange={mockChange} mediaGuard={guard}/>));await act(async()=>{finish({paths:['event/photo.jpg'],problems:[]});});expect(mockChange).not.toHaveBeenCalled();});
it('does not adopt a result after unmounting',async()=>{await mount();await start();act(()=>tree.unmount());await act(async()=>{finish({paths:['event/photo.jpg'],problems:[]});});expect(mockChange).not.toHaveBeenCalled();});
it('keeps newer blocks within the existing cap instead of overwriting them',async()=>{await mount();await start();blocks=Array.from({length:20},()=>({type:'text',content:'New'}));act(()=>tree.update(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard}/>));await act(async()=>{finish({paths:['event/photo.jpg'],problems:[]});});expect(mockChange).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('newer edits filled');});
it('does not open the picker when the capability preflight fails',async()=>{guard.check.mockRejectedValue(Error('Revoked'));await mount();await start();expect(mockPick).not.toHaveBeenCalled();});

it('a video callback inserts into the latest body rather than a captured old draft',async()=>{await mount();const insert=tree.root.findByType(VideoBlockUploader).props.onReady;blocks=[{type:'text',content:'Newer story'}];act(()=>tree.update(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard}/>));act(()=>{expect(insert('event/clip.mp4','event/poster.jpg')).toBe(true);});expect(mockChange).toHaveBeenCalledWith([...blocks,{type:'video',path:'event/clip.mp4',poster:'event/poster.jpg'}]);});
it('a video callback cannot exceed the latest block cap',async()=>{await mount();const insert=tree.root.findByType(VideoBlockUploader).props.onReady;blocks=Array.from({length:20},()=>({type:'faq'}));act(()=>tree.update(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard}/>));expect(insert('event/clip.mp4')).toBe(false);expect(mockChange).not.toHaveBeenCalled();});

it('a denied parent media lease prevents opening another image picker',async()=>{
 const begin=jest.fn().mockReturnValue(null);await act(async()=>{tree=create(<DescriptionBlocksEditor eventId="event" blocks={blocks} onChange={mockChange} mediaGuard={guard} beginMediaWork={begin}/>);});
 await start();expect(begin).toHaveBeenCalledTimes(1);expect(mockPick).not.toHaveBeenCalled();
});
it('private image writer preserves the ordered batch and exposes original recovery without duplicate insertion',async()=>{
 const attempts=require('../../../lib/creatorPageEventMediaAttempt'),transfer=require('../../../lib/creatorPageEventMediaTransfer');const scope={userId:'user',isCurrent:()=>true};
 const original={purpose:'image',mediaId:'original',pageId:'page',eventId:'event',userId:'user'};let pending:any[]=[];
 const read=jest.spyOn(attempts,'readPageEventMediaAttempts').mockImplementation(async()=>pending),prepare=jest.spyOn(attempts,'preparePageEventMediaAttempt').mockImplementation(async()=>{pending=[original];return{attempt:original,created:true};}),run=jest.spyOn(transfer,'startPageEventMediaTransfer').mockReturnValue({done:Promise.resolve({objectName:'event/photo.jpg'}),cancel:jest.fn()});
 const release=jest.fn(),begin=jest.fn().mockReturnValue(release);const props={eventId:'event',pageId:'page',pageScope:scope,mediaGuard:guard,onChange:mockChange,beginMediaWork:begin};
 try{
  await act(async()=>{tree=create(<DescriptionBlocksEditor {...props} blocks={blocks}/>);});
  mockPick.mockImplementation(async(_e,_n,_g,write)=>({paths:[await write('file:///photo.jpg')],problems:[]}));await start();
  expect(prepare).toHaveBeenCalledWith('page','event','image','image/jpeg','file:///photo.jpg',scope);expect(run).toHaveBeenCalledWith(original,scope,expect.any(Function));
  expect(mockChange).toHaveBeenCalledTimes(1);expect(mockChange).toHaveBeenCalledWith([...blocks,{type:'image',path:'event/photo.jpg'}]);expect(release).toHaveBeenCalledTimes(1);
  blocks=mockChange.mock.calls[0][0];act(()=>tree.update(<DescriptionBlocksEditor {...props} blocks={blocks}/>));
  await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Retry saved photo upload 1'}).props.onPress();});
  expect(prepare).toHaveBeenCalledTimes(1);expect(run).toHaveBeenCalledTimes(2);expect(mockChange).toHaveBeenCalledTimes(1);
 }finally{act(()=>tree.unmount());[read,prepare,run].forEach(s=>s.mockRestore());}
});
it('canceling a private photo batch prevents the next selected photo from starting',async()=>{
 const attempts=require('../../../lib/creatorPageEventMediaAttempt'),transfer=require('../../../lib/creatorPageEventMediaTransfer');const scope={userId:'user',isCurrent:()=>true};
 const original={purpose:'image',mediaId:'original',pageId:'page',eventId:'event',userId:'user'};let reject!:(e:Error)=>void,pending:any[]=[];
 const read=jest.spyOn(attempts,'readPageEventMediaAttempts').mockImplementation(async()=>pending),prepare=jest.spyOn(attempts,'preparePageEventMediaAttempt').mockImplementation(async()=>{pending=[original];return{attempt:original,created:true};}),run=jest.spyOn(transfer,'startPageEventMediaTransfer').mockImplementation(()=>({done:new Promise((_,r)=>{reject=r;}),cancel:()=>reject(Error('cancelled'))}));
 try{
  await act(async()=>{tree=create(<DescriptionBlocksEditor eventId="event" pageId="page" pageScope={scope} mediaGuard={guard} blocks={blocks} onChange={mockChange}/>);});
  mockPick.mockImplementation(async(_e,_n,batchGuard,write)=>{try{await write('file:///first.jpg');}catch{}await batchGuard.check();await write('file:///second.jpg');return{paths:[],problems:[]};});await start();
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Cancel photo upload'}).props.onPress();});
  expect(prepare).toHaveBeenCalledTimes(1);expect(run).toHaveBeenCalledTimes(1);expect(mockChange).not.toHaveBeenCalled();expect(pending).toEqual([original]);
 }finally{act(()=>tree.unmount());[read,prepare,run].forEach(s=>s.mockRestore());}
});
it('resuming an already-present exact video is idempotent while a changed poster remains a conflict',async()=>{
 blocks=[{type:'video',path:'event/video.mp4',poster:'event/chosen.jpg'}];await mount();const insert=tree.root.findByType(VideoBlockUploader).props.onReady;
 expect(insert('event/video.mp4','event/chosen.jpg')).toBe(true);expect(insert('event/video.mp4','event/other.jpg')).toBe(false);expect(mockChange).not.toHaveBeenCalled();
});
