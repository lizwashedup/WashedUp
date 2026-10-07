import {useRef,useState} from 'react';
import type {CreatorPageScope} from '../lib/creatorPageReview';
import {deleteCreatorEventTemplate,type PageEventLibraryTemplate} from '../lib/creatorPageEventTemplateLibrary';

type State={scope:CreatorPageScope;template:PageEventLibraryTemplate;phase:'confirm'|'deleting'|'check'|'checking';message?:string};
/** Keep an uncertain deletion read-only until a fresh library resolves it. */
export function useCreatorTemplateDeletion(scope:CreatorPageScope|null,refresh:()=>Promise<PageEventLibraryTemplate[]|undefined>){
 const [state,setState]=useState<State>(),[removed,setRemoved]=useState<{scope:CreatorPageScope;ids:string[]}>();
 const lock=useRef<CreatorPageScope|null>(null),current=state?.scope===scope&&scope?.isCurrent()?state:undefined;
 const forget=(owned:CreatorPageScope,id:string)=>setRemoved(old=>({scope:owned,ids:[...(old?.scope===owned?old.ids:[]),id]}));
 const choose=(template:PageEventLibraryTemplate)=>{
  if(scope?.isCurrent()&&lock.current!==scope&&!current)setState({scope,template,phase:'confirm'});
 };
 const cancel=()=>setState(old=>old?.scope===scope&&old.phase==='confirm'?undefined:old);
 const confirm=async()=>{
  if(!current||current.phase!=='confirm'||!scope?.isCurrent()||lock.current===scope)return;
  const owned=scope,template=current.template;lock.current=owned;setState({...current,phase:'deleting'});
  try{
   await deleteCreatorEventTemplate(template,owned);
   if(!owned.isCurrent())return;
   forget(owned,template.id);setState(undefined);
   await refresh().catch(()=>undefined);
  }catch{
   if(owned.isCurrent())setState({scope:owned,template,phase:'check',message:'We couldn’t confirm the deletion. Check your templates before trying again.'});
  }finally{if(lock.current===owned)lock.current=null;}
 };
 const check=async()=>{
  if(!current||current.phase!=='check'||!scope?.isCurrent()||lock.current===scope)return;
  const owned=scope,template=current.template;lock.current=owned;setState({...current,phase:'checking'});
  try{
   const rows=await refresh();if(!owned.isCurrent())return;
   if(!rows)throw Error('Unconfirmed library');
   if(!rows.some(row=>row.id===template.id))forget(owned,template.id);
   setState(undefined);
  }catch{
   if(owned.isCurrent())setState({scope:owned,template,phase:'check',message:'Your templates could not be checked. Try again when you’re connected.'});
  }finally{if(lock.current===owned)lock.current=null;}
 };
 return {current,choose,cancel,confirm,check,busy:current?.phase==='deleting'||current?.phase==='checking',removedIds:removed?.scope===scope?removed.ids:[]};
}
