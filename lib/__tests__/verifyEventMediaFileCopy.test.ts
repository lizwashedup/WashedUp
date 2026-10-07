const mockInfo=jest.fn(),mockRead=jest.fn();
jest.mock('expo-file-system/legacy',()=>({getInfoAsync:(...a:unknown[])=>mockInfo(...a),readAsStringAsync:(...a:unknown[])=>mockRead(...a),EncodingType:{Base64:'base64'}}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
import {verifyEventMediaFileCopy,EVENT_MEDIA_COMPARE_CHUNK_BYTES as chunk} from '../verifyEventMediaFileCopy';
const originalUri='file:///private/original.mp4',copyUri='file:///private/readback.mp4';let current=true;let original:Buffer,copy:Buffer;const scope={userId:'account',isCurrent:()=>current};
const input=()=>({originalUri,copyUri,byteSize:original.length,mimeType:'video/mp4' as const});
beforeEach(()=>{jest.clearAllMocks();current=true;original=Buffer.alloc(chunk+17,173);copy=Buffer.from(original);mockInfo.mockImplementation(async(uri:string)=>({exists:true,isDirectory:false,size:(uri===originalUri?original:copy).length,modificationTime:1}));mockRead.mockImplementation(async(uri:string,{position,length}:any)=>(uri===originalUri?original:copy).subarray(position,position+length).toString('base64'));});
it('compares every byte in bounded positioned reads including final partial chunk',async()=>{
 expect(await verifyEventMediaFileCopy(input(),scope)).toEqual({byteSize:chunk+17,checkedBytes:chunk+17,chunkSize:chunk});
 expect(mockRead.mock.calls.map(c=>[c[0],c[1].position,c[1].length])).toEqual([[originalUri,0,chunk],[copyUri,0,chunk],[originalUri,chunk,17],[copyUri,chunk,17]]);
 expect(mockInfo.mock.calls.every(c=>c.length===1)).toBe(true);
});
it.each([0,chunk-1,chunk,chunk+16])('detects same-size content damage at byte %s',async index=>{copy[index]^=1;await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow('differs');});
it('handles short reads without skipping or repeating byte positions',async()=>{
 mockRead.mockImplementation(async(uri:string,{position,length}:any)=>(uri===originalUri?original:copy).subarray(position,position+Math.min(length,8191)).toString('base64'));
 expect((await verifyEventMediaFileCopy(input(),scope)).checkedBytes).toBe(original.length);expect(mockRead.mock.calls.every(c=>c[1].length<=chunk)).toBe(true);
});
it('accepts line endings in native Base64 output',async()=>{
 mockRead.mockImplementation(async(uri:string,{position,length}:any)=>(uri===originalUri?original:copy).subarray(position,position+length).toString('base64').replace(/.{76}/g,'$&\r\n'));
 await expect(verifyEventMediaFileCopy(input(),scope)).resolves.toHaveProperty('checkedBytes',original.length);
});
it.each(['','malformed','AQ===','AB=='])('rejects empty or malformed native encoding %s',async text=>{mockRead.mockResolvedValue(text);await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow();});
it('rejects more decoded bytes than requested',async()=>{mockRead.mockResolvedValue(Buffer.alloc(chunk+1).toString('base64'));await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow();});
it('rejects truncated file before any reads',async()=>{copy=copy.subarray(0,copy.length-1);await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow('changed size');expect(mockRead).not.toHaveBeenCalled();});
it('retains both files when read fails instead of deleting or completing anything',async()=>{mockRead.mockRejectedValue(Error('disk unavailable'));await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow('disk unavailable');expect(copy.equals(original)).toBe(true);});
it('stops after an account/visit change during a read',async()=>{mockRead.mockImplementationOnce(async()=>{current=false;return original.subarray(0,chunk).toString('base64');});await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow();expect(mockRead).toHaveBeenCalledTimes(1);});
it('stops on cancellation before creating any file work',async()=>{const controller=new AbortController();controller.abort();await expect(verifyEventMediaFileCopy(input(),scope,controller.signal)).rejects.toThrow();expect(mockInfo).not.toHaveBeenCalled();});
it('stops between reads when cancelled',async()=>{const controller=new AbortController();mockRead.mockImplementationOnce(async()=>{controller.abort();return original.subarray(0,chunk).toString('base64');});await expect(verifyEventMediaFileCopy(input(),scope,controller.signal)).rejects.toThrow();expect(mockRead).toHaveBeenCalledTimes(1);});
it('detects modification timestamps changing during verification',async()=>{mockInfo.mockResolvedValueOnce({exists:true,isDirectory:false,size:original.length,modificationTime:1}).mockResolvedValueOnce({exists:true,isDirectory:false,size:copy.length,modificationTime:1}).mockResolvedValue({exists:true,isDirectory:false,size:copy.length,modificationTime:2});await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow('changed while');});
it.each([{exists:false},{exists:true,isDirectory:true},{exists:true,isDirectory:false,size:123,modificationTime:NaN}])('rejects unavailable metadata %p',async value=>{mockInfo.mockResolvedValue(value);await expect(verifyEventMediaFileCopy(input(),scope)).rejects.toThrow();expect(mockRead).not.toHaveBeenCalled();});
it.each([{byteSize:0},{byteSize:104857601},{byteSize:1.5},{byteSize:10485761,mimeType:'image/jpeg'},{copyUri:originalUri},{originalUri:'https://example.com/file'},{mimeType:'invalid'}])('rejects invalid bounds and nonseparate input %p',async patch=>{await expect(verifyEventMediaFileCopy({...input(),...patch} as any,scope)).rejects.toThrow();expect(mockInfo).not.toHaveBeenCalled();});
