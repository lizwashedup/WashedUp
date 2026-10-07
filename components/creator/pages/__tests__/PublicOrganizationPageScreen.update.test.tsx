import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import PublicOrganizationPageScreen from '../PublicOrganizationPageScreen';
const mockPage=jest.fn(),mockUpdate=jest.fn();
const mockScope={userId:'viewer',isCurrent:()=>true};
jest.mock('../../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null,retry:jest.fn()},focused:true})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/publishedOrganizationPage',()=>({loadPublishedOrganizationPage:(...args:any[])=>mockPage(...args)}));
jest.mock('../../../../lib/organizationPageUpdate',()=>({loadOrganizationPageUpdate:(...args:any[])=>mockUpdate(...args)}));
jest.mock('../OrganizationPageFollowControls',()=>({OrganizationPageFollowControls:()=>null}));
jest.mock('../PublishedPageCover',()=>({PublishedPageCover:()=>null}));
jest.mock('../../../ProfileButton',()=>{const {createElement:element}=require('react'),{Pressable}=require('react-native');return{__esModule:true,default:()=>element(Pressable,{accessibilityRole:'button',accessibilityLabel:'Profile'})};});
jest.mock('expo-router',()=>({Stack:{Screen:()=>null},router:{back:jest.fn(),push:jest.fn()}}));
let tree:ReactTestRenderer;
async function flush(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockPage.mockReset().mockResolvedValue(null);mockUpdate.mockReset().mockResolvedValue({body:'The complete saved update.'});});
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllTimers();jest.useRealTimers();});
it('keeps an independently authorized update readable when the page projection is unavailable',async()=>{
 await act(async()=>{tree=create(<PublicOrganizationPageScreen pageId="page" updateId="update"/>);});await flush();
 expect(JSON.stringify(tree.toJSON())).toContain('The complete saved update.');expect(JSON.stringify(tree.toJSON())).toContain('This organization page is unavailable.');
 expect(tree.root.findAll(node=>node.props.accessibilityLabel==='Profile').length).toBeGreaterThan(0);
});
it('releases a stalled page for retry while preserving update content and retiring old work',async()=>{
 mockPage.mockReturnValueOnce(new Promise(()=>{}));await act(async()=>{tree=create(<PublicOrganizationPageScreen pageId="page" updateId="update"/>);});await flush();
 expect(JSON.stringify(tree.toJSON())).toContain('The complete saved update.');await act(async()=>jest.advanceTimersByTime(12001));await flush();
 expect(JSON.stringify(tree.toJSON())).toContain('This page could not be loaded.');expect(mockPage.mock.calls[0][1].isCurrent()).toBe(false);
 const retry=tree.root.findAll(node=>node.props.accessibilityLabel==='Try again'&&node.props.onPress)[0];act(()=>retry.props.onPress());await flush();expect(mockPage).toHaveBeenCalledTimes(2);expect(JSON.stringify(tree.toJSON())).toContain('This organization page is unavailable.');
});
