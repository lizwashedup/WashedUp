import React from 'react';
import {act,create} from 'react-test-renderer';
import {Image} from 'expo-image';
import {EventPoster} from '../EventPoster';
jest.mock('../../../lib/sceneDiscovery',()=>({eventKickerLabel:()=>null}));
jest.mock('../GeneratedPoster',()=>({GeneratedPoster:()=>null}));
const event:any={id:'same-event',title:'Dinner',event_date:null,venue:null,community_id:null,public_name:'Old override',organizer_name:'Old profile',organizer_logo:'old-logo',image_url:'event-art',published_page:{pageId:'page',name:'Exact organization'}};
it.each(['featured','compact'] as const)('uses the exact page byline and event artwork in %s density',variant=>{
 let tree:any;const open=jest.fn();act(()=>{tree=create(<EventPoster event={event} width={390} onPress={open} variant={variant}/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Exact organization');expect(JSON.stringify(tree.toJSON())).not.toContain('Old override');
 expect(tree.root.findAllByType(Image).map((i:any)=>i.props.source.uri)).toEqual(['event-art']);
 const press=tree.root.findAll((v:any)=>v.props.onPress===open)[0];act(()=>press.props.onPress());expect(open).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
it('keeps known unavailable attribution blank and legacy attribution unchanged',()=>{
 let tree:any;act(()=>{tree=create(<EventPoster event={{...event,published_page:null}} width={390} onPress={()=>{}}/>);});
 expect(JSON.stringify(tree.toJSON())).not.toContain('Old override');
 act(()=>tree.update(<EventPoster event={{...event,published_page:undefined}} width={390} onPress={()=>{}}/>));
 expect(JSON.stringify(tree.toJSON())).toContain('Old override');expect(tree.root.findAllByType(Image).map((i:any)=>i.props.source.uri)).toContain('old-logo');act(()=>tree.unmount());
});

it('preserves a community leader portrait beside the exact community identity',()=>{let tree:any;act(()=>{tree=create(<EventPoster event={{...event,community_id:'community',leader_avatar_url:'leader-face',published_page:{pageId:'community',kind:'community',name:'Exact community'}}} width={390} onPress={()=>{}}/>);});expect(tree.root.findAllByType(Image).map((i:any)=>i.props.source.uri)).toContain('leader-face');expect(JSON.stringify(tree.toJSON())).toContain('Exact community');act(()=>tree.unmount());});

it('tries replacement artwork after a failed legacy image rather than keeping the old failure',()=>{
 let tree:any;act(()=>{tree=create(<EventPoster event={event} width={390} onPress={()=>{}}/>);});
 act(()=>tree.root.findByType(Image).props.onError());expect(tree.root.findAllByType(Image)).toHaveLength(0);
 act(()=>tree.update(<EventPoster event={{...event,image_url:'replacement-art'}} width={390} onPress={()=>{}}/>));
 expect(tree.root.findByType(Image).props.source.uri).toBe('replacement-art');act(()=>tree.unmount());
});

// A stored UTC instant must remain on the Los Angeles day and clock.
it.each(['grid','compact','featured'] as const)('shows LA start time without requiring a separate date in %s',variant=>{
 let tree:any;act(()=>{tree=create(<EventPoster event={{...event,event_date:null,start_time:'2026-09-20T01:30:00Z'}} width={170} onPress={()=>{}} variant={variant}/>);});
 const rendered=JSON.stringify(tree.toJSON());expect(rendered).toContain('Sep 19');expect(rendered).toContain('6:30 pm');expect(rendered).not.toContain('Sep 20');act(()=>tree.unmount());
});
it('keeps date-only listings free of invented times and exposes card context',()=>{
 let tree:any;act(()=>{tree=create(<EventPoster event={{...event,event_date:'2026-09-19',start_time:null,venue:'Ocean Park'}} width={170} onPress={()=>{}} variant="grid"/>);});
 const card=tree.root.findAll((v:any)=>v.props.accessibilityRole==='button')[0];expect(card.props.accessibilityLabel).toContain('Sep 19');expect(card.props.accessibilityLabel).toContain('Ocean Park');expect(card.props.accessibilityLabel).not.toMatch(/am|pm/);act(()=>tree.unmount());
});
