import {mediaUUID} from './creatorPageEventMedia';
const running=new Set<string>();
/** Transfer and terminal file cleanup share one exact-attempt lease. */
export function claimPageEventMediaReuseWork(userId:string,pageId:string,eventId:string,mediaId:string){
  if(![userId,pageId,eventId,mediaId].every(mediaUUID))throw Error('This media attempt is unavailable.');
  const key=`${userId}:${pageId}:${eventId}:${mediaId}`;
  if(running.has(key))throw Error('This media transfer or cleanup is already in progress.');
  running.add(key);let released=false;
  return ()=>{if(!released){released=true;running.delete(key);}};
}
