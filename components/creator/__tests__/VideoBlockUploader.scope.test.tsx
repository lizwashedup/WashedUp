import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockPick=jest.fn(),mockUpload=jest.fn(),mockPoster=jest.fn(),mockFrames=jest.fn(),mockReady=jest.fn(),mockCancel=jest.fn();
const mockPlayer={generateThumbnailsAsync:(...a:unknown[])=>mockFrames(...a)};
jest.mock('expo-video',()=>({useVideoPlayer:()=>mockPlayer}));
jest.mock('expo-image',()=>({Image:require('react-native').View}));
jest.mock('lucide-react-native',()=>({Video:()=>null}));
jest.mock('../../../lib/haptics',()=>({hapticLight:()=>{},hapticSuccess:()=>{},hapticError:()=>{}}));
jest.mock('../../../lib/eventContent',()=>({MEDIA_MAX_BYTES:104857600,POSTER_FRAME_OFFSETS_SEC:[0,1],pickEventContentVideo:(...a:unknown[])=>mockPick(...a),uploadEventContentVideo:(...a:unknown[])=>mockUpload(...a),uploadPosterFrame:(...a:unknown[])=>mockPoster(...a)}));
import {VideoBlockUploader} from '../VideoBlockUploader';
let tree:ReactTestRenderer,guard:any,finishUpload:(x:string|null)=>void;
const action=(label:string)=>tree.root.findByProps({accessibilityLabel:label});
async function mount(){await act(async()=>{tree=create(<VideoBlockUploader eventId="event" onReady={mockReady} mediaGuard={guard}/>);});}
async function start(){await act(async()=>{void action('Add video').props.onPress();});}
async function poster(){await start();await act(async()=>{finishUpload('event/video.mp4');});}
beforeEach(()=>{jest.clearAllMocks();guard={check:jest.fn().mockResolvedValue(undefined),assertCurrent:jest.fn()};mockPick.mockResolvedValue({pick:{uri:'file://video.mp4',sizeBytes:20},problem:null});mockUpload.mockImplementation(()=>({done:new Promise(r=>{finishUpload=r;}),cancel:mockCancel}));mockFrames.mockResolvedValue([{requestedTime:0}]);mockPoster.mockResolvedValue('event/poster.jpg');mockReady.mockReturnValue(true);});
afterEach(()=>act(()=>tree?.unmount()));
it('locks repeated picker callbacks before the next render',async()=>{await mount();const f=action('Add video').props.onPress;await act(async()=>{void f();void f();});expect(mockPick).toHaveBeenCalledTimes(1);expect(mockUpload).toHaveBeenCalledTimes(1);});
it('cancel during picking prevents a delayed picker from starting an upload',async()=>{let finish:any;mockPick.mockImplementation(()=>new Promise(r=>{finish=r;}));await mount();await start();act(()=>action('Cancel video').props.onPress());await act(async()=>{finish({pick:{uri:'file://late.mp4'},problem:null});});expect(mockUpload).not.toHaveBeenCalled();expect(action('Add video')).toBeDefined();});
it('cancel during streaming prevents late completion and progress from opening posters',async()=>{await mount();await start();act(()=>action('Cancel video').props.onPress());await act(async()=>{mockUpload.mock.calls[0][2](0.9);finishUpload('event/late.mp4');});expect(mockCancel).toHaveBeenCalledTimes(1);expect(mockFrames).not.toHaveBeenCalled();expect(mockReady).not.toHaveBeenCalled();expect(action('Add video')).toBeDefined();});
it('unmount cancels the active stream and rejects its result',async()=>{await mount();await start();act(()=>tree.unmount());await act(async()=>{finishUpload('event/late.mp4');});expect(mockCancel).toHaveBeenCalledTimes(1);expect(mockReady).not.toHaveBeenCalled();});
it('changing the event cancels the old stream',async()=>{await mount();await start();act(()=>tree.update(<VideoBlockUploader eventId="other" onReady={mockReady} mediaGuard={guard}/>));await act(async()=>{finishUpload('event/late.mp4');});expect(mockCancel).toHaveBeenCalledTimes(1);expect(mockFrames).not.toHaveBeenCalled();});
it('permission loss before poster selection prevents a frame upload',async()=>{await mount();await poster();guard.check.mockRejectedValue(Error('Revoked'));await act(async()=>{await action('Use video frame at 0 seconds').props.onPress();});expect(mockPoster).not.toHaveBeenCalled();expect(mockReady).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Video was not added');});
it('first-frame failure stays visible and never silently inserts a bare video',async()=>{await mount();await poster();mockPoster.mockResolvedValue(null);await act(async()=>{await action('Use first video frame').props.onPress();});expect(mockReady).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Video was not added');});
it('a failed selected frame can be explicitly retried on the same saved video',async()=>{await mount();await poster();mockPoster.mockResolvedValueOnce(null);await act(async()=>{await action('Use first video frame').props.onPress();});await act(async()=>{await action('Use first video frame').props.onPress();});expect(mockUpload).toHaveBeenCalledTimes(1);expect(mockReady).toHaveBeenCalledWith('event/video.mp4','event/poster.jpg');});
it('repeated poster presses insert only once',async()=>{await mount();await poster();const f=action('Use first video frame').props.onPress;await act(async()=>{await Promise.all([f(),f()]);});expect(mockPoster).toHaveBeenCalledTimes(1);expect(mockReady).toHaveBeenCalledTimes(1);});
it('canceling an in-flight poster prevents its late insertion',async()=>{await mount();await poster();let finish:any;mockPoster.mockImplementation(()=>new Promise(r=>{finish=r;}));await act(async()=>{void action('Use first video frame').props.onPress();});act(()=>action('Cancel video').props.onPress());await act(async()=>{finish('event/late.jpg');});expect(mockReady).not.toHaveBeenCalled();});
it('no-thumbnail fallback is explicit and remains permission checked',async()=>{mockFrames.mockRejectedValue(Error('Codec'));await mount();await poster();await act(async()=>{await action('Add video without preview').props.onPress();});expect(mockPoster).not.toHaveBeenCalled();expect(mockReady).toHaveBeenCalledWith('event/video.mp4',undefined);});
it('newer draft capacity prevents insertion without losing the saved video',async()=>{mockReady.mockReturnValue(false);await mount();await poster();await act(async()=>{await action('Use first video frame').props.onPress();});expect(action('Use first video frame')).toBeDefined();expect(JSON.stringify(tree.toJSON())).toContain('Video was not added');});

it('finishing a confirmed video does not cancel its already-completed transport',async()=>{await mount();await poster();await act(async()=>{await action('Use first video frame').props.onPress();});expect(mockReady).toHaveBeenCalledTimes(1);expect(mockCancel).not.toHaveBeenCalled();});

function privateController(overrides:any={}){return {drafts:[],unassigned:[],busy:false,loading:false,error:null,progress:null,isBusy:()=>false,uploadVideo:jest.fn(),uploadPoster:jest.fn().mockResolvedValue('event/private-poster.jpg'),withoutPoster:jest.fn().mockResolvedValue(undefined),resume:jest.fn(),resumeUnassigned:jest.fn(),discard:jest.fn().mockResolvedValue(undefined),discardUnassigned:jest.fn().mockResolvedValue(undefined),refresh:jest.fn(),cancel:jest.fn(),getResult:()=>({path:'event/private-video.mp4',localUri:'file:///saved-original.mp4',ready:false}),...overrides};}
it('private video holds the parent lease through frame selection and uses the supplied private callbacks',async()=>{
 const hook=require('../../../hooks/useCreatorPageVideo'),api=privateController(),spy=jest.spyOn(hook,'useCreatorPageVideo').mockReturnValue(api),release=jest.fn(),begin=jest.fn().mockReturnValue(release);
 try{
  await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard} beginMediaWork={begin}/>);});
  await poster();expect(mockUpload.mock.calls[0][4]).toBe(api.uploadVideo);expect(release).not.toHaveBeenCalled();
  mockPoster.mockImplementation(async(_e,_f,_g,writer)=>writer('file:///frame.jpg'));
  await act(async()=>{await action('Use first video frame').props.onPress();});
  expect(mockPoster.mock.calls[0][3]).toBe(api.uploadPoster);expect(api.uploadPoster).toHaveBeenCalledWith('file:///frame.jpg');expect(mockReady).toHaveBeenCalledWith('event/video.mp4','event/private-poster.jpg');expect(release).toHaveBeenCalledTimes(1);
 }finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('private resume restores the saved chosen pair without another picker or frame selection',async()=>{
 const draft={video:{mediaId:'video'},choice:'poster',posters:[{mediaId:'poster'}]},api=privateController({drafts:[draft],resume:jest.fn().mockReturnValue({done:Promise.resolve({path:'event/private-video.mp4',poster:'event/private-poster.jpg',localUri:'file:///saved.mp4',ready:true}),cancel:jest.fn()})});
 const spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api),release=jest.fn();
 try{
  await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>release}/>);});
  await act(async()=>{await action('Resume saved video 1').props.onPress();});
  expect(api.resume).toHaveBeenCalledWith(draft,expect.any(Function));expect(mockPick).not.toHaveBeenCalled();expect(mockFrames).not.toHaveBeenCalled();expect(mockReady).toHaveBeenCalledWith('event/private-video.mp4','event/private-poster.jpg');expect(release).toHaveBeenCalledTimes(1);
 }finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('private no-thumbnail fallback persists the explicit no-preview choice before insertion',async()=>{
 const api=privateController(),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api);
 try{
  mockFrames.mockRejectedValue(Error('codec'));await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard}/>);});await poster();
  await act(async()=>{await action('Add video without preview').props.onPress();});expect(api.withoutPoster).toHaveBeenCalledTimes(1);expect(api.withoutPoster.mock.invocationCallOrder[0]).toBeLessThan(mockReady.mock.invocationCallOrder[0]);expect(mockReady).toHaveBeenCalledWith('event/video.mp4',undefined);
 }finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('canceling a private chosen-frame upload retires its result and releases the full-session lease',async()=>{
 const api=privateController(),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api),release=jest.fn();let complete!:(v:string)=>void;
 try{
  await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>release}/>);});await poster();mockPoster.mockImplementation(()=>new Promise(r=>{complete=r;}));
  await act(async()=>{void action('Use first video frame').props.onPress();});act(()=>action('Cancel video').props.onPress());await act(async()=>{complete('event/late.jpg');});expect(api.cancel).toHaveBeenCalled();expect(release).toHaveBeenCalledTimes(1);expect(mockReady).not.toHaveBeenCalled();
 }finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('unassigned poster recovery never offers an invented video pairing',async()=>{
 const original={mediaId:'poster',purpose:'poster'},api=privateController({unassigned:[original]}),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api);
 try{
  await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard}/>);});expect(tree.root.findAllByProps({accessibilityLabel:'Resume unassigned video 1'})).toHaveLength(0);
  await act(async()=>{await action('Discard unassigned upload 1').props.onPress();});expect(api.discardUnassigned).toHaveBeenCalledWith(original);expect(api.resume).not.toHaveBeenCalled();expect(api.resumeUnassigned).not.toHaveBeenCalled();
 }finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('another media action can deny the parent lease before a private video picker opens',async()=>{
 const api=privateController(),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api);
 try{await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>null}/>);});await start();expect(mockPick).not.toHaveBeenCalled();}finally{act(()=>tree.unmount());spy.mockRestore();}
});
it('backgrounding during private frame choice releases the lease and keeps late frames out of the editor',async()=>{
 const api=privateController(),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api),release=jest.fn();let background!:(state:string)=>void;
 const state=require('react-native').AppState,previousListener=state.addEventListener;state.addEventListener=jest.fn((_name:any,fn:any)=>{background=fn;return{remove:jest.fn()};});
 try{await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="page" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>release}/>);});await poster();act(()=>background('background'));expect(api.cancel).toHaveBeenCalled();expect(release).toHaveBeenCalledTimes(1);expect(mockReady).not.toHaveBeenCalled();expect(action('Add video')).toBeDefined();}finally{act(()=>tree.unmount());spy.mockRestore();state.addEventListener=previousListener;}
});
it('a changed private page retires the old frame chooser even with an unchanged media guard',async()=>{
 const api=privateController(),spy=jest.spyOn(require('../../../hooks/useCreatorPageVideo'),'useCreatorPageVideo').mockReturnValue(api),release=jest.fn();
 try{await act(async()=>{tree=create(<VideoBlockUploader eventId="event" pageId="old" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>release}/>);});await poster();act(()=>tree.update(<VideoBlockUploader eventId="event" pageId="new" onReady={mockReady} mediaGuard={guard} beginMediaWork={()=>release}/>));expect(action('Add video')).toBeDefined();expect(release).toHaveBeenCalledTimes(1);expect(mockReady).not.toHaveBeenCalled();}finally{act(()=>tree.unmount());spy.mockRestore();}
});
