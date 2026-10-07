const mockPermission=jest.fn(),mockPicker=jest.fn(),mockManipulate=jest.fn(),mockUpload=jest.fn();
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:(...a:unknown[])=>mockPermission(...a),launchImageLibraryAsync:(...a:unknown[])=>mockPicker(...a)}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:(...a:unknown[])=>mockManipulate(...a),SaveFormat:{JPEG:'jpeg'}}));
jest.mock('../uploadPhoto',()=>({uploadBase64ToStorage:(...a:unknown[])=>mockUpload(...a)}));
jest.mock('../supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'member'}}})}}}));
import {pickAndUploadEventImage} from '../creatorEvents';import {pickAndUploadEventContentImages} from '../eventContent';
let guard:any;
beforeEach(()=>{jest.clearAllMocks();guard={assertCurrent:jest.fn(),check:jest.fn().mockResolvedValue(undefined)};mockPermission.mockResolvedValue({granted:true});mockPicker.mockResolvedValue({canceled:false,assets:[{uri:'local-photo'}]});mockManipulate.mockResolvedValue({base64:'YQ=='});mockUpload.mockResolvedValue('stored-photo');});
it.each(['poster','body'])('%s rechecks capability after picker, before uploading',async kind=>{mockPicker.mockImplementation(async()=>{guard.check.mockRejectedValue(Error('Revoked'));return{canceled:false,assets:[{uri:'local'}]};});await expect(kind==='poster'?pickAndUploadEventImage(guard):pickAndUploadEventContentImages('event',3,guard)).rejects.toThrow('Revoked');expect(mockUpload).not.toHaveBeenCalled();});
it.each(['poster','body'])('%s does not return a successful upload into a retired visit',async kind=>{mockUpload.mockImplementation(async()=>{guard.check.mockRejectedValue(Error('Retired'));return'stored-photo';});await expect(kind==='poster'?pickAndUploadEventImage(guard):pickAndUploadEventContentImages('event',3,guard)).rejects.toThrow('Retired');});
it('body rechecks before the next item in a batch',async()=>{mockPicker.mockResolvedValue({assets:[{uri:'first'},{uri:'second'}]});mockUpload.mockImplementation(async()=>{guard.check.mockRejectedValue(Error('Revoked'));return'stored';});await expect(pickAndUploadEventContentImages('event',3,guard)).rejects.toThrow();expect(mockUpload).toHaveBeenCalledTimes(1);});
it('retains existing poster path, crop and default unguarded calls',async()=>{expect(await pickAndUploadEventImage()).toBe('stored-photo');expect(mockPicker).toHaveBeenCalledWith(expect.objectContaining({aspect:[4,5],allowsEditing:true}));expect(mockUpload).toHaveBeenCalledWith('event-images',expect.stringMatching(/^member\/.+\.jpg$/),'YQ==');});
it('retains exact event folder and successful body image results',async()=>{const r=await pickAndUploadEventContentImages('event',3,guard);expect(r.paths).toHaveLength(1);expect(r.paths[0]).toMatch(/^event\/.+\.jpg$/);expect(r.problems).toEqual([]);});
it('canceling returns no media and dispatches no upload',async()=>{mockPicker.mockResolvedValue({canceled:true});expect(await pickAndUploadEventImage(guard)).toBeNull();expect(await pickAndUploadEventContentImages('event',3,guard)).toEqual({paths:[],problems:[]});expect(mockUpload).not.toHaveBeenCalled();});
it('page cover uses the existing crop and only the supplied private writer',async()=>{mockManipulate.mockResolvedValue({uri:'file:///cropped.jpg',base64:'YQ=='});const privateWrite=jest.fn().mockResolvedValue('creator-event-media:event/private-cover.jpg');expect(await pickAndUploadEventImage(guard,privateWrite)).toBe('creator-event-media:event/private-cover.jpg');expect(privateWrite).toHaveBeenCalledWith('file:///cropped.jpg');expect(mockUpload).not.toHaveBeenCalled();expect(mockPicker).toHaveBeenCalledWith(expect.objectContaining({aspect:[4,5],allowsEditing:true}));});
it('failed private cover never falls back to public storage',async()=>{const privateWrite=jest.fn().mockRejectedValue(Error('Pending original upload'));await expect(pickAndUploadEventImage(guard,privateWrite)).rejects.toThrow('Pending');expect(mockUpload).not.toHaveBeenCalled();});

it('private body batch preserves pick order and never calls public storage',async()=>{
 mockPicker.mockResolvedValue({assets:[{uri:'first'},{uri:'second'}]});mockManipulate.mockImplementation(async(uri)=>({uri:'file:///'+uri+'.jpg',base64:'YQ=='}));
 const write=jest.fn().mockImplementation(async(uri)=>'event/private-'+uri.split('/').pop());
 expect(await pickAndUploadEventContentImages('event',3,guard,write)).toEqual({paths:['event/private-first.jpg','event/private-second.jpg'],problems:[]});
 expect(write.mock.calls.map(c=>c[0])).toEqual(['file:///first.jpg','file:///second.jpg']);expect(mockUpload).not.toHaveBeenCalled();
});
it('private body keeps successful photos and directs failed photos to saved recovery without public fallback',async()=>{
 mockPicker.mockResolvedValue({assets:[{uri:'first'},{uri:'second'}]});mockManipulate.mockResolvedValue({uri:'file:///photo.jpg',base64:'YQ=='});
 const write=jest.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce('event/private-second.jpg');
 const result=await pickAndUploadEventContentImages('event',3,guard,write);expect(result.paths).toEqual(['event/private-second.jpg']);expect(result.problems).toEqual(['A photo was not added. Check its saved upload below.']);expect(mockUpload).not.toHaveBeenCalled();
});
