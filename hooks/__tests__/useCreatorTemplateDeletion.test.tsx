import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockDelete=jest.fn();
jest.mock('../../lib/creatorPageEventTemplateLibrary',()=>({deleteCreatorEventTemplate:(...args:unknown[])=>mockDelete(...args)}));
import {useCreatorTemplateDeletion} from '../useCreatorTemplateDeletion';
import type {CreatorPageScope} from '../../lib/creatorPageReview';
import type {PageEventLibraryTemplate} from '../../lib/creatorPageEventTemplateLibrary';
const template={id:'template',user_id:'owner',name:'Sunday gathering'} as PageEventLibraryTemplate;
let current=true,scope:CreatorPageScope,refresh:jest.Mock,tree:ReactTestRenderer,hook:ReturnType<typeof useCreatorTemplateDeletion>;
function Harness({owned}:{owned:CreatorPageScope|null}){hook=useCreatorTemplateDeletion(owned,refresh);return null;}
beforeEach(()=>{jest.clearAllMocks();current=true;scope={userId:'owner',isCurrent:()=>current};refresh=jest.fn().mockResolvedValue([]);mockDelete.mockResolvedValue(undefined);act(()=>{tree=create(<Harness owned={scope}/>);});});
afterEach(()=>act(()=>tree.unmount()));
it('requires an explicit confirmation and allows keeping the template',()=>{
 act(()=>hook.choose(template));expect(hook.current?.phase).toBe('confirm');expect(mockDelete).not.toHaveBeenCalled();
 act(()=>hook.cancel());expect(hook.current).toBeUndefined();expect(mockDelete).not.toHaveBeenCalled();
});
it('dispatches once even with repeated confirmation and the alert close callback',async()=>{
 let finish!:()=>void;mockDelete.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 act(()=>hook.choose(template));const confirm=hook.confirm,close=hook.cancel;let pending!:Promise<void>;
 act(()=>{pending=confirm();void confirm();close();});
 expect(mockDelete).toHaveBeenCalledTimes(1);expect(hook.busy).toBe(true);
 await act(async()=>{finish();await pending;});expect(hook.removedIds).toEqual(['template']);expect(refresh).toHaveBeenCalledTimes(1);expect(hook.current).toBeUndefined();
});
it('checks an uncertain result without sending a second delete, then removes a confirmed absent template',async()=>{
 mockDelete.mockRejectedValueOnce(Error('lost response'));act(()=>hook.choose(template));await act(async()=>{await hook.confirm();});
 expect(hook.current?.phase).toBe('check');await act(async()=>{await hook.confirm();});expect(mockDelete).toHaveBeenCalledTimes(1);
 await act(async()=>{await hook.check();});expect(mockDelete).toHaveBeenCalledTimes(1);expect(hook.removedIds).toEqual(['template']);
});
it('a fresh read showing the template still exists permits a new explicit confirmation',async()=>{
 mockDelete.mockRejectedValueOnce(Error('offline'));refresh.mockResolvedValue([template]);act(()=>hook.choose(template));await act(async()=>{await hook.confirm();});
 await act(async()=>{await hook.check();});expect(hook.removedIds).toEqual([]);expect(hook.current).toBeUndefined();
 act(()=>hook.choose(template));expect(hook.current?.phase).toBe('confirm');expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('a failed confirmation read leaves recovery available without resending',async()=>{
 mockDelete.mockRejectedValueOnce(Error('lost response'));refresh.mockRejectedValue(Error('offline'));act(()=>hook.choose(template));await act(async()=>{await hook.confirm();});
 await act(async()=>{await hook.check();});expect(hook.current?.phase).toBe('check');expect(hook.removedIds).toEqual([]);expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('retired confirmation cannot dispatch deletion',async()=>{
 act(()=>hook.choose(template));const confirm=hook.confirm;current=false;await act(async()=>{await confirm();});expect(mockDelete).not.toHaveBeenCalled();
});
it('late original-account completion cannot remove a new account’s template or refresh its library',async()=>{
 let finish!:()=>void;mockDelete.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));act(()=>hook.choose(template));let pending!:Promise<void>;act(()=>{pending=hook.confirm();});
 current=false;const other={userId:'other',isCurrent:()=>true};act(()=>tree.update(<Harness owned={other}/>));
 await act(async()=>{finish();await pending;});expect(hook.current).toBeUndefined();expect(hook.removedIds).toEqual([]);expect(refresh).not.toHaveBeenCalled();
});
