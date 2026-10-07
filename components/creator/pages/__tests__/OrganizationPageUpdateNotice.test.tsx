import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockLoad=jest.fn();
jest.mock('../../../../lib/organizationPageUpdate',()=>({loadOrganizationPageUpdate:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',semibold:'System'}})}));
import {OrganizationPageUpdateNotice} from '../OrganizationPageUpdateNotice';
let tree:ReactTestRenderer;const scope={userId:'member',isCurrent:()=>true};
beforeEach(()=>jest.clearAllMocks());afterEach(()=>act(()=>tree?.unmount()));
it('shows the saved update on its exact page',async()=>{mockLoad.mockResolvedValue({body:'Saved page update'});await act(async()=>{tree=create(<OrganizationPageUpdateNotice pageId="page" updateId="update" scope={scope}/>);});expect(mockLoad).toHaveBeenCalledWith('page','update',scope);expect(JSON.stringify(tree.toJSON())).toContain('Saved page update');});
it('keeps missing updates distinct from failed reads and offers an explicit retry',async()=>{mockLoad.mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce(null);await act(async()=>{tree=create(<OrganizationPageUpdateNotice pageId="page" updateId="update" scope={scope}/>);});expect(JSON.stringify(tree.toJSON())).toContain('could not be loaded');const action=tree.root.findAll(v=>v.props.accessibilityLabel==='Check update'&&v.props.onPress)[0];await act(async()=>action.props.onPress());expect(JSON.stringify(tree.toJSON())).toContain('no longer available');});
