/** Bounded byte comparison for an owned original and downloaded/upload read-back.
 * Callers retain both immutable files and current source/destination authorization.
 * This is local equality evidence, never a server completion receipt or a digest.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {decode,encode} from 'base64-arraybuffer';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
export const EVENT_MEDIA_COMPARE_CHUNK_BYTES=64*1024;
export interface EventMediaFileCopyInput {originalUri:string;copyUri:string;byteSize:number;mimeType:'image/jpeg'|'image/png'|'image/webp'|'video/mp4'}
export async function verifyEventMediaFileCopy(input:EventMediaFileCopyInput,scope:CreatorPageScope,signal?:AbortSignal){
  const {originalUri,copyUri,byteSize,mimeType}=input;
  const current=()=>{if(!scope.isCurrent()||signal?.aborted)throw new CreatorPageScopeExpired();};
  current();
  if(!originalUri.startsWith('file://')||!copyUri.startsWith('file://')||originalUri===copyUri
    ||!['image/jpeg','image/png','image/webp','video/mp4'].includes(mimeType)||!Number.isSafeInteger(byteSize)||byteSize<1
    ||byteSize>(mimeType==='video/mp4'?104857600:10485760))throw Error('Check the original media and its separate copy.');
  const info=async(uri:string)=>{
    current();const value=await FileSystem.getInfoAsync(uri);current();
    if(!value.exists||value.isDirectory||value.size!==byteSize||!Number.isFinite(value.modificationTime))throw Error('The media file is unavailable or changed size.');
    return value.modificationTime;
  };
  const read=async(uri:string,position:number,length:number)=>{
    const out=new Uint8Array(length);let received=0;
    // Android InputStream may return fewer bytes than requested. Accept bounded
    // short reads while requiring positive progress and an exact final length.
    while(received<length){
      current();const raw=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64,position:position+received,length:length-received});current();
      const encodedLimit=4*Math.ceil((length-received)/3);
      if(typeof raw!=='string'||raw.length>encodedLimit+2*Math.ceil(encodedLimit/64)+2)throw Error('The media read could not be verified.');
      const text=raw.replace(/[\r\n]/g,'');
      if(!text.length||text.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('The media read was incomplete.');
      const buffer=decode(text),bytes=new Uint8Array(buffer);
      if(bytes.length<1||bytes.length>length-received||encode(buffer)!==text)throw Error('The media read could not be verified.');
      out.set(bytes,received);received+=bytes.length;
    }
    return out;
  };
  const originalTime=await info(originalUri),copyTime=await info(copyUri);
  for(let offset=0;offset<byteSize;offset+=EVENT_MEDIA_COMPARE_CHUNK_BYTES){
    const length=Math.min(EVENT_MEDIA_COMPARE_CHUNK_BYTES,byteSize-offset);
    const original=await read(originalUri,offset,length),copy=await read(copyUri,offset,length);
    for(let index=0;index<length;index++)if(original[index]!==copy[index])throw Error('The media copy differs from the original. Keep both files for review.');
  }
  if(await info(originalUri)!==originalTime||await info(copyUri)!==copyTime)throw Error('The media changed while its copy was being checked.');
  current();return {byteSize,checkedBytes:byteSize,chunkSize:EVENT_MEDIA_COMPARE_CHUNK_BYTES};
}
