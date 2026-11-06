import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Text, TouchableOpacity} from 'react-native';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import SharedId from '../../app/e/[id]';
import SharedSlug from '../../app/plans/[slug]';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockLookup=jest.fn();
let mockParams:Record<string,string>={};
let mockEpoch=1;
const mockViewerCurrent=()=>true;
jest.mock('../../hooks/useObservedUser',()=>({useObservedUser:()=>({
  viewerId:'viewer-'+mockEpoch,epoch:mockEpoch,isCurrent:mockViewerCurrent,isLoading:false,error:null,
})}));
jest.mock('expo-router',()=>({
  useLocalSearchParams:()=>mockParams,router:{replace:jest.fn()},
  Redirect:({href}:{href:string})=>require('react').createElement(require('react-native').Text,null,href),
}));
jest.mock('../../lib/supabase',()=>({supabase:{from:(table:string)=>({
  select:()=>({eq:(field:string,value:string)=>({maybeSingle:()=>mockLookup(table,field,value)})}),
})}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));

describe('a shared link landing',()=>{
  let tree:ReactTestRenderer, client:QueryClient;
  const screen=(kind:'id'|'slug')=><QueryClientProvider client={client}>{kind==='id'?<SharedId/>:<SharedSlug/>}</QueryClientProvider>;
  const words=()=>tree.root.findAllByType(Text).map(n=>n.props.children);
  async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,12));});}
  async function mount(kind:'id'|'slug'){
    await act(async()=>{tree=create(screen(kind));}); await settle();
  }
  beforeEach(()=>{mockLookup.mockReset();mockEpoch=1;mockParams={id,slug:'sunset',task:'bring water'};
    client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
  afterEach(()=>{act(()=>tree.unmount());client.clear();});
  it.each(['id','slug'] as const)('offers retry for a failed %s lookup and opens the recovered destination',async kind=>{
    delete mockParams[kind==='id'?'slug':'id'];
    mockLookup.mockResolvedValueOnce({error:{code:'NETWORK'},data:null}).mockResolvedValue({error:null,data:{id}});
    await mount(kind);
    expect(words()).toContain('try again');
    expect(words()).not.toContain('this one is gone');
    const retry=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='try again'))!;
    await act(async()=>retry.props.onPress());await settle();
    expect(words()).toContain((kind==='id'?'/event/':'/plan/')+id+'?task=bring%20water');
  });
  it('checks plans only after a confirmed event miss, and preserves the missing result',async()=>{
    mockParams={id};mockLookup.mockResolvedValue({data:null,error:null});
    await mount('id');
    expect(mockLookup.mock.calls.map(c=>c[0])).toEqual(['explore_events','events']);
    expect(words()).toContain('this link isn’t available');
    expect(words()).not.toContain('try again');
  });

  it('opens the plan after a successful event miss and keeps its query parameters',async()=>{
    mockParams={id,filter:'near me'};
    mockLookup.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{id},error:null});
    await mount('id');
    expect(words()).toContain('/plan/'+id+'?filter=near%20me');
  });
  it('treats an invalid UUID as unavailable and a denied read as retryable',async()=>{
    mockParams={id:'malformed'};
    mockLookup.mockResolvedValueOnce({data:null,error:{code:'22P02'}});
    await mount('id');expect(words()).toContain('this link isn’t available');
    mockParams={id};mockLookup.mockResolvedValueOnce({data:null,error:{code:'42501'}});
    await act(async()=>tree.update(screen('id')));await settle();
    expect(words()).toContain('try again');
    expect(mockLookup.mock.calls.map(c=>c[0])).toEqual(['explore_events','explore_events']);
  });
  it.each(['link','account'])('does not redirect from the previous %s when its lookup finishes late',async change=>{
    let finish!:(value:unknown)=>void;
    mockParams={slug:'one'};
    mockLookup.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    await mount('slug');
    if(change==='link')mockParams={slug:'two'};else mockEpoch++;
    mockLookup.mockResolvedValueOnce({data:null,error:null});
    await act(async()=>tree.update(screen('slug')));await settle();
    await act(async()=>finish({data:{id},error:null}));await settle();
    expect(words()).toContain('this link isn’t available');
    expect(words()).not.toContain('/plan/'+id);
  });
});
