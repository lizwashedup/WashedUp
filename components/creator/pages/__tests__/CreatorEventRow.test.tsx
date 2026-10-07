import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import MenuCard from '../../../menu/MenuCard';
import { CreatorEventRow } from '../CreatorEventRow';
jest.mock('../../../menu/MenuCard',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
let tree:ReactTestRenderer, current=true, measured:((x:number,y:number,w:number,h:number)=>void)|undefined;
const edit=jest.fn(),manage=jest.fn(),duplicate=jest.fn(),view=jest.fn();
const event={id:'event',title:'Sunday picnic',status:'Live',event_date:null};
const props=()=>({event,ready:true,isCurrent:()=>current,editLabel:'Edit Sunday picnic',onEdit:edit,onManage:manage,onDuplicate:duplicate,onView:view});
const menu=()=>tree.root.findByType(MenuCard);
const options=()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Options for Sunday picnic'&&typeof n.props.onPress==='function')[0];
function mount(){act(()=>{tree=create(<CreatorEventRow {...props()}/>);});tree.root.findAllByType(View).forEach(n=>{if(jest.isMockFunction(n.instance?.measureInWindow))n.instance.measureInWindow.mockImplementation((callback:typeof measured)=>{measured=callback;});});}
beforeEach(()=>{jest.clearAllMocks();current=true;measured=undefined;});afterEach(()=>act(()=>tree?.unmount()));
it('opens the anchored menu from its named control and exposes each existing destination',()=>{
 mount();expect(menu().props.visible).toBe(false);act(()=>options().props.onPress());expect(measured).toBeDefined();
 act(()=>measured!(250,200,44,44));expect(menu().props.visible).toBe(true);expect(menu().props.anchor).toEqual({x:250,y:200,width:44,height:44});
 for(const row of menu().props.rows)act(()=>row.onPress());expect(manage).toHaveBeenCalledTimes(1);expect(duplicate).toHaveBeenCalledTimes(1);expect(view).toHaveBeenCalledTimes(1);expect(edit).not.toHaveBeenCalled();
 act(()=>menu().props.onClose());expect(menu().props.visible).toBe(false);
});
it('retired access prevents delayed menu opening and every previously rendered action',()=>{
 mount();act(()=>options().props.onPress());const actions=menu().props.rows.map((r:any)=>r.onPress);current=false;
 act(()=>{measured!(250,200,44,44);actions.forEach((press:()=>void)=>press());});expect(menu().props.visible).toBe(false);expect(manage).not.toHaveBeenCalled();expect(duplicate).not.toHaveBeenCalled();expect(view).not.toHaveBeenCalled();
});
it('loading closes a menu and a private draft never supplies a public destination',()=>{
 mount();act(()=>options().props.onPress());act(()=>measured!(250,200,44,44));
 act(()=>tree.update(<CreatorEventRow {...props()} ready={false}/>));expect(menu().props.visible).toBe(false);
 act(()=>tree.update(<CreatorEventRow {...props()} event={{...event,status:'Draft'}}/>));expect(menu().props.rows.map((r:any)=>r.key)).toEqual(['manage','duplicate']);
});
