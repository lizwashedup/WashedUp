import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
// Execute the actual callback; no copied route switch or database operation.
const source=fs.readFileSync(path.join(__dirname,'../InboxModal.tsx'),'utf8');
const start=source.indexOf('  const handleNotifAction = useCallback(');
const end=source.indexOf('\n  }, [',start);
if(start<0||end<0)throw Error('Inbox handler boundary changed');
const code=ts.transpileModule(source.slice(start,end)+'\n  }, []);globalThis.handler=handleNotifAction;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
it.each(['people_request_accepted','referral_joined'])('opens People explicitly for %s when Yours may retain another tab',async type=>{
 const push=jest.fn(),close=jest.fn();const context:any={notificationScope:{isCurrent:()=>true},userId:'viewer',useCallback:(f:any)=>f,hapticLight:()=>{},supabase:{from:()=>({update:()=>{const query:any={eq:()=>query,then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return query;}})},refetchNotifs:jest.fn(),queryClient:{invalidateQueries:jest.fn()},INBOX_COUNT_KEY:['inbox'],YOURS_NOTIF_TYPES:new Set(['people_request','people_request_accepted','referral_joined']),YOURS_PAGE_ENABLED:true,router:{push},onClose:close};
 vm.runInNewContext(code,context);await context.handler('notice','acted',undefined,type);expect(push).toHaveBeenCalledWith('/(tabs)/friends?tab=people');expect(close).toHaveBeenCalledTimes(1);
});
