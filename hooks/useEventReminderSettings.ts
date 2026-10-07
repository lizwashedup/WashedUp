import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { loadCommunicationDraft, saveCommunicationDraft } from '../lib/communicationDraft';
import { loadEventReminders, saveEventReminders, sameReminderChoices, validReminderDraft,
  ReminderAccessDenied, ReminderConflict, ReminderRejected, type ReminderDraft, type ReminderSettings } from '../lib/eventReminders';

/** Draft retention stays local; only an explicit save changes shared event preferences. */
export function useEventReminderSettings(eventId: string, scope: CreatorPageScope, isAuthorized?: () => boolean) {
  const [,render] = useReducer(n=>n+1,0);
  const state = useMemo(()=>({loaded:false,loading:false,busy:false,localSaving:false,localError:'',readError:false,
    error:'',conflict:false,uncertain:false,denied:false,localRevision:0,saveOperation:0,
    remote:null as ReminderSettings|null,draft:null as ReminderDraft|null}),[eventId,scope]);
  const authority = useRef(isAuthorized); authority.current = isAuthorized;
  const owned = useRef(state); owned.current = state;
  const mounted = useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current = useCallback(()=>mounted.current && owned.current===state && scope.isCurrent(),[state,scope]);
  const canWrite = () => current() && (authority.current?.() ?? true);
  const publish = () => {if(current())render();};
  const persist = async (draft:ReminderDraft) => {
    const version=++state.localRevision;state.localSaving=true;state.localError='';publish();
    try {await requestWithDeadline(saveCommunicationDraft(eventId,'reminders',draft,scope),12_000);return state.localRevision===version;}
    catch {if(state.localRevision===version)state.localError='Couldn’t keep this draft on your device. Try again before leaving.';return false;}
    finally {if(state.localRevision===version)state.localSaving=false;publish();}
  };
  const load = useCallback(async()=>{
    if(!current() || state.loading || state.busy)return;
    state.loading=true;state.error='';render();
    let reading=true;
    const readScope={userId:scope.userId,isCurrent:()=>reading&&current()};
    try {
      const {remote,draft}=await requestWithDeadline((async()=>{
        const remote=await loadEventReminders(eventId,readScope);
        if(!readScope.isCurrent())throw Error('This visit has ended.');
        const draft=state.loaded ? state.draft : await loadCommunicationDraft(eventId,'reminders',readScope,validReminderDraft)
          .catch(()=>{throw Error('Couldn’t load your saved draft. Try again before editing.');});
        return {remote,draft};
      })(),12_000);
      if(!current())return;
      state.remote=remote;state.denied=false;state.readError=false;
      // Old account-owned drafts remain explicit choices, never silently submitted.
      const value=draft ?? remote;
      const matches=remote.revision!==null && sameReminderChoices(value,remote);
      state.conflict=!matches && !!draft && (draft.pageId!==undefined && draft.pageId!==remote.pageId
        || draft.baseRevision!==undefined && draft.baseRevision!==remote.revision);
      state.draft={dayBeforeOn:value.dayBeforeOn,dayOfOn:value.dayOfOn,pageId:remote.pageId,
        baseRevision:matches || !draft || draft.baseRevision===undefined ? remote.revision : draft.baseRevision};
      state.loaded=true;state.uncertain=false;
    } catch(error) {
      if(!current())return;
      if(error instanceof ReminderAccessDenied){state.denied=true;state.remote=null;}
      state.readError=!state.loaded;
      state.error=error instanceof Error ? error.message : 'Couldn’t check saved reminders. Try again.';
    } finally {reading=false;state.loading=false;if(current())render();}
  },[eventId,scope,state,current]);
  useEffect(()=>{void load();},[load]);
  const editable=state.loaded && !!state.remote && !state.denied && !state.busy && !state.loading && !state.uncertain;
  const closed=!!state.remote && (!['Draft','Live'].includes(state.remote.eventStatus)
    || !!state.remote.startsAt && Date.parse(state.remote.startsAt)<=Date.now());
  const saved=!!state.remote?.revision && !!state.draft && sameReminderChoices(state.draft,state.remote);
  return {...state,closed,saved,editable:editable && !closed,
    canSave:editable && !closed && !saved && !state.conflict && !state.localSaving && !state.localError,
    refresh:load,
    change(field:'dayBeforeOn'|'dayOfOn',value:boolean){
      if(!canWrite() || !editable || closed || state.busy || state.loading || state.uncertain || !state.draft)return;
      state.draft={...state.draft,[field]:value};state.error='';publish();void persist(state.draft);
    },
    async retryLocal(){if(!canWrite() || !state.draft || state.localSaving)return false;return persist(state.draft);},
    resolveConflict(useSaved:boolean){
      if(!canWrite() || !editable || state.busy || state.loading || state.uncertain || !state.remote || !state.draft)return;
      const value=useSaved?state.remote:state.draft;
      state.draft={dayBeforeOn:value.dayBeforeOn,dayOfOn:value.dayOfOn,pageId:state.remote.pageId,baseRevision:state.remote.revision};
      state.conflict=false;state.error='';publish();void persist(state.draft);
    },
    async save(){
      if(!canWrite() || !editable || closed || saved || state.conflict || state.localSaving || state.localError || !state.remote || !state.draft || state.busy || state.loading || state.uncertain)return;
      const operation=++state.saveOperation;
      state.busy=true;state.error='';publish();
      const desired={...state.draft},baseline=state.remote;
      let saving=true;
      const writeScope={userId:scope.userId,isCurrent:()=>saving&&canWrite()};
      try {
        const receipt=await requestWithDeadline(saveEventReminders(eventId,baseline,desired,writeScope),25_000);
        if(!current())return;
        state.remote=receipt;state.draft={...desired,pageId:receipt.pageId,baseRevision:receipt.revision};
        state.conflict=false;state.uncertain=false;
        // The server receipt is known; remaining local persistence has its own bounded state.
        state.busy=false;saving=false;
        await persist(state.draft);
      } catch(error) {
        if(!current())return;
        if(error instanceof ReminderAccessDenied){state.denied=true;state.remote=null;}
        else if(error instanceof ReminderConflict){state.conflict=true;state.uncertain=true;}
        else if(!(error instanceof ReminderRejected))state.uncertain=true;
        state.error=error instanceof RequestDeadlineError?'Couldn’t confirm this save. Check saved settings before trying again.':error instanceof Error?error.message:'Couldn’t confirm this save. Check saved settings.';
      } finally {saving=false;if(state.saveOperation===operation)state.busy=false;publish();}
    },
  };
}
