import React,{useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Image} from 'expo-image';
const mockLoad=jest.fn();
jest.mock('../../../../lib/creatorPageMedia',()=>({loadPageCoverSource:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System'}})}));
jest.mock('../PageFrame',()=>({pageStyles:{small:{}},PageAction:()=>null}));
import {PageCover} from '../PageCover';
import {PageAction} from '../PageFrame';
let tree:ReactTestRenderer;
const scope={userId:'creator',isCurrent:()=>true};
const source={uri:'http://127.0.0.1:55321/private-image',headers:{Authorization:'Bearer test'}};
beforeEach(()=>{jest.clearAllMocks();mockLoad.mockResolvedValue(source);});
afterEach(()=>act(()=>tree?.unmount()));
it('waits for parent scope activation and keeps readiness false until the whole image decodes',async()=>{
 let active=false;const owned={...scope,isCurrent:()=>active},ready=jest.fn();
 function Parent(){useEffect(()=>{active=true;return()=>{active=false;};},[]);return <PageCover pageId="page" mediaId="cover" scope={owned} onReady={ready}/>;}
 await act(async()=>{tree=create(<Parent/>);});expect(mockLoad).toHaveBeenCalledTimes(1);expect(ready).not.toHaveBeenCalledWith(true);
 const image=tree.root.findByType(Image);expect(image.props.cachePolicy).toBe('none');expect(image.props.contentFit).toBe('contain');
 act(()=>image.props.onLoad({source:{width:800,height:600}}));expect(ready).toHaveBeenLastCalledWith(true);expect(tree.root.findByType(Image).props.style.aspectRatio).toBe(4/3);
});
it('requires a fresh authenticated read after a decoding failure',async()=>{
 const ready=jest.fn();await act(async()=>{tree=create(<PageCover pageId="page" mediaId="cover" scope={scope} onReady={ready}/>);});
 act(()=>tree.root.findByType(Image).props.onError());expect(ready).toHaveBeenLastCalledWith(false);expect(tree.root.findAllByType(Image)).toHaveLength(0);
 await act(async()=>tree.root.findByType(PageAction).props.onPress());expect(mockLoad).toHaveBeenCalledTimes(2);expect(ready).not.toHaveBeenCalledWith(true);
});
it('ignores a retired image callback after page/media changes and does not display the old source',async()=>{
 const ready=jest.fn();await act(async()=>{tree=create(<PageCover pageId="one" mediaId="old" scope={scope} onReady={ready}/>);});
 const late=tree.root.findByType(Image).props.onLoad;let resolve:any;mockLoad.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>tree.update(<PageCover pageId="two" mediaId="new" scope={scope} onReady={ready}/>));
 expect(tree.root.findAllByType(Image)).toHaveLength(0);act(()=>late({source:{width:1,height:1}}));expect(ready).not.toHaveBeenCalledWith(true);
 await act(async()=>resolve({...source,uri:'new-image'}));expect(tree.root.findByType(Image).props.source.uri).toBe('new-image');
});

it('keeps a portrait cover fully visible inside a bounded preview after decoding',async()=>{
 await act(async()=>{tree=create(<PageCover pageId="page" mediaId="portrait" scope={scope}/>);});
 act(()=>tree.root.findByType(Image).props.onLoad({source:{width:800,height:1600}}));
 const image=tree.root.findByType(Image);
 expect(image.props.contentFit).toBe('contain');
 expect(image.props.style.aspectRatio).toBe(4/3);
});
