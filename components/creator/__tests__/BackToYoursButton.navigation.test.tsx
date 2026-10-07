import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockReplace=jest.fn();
jest.mock('expo-router',()=>({router:{replace:(...args:any[])=>mockReplace(...args)}}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
import {BackToYoursButton} from '../BackToYoursButton';
it('returns to the Yours collection promised by the label and hint',()=>{let tree:ReactTestRenderer;act(()=>{tree=create(<BackToYoursButton/>)});const button=tree!.root.findAll(n=>n.props.accessibilityLabel==='Back to Yours'&&typeof n.props.onPress==='function')[0];expect(button.props.accessibilityHint).toBe('Returns to your plans, people and circles');act(()=>button.props.onPress());expect(mockReplace).toHaveBeenCalledTimes(1);expect(mockReplace).toHaveBeenCalledWith('/(tabs)/friends');act(()=>tree!.unmount());});
