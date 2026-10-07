const mockPermission=jest.fn(),mockPicker=jest.fn(),mockStream=jest.fn(),mockCancel=jest.fn(),mockRender=jest.fn(),mockSaveFrame=jest.fn(),mockBase64=jest.fn();
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:()=>mockPermission(),launchImageLibraryAsync:()=>mockPicker()}));
jest.mock('expo-image-manipulator',()=>({ImageManipulator:{manipulate:()=>({resize:()=>({renderAsync:()=>mockRender()})})},SaveFormat:{JPEG:'jpeg'}}));
jest.mock('../uploadPhoto',()=>({uploadUriToStorage:(...a:unknown[])=>mockStream(...a),uploadBase64ToStorage:(...a:unknown[])=>mockBase64(...a)}));
import {pickEventContentVideo,uploadEventContentVideo,uploadPosterFrame} from '../eventContent';
let guard:any,finish:(v:string|null)=>void;
beforeEach(()=>{jest.clearAllMocks();guard={check:jest.fn().mockResolvedValue(undefined),assertCurrent:jest.fn()};mockPermission.mockResolvedValue({granted:true});mockPicker.mockResolvedValue({canceled:false,assets:[{uri:'file://clip.mp4',fileSize:50}]});mockStream.mockImplementation(()=>({done:new Promise(r=>{finish=r;}),cancel:mockCancel}));mockRender.mockResolvedValue({saveAsync:()=>mockSaveFrame()});mockSaveFrame.mockResolvedValue({base64:'YQ=='});mockBase64.mockResolvedValue('poster.jpg');});
it('rechecks access after video picker returns',async()=>{mockPicker.mockImplementation(async()=>{guard.check.mockRejectedValue(Error('Revoked'));return{assets:[{uri:'file://clip.mp4'}]};});await expect(pickEventContentVideo(guard)).rejects.toThrow('Revoked');});
it('retains mp4 and size limits before any stream starts',async()=>{mockPicker.mockResolvedValue({assets:[{uri:'file://clip.mov'}]});expect((await pickEventContentVideo(guard)).pick).toBeNull();mockPicker.mockResolvedValue({assets:[{uri:'file://clip.mp4',fileSize:104857601}]});expect((await pickEventContentVideo()).pick).toBeNull();expect(mockStream).not.toHaveBeenCalled();});
it('cancel before the permission read returns never starts streaming',async()=>{let allow:any;guard.check.mockImplementation(()=>new Promise(r=>{allow=r;}));const task=uploadEventContentVideo('event',{uri:'local.mp4',sizeBytes:20},()=>{},guard);task.cancel();allow();expect(await task.done).toBeNull();expect(mockStream).not.toHaveBeenCalled();});
it('forwards the guard to the original streaming helper after its session read',async()=>{const task=uploadEventContentVideo('event',{uri:'local.mp4',sizeBytes:20},()=>{},guard);await Promise.resolve();expect(mockStream.mock.calls[0][5]).toEqual(expect.any(Function));await mockStream.mock.calls[0][5]();finish('url');expect(await task.done).toMatch(/^event\/.+\.mp4$/);});
it('cancel stops late progress and a committed upload result',async()=>{const progress=jest.fn();const task=uploadEventContentVideo('event',{uri:'local.mp4',sizeBytes:20},progress,guard);await Promise.resolve();task.cancel();mockStream.mock.calls[0][4](0.9);finish('url');expect(await task.done).toBeNull();expect(progress).not.toHaveBeenCalled();expect(mockCancel).toHaveBeenCalledTimes(1);});
it('permission loss after streaming rejects the saved path',async()=>{const task=uploadEventContentVideo('event',{uri:'local.mp4',sizeBytes:20},()=>{},guard);await Promise.resolve();guard.check.mockRejectedValue(Error('Revoked'));finish('url');await expect(task.done).rejects.toThrow('Revoked');});
it('poster encoding rechecks authority before uploading its bytes',async()=>{mockSaveFrame.mockImplementation(async()=>{guard.check.mockRejectedValue(Error('Revoked'));return{base64:'YQ=='};});await expect(uploadPosterFrame('event',{} as any,guard)).rejects.toThrow('Revoked');expect(mockBase64).not.toHaveBeenCalled();});
it('poster upload failure returns no confirmed path for existing callers',async()=>{mockBase64.mockRejectedValue(Error('Network'));expect(await uploadPosterFrame('event',{} as any)).toBeNull();});

it('private video callback retains actual progress, cancellation and event-relative path without public upload',async()=>{
 let end!:(v:string)=>void,progressCallback!:(v:number)=>void;const progress=jest.fn(),stop=jest.fn(),writer=jest.fn().mockImplementation((_uri,p)=>{progressCallback=p;return{done:new Promise(r=>{end=r;}),cancel:stop};});
 const task=uploadEventContentVideo('event',{uri:'file:///video.mp4',sizeBytes:50},progress,guard,writer);await Promise.resolve();progressCallback(0.5);end('event/private-video.mp4');expect(await task.done).toBe('event/private-video.mp4');expect(progress).toHaveBeenCalledWith(0.5);expect(writer).toHaveBeenCalledWith('file:///video.mp4',expect.any(Function));expect(mockStream).not.toHaveBeenCalled();
});
it('private video failure cannot fall back to the ordinary public stream',async()=>{
 const writer=jest.fn().mockReturnValue({done:Promise.resolve().then(()=>{throw Error('saved original');}),cancel:jest.fn()});const task=uploadEventContentVideo('event',{uri:'file:///video.mp4',sizeBytes:50},()=>{},guard,writer);await expect(task.done).rejects.toThrow('saved original');expect(mockStream).not.toHaveBeenCalled();
});
it('canceling a private transfer forwards cancellation and ignores late completion',async()=>{
 let finish!:(v:string)=>void;const cancel=jest.fn(),writer=jest.fn().mockReturnValue({done:new Promise(r=>{finish=r;}),cancel});const task=uploadEventContentVideo('event',{uri:'file:///video.mp4',sizeBytes:50},()=>{},guard,writer);await Promise.resolve();task.cancel();finish('event/private-video.mp4');expect(await task.done).toBeNull();expect(cancel).toHaveBeenCalledTimes(1);expect(mockStream).not.toHaveBeenCalled();
});
it('selected poster retains existing frame encoding and supplies only its local file to the private writer',async()=>{
 mockSaveFrame.mockResolvedValue({uri:'file:///chosen-frame.jpg',base64:'YQ=='});const writer=jest.fn().mockResolvedValue('event/private-poster.jpg');expect(await uploadPosterFrame('event',{} as any,guard,writer)).toBe('event/private-poster.jpg');expect(writer).toHaveBeenCalledWith('file:///chosen-frame.jpg');expect(mockBase64).not.toHaveBeenCalled();
});
it('failed private poster remains unconfirmed without a public fallback',async()=>{
 mockSaveFrame.mockResolvedValue({uri:'file:///chosen-frame.jpg',base64:'YQ=='});const writer=jest.fn().mockRejectedValue(Error('pending original'));expect(await uploadPosterFrame('event',{} as any,guard,writer)).toBeNull();expect(mockBase64).not.toHaveBeenCalled();
});
