import React from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {ArrowUpRight,Clock3,Wallet} from 'lucide-react-native';
import Colors,{AfterglowColors as C,SceneDetailColors as Scene,CreatorSurfaceColors as Surface} from '../../constants/Colors';
import {AfterglowType as T,FontSizes,LineHeights} from '../../constants/Typography';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {PageAction} from './pages/PageFrame';
import {computeNetToYouCents} from './MoneySummaryCard';
import {isPayoutReady} from '../../lib/ticketing';
import {eventSummaryDate} from '../../lib/eventSummary';
import type {EventEarnings} from '../../lib/eventEarnings';
import type {EventMoneySummary} from '../../lib/ticketAttendees';

export function earningsStatus(m:EventMoneySummary){
  if(m.payoutStatus==='failed')return 'Payout needs attention';
  if(m.payoutStatus==='canceled'||m.payoutStatus==='cancelled')return 'Payout cancelled';
  if(m.payoutStatus==='paid'||m.payoutPaidAt)return 'Payout recorded as paid';
  if(m.payoutStatus==='released'||m.payoutReleasedAt)return 'Payout released';
  if(m.payoutStatus==='pending')return 'Payout pending';
  return 'No payout released';
}
const formatCents=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
function recordedDate(iso:string|null){return iso&&Number.isFinite(Date.parse(iso))?new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):null;}

export function EventEarningsView({data,disabled,onSetup,onSupport,onRefresh}:{data:EventEarnings;disabled:boolean;onSetup:()=>void;onSupport:()=>void;onRefresh:()=>void}){
  const {fonts:f}=useAfterglowFonts(true,'creator');
  const {event,money,payout,isPayee,setupError}=data;
  const net=computeNetToYouCents(money,data.refundedCents);
  const ready=isPayoutReady(payout);
  const setupNeeded=isPayee&&payout&&!ready&&(!payout.detailsSubmitted||payout.requirementsDue.length>0);
  const reviewing=isPayee&&payout&&!ready&&!setupNeeded;
  const failed=['failed','canceled','cancelled'].includes(money.payoutStatus??'');
  const text=[s.body,{fontFamily:f.regular}],label=[s.label,{fontFamily:f.medium}];
  const row=(name:string,value:string,strong=false)=><View key={name} style={s.row}><Text style={[text,{flex:1},strong&&{fontFamily:f.medium,color:C.ink}]}>{name}</Text><Text style={[s.number,{fontFamily:strong?f.medium:f.regular}]}>{value}</Text></View>;
  return <View style={s.content}>
    <View style={s.identity}><Text accessibilityRole="header" style={[s.title,{fontFamily:f.display}]}>Earnings</Text><Text style={[s.event,{fontFamily:f.medium}]}>{event.title}</Text><Text style={text}>{eventSummaryDate(event.event_date??'',event.start_time)}</Text></View>
    <LinearGradient colors={[Scene.middle,Scene.lower]} start={{x:0,y:0}} end={{x:1,y:1}} style={s.hero}>
      <View style={s.heroLabel}><Wallet size={18} strokeWidth={1.5} color={Scene.supporting}/><Text style={[s.label,{fontFamily:f.medium,color:Scene.supporting}]}>Net ticket sales</Text></View>
      <Text style={[s.total,{fontFamily:f.display}]}>{formatCents(net)}</Text>
      <Text style={[s.body,{fontFamily:f.regular,color:Scene.supporting}]}>After platform fees and partial refunds</Text>
      <View style={s.heroFooter}><Text style={[s.body,{fontFamily:f.medium,color:Scene.text}]}>{data.ticketsSold} {data.ticketsSold===1?'ticket':'tickets'} sold</Text><Text style={[s.caption,{fontFamily:f.regular,color:Scene.supporting}]}>Event total · USD</Text></View>
    </LinearGradient>
    <View style={s.payout}>
      <View style={s.heroLabel}><Clock3 size={18} strokeWidth={1.5} color={C.muted}/><Text accessibilityRole="header" style={[s.event,{fontFamily:f.medium,flex:1}]}>{earningsStatus(money)}</Text></View>
      {!!recordedDate(money.payoutReleasedAt)&&row('Released',recordedDate(money.payoutReleasedAt)!)}
      {!!recordedDate(money.payoutPaidAt)&&row('Recorded as paid',recordedDate(money.payoutPaidAt)!)}
      <Text style={text}>{failed?'This payout needs a review. Check the payout settings and contact us if you need help.':money.payoutPaidAt?'Your payout record is marked paid. If it hasn’t reached your bank, contact us for help.':money.payoutReleasedAt?'The bank arrival estimate isn’t available in WashedUp yet. You don’t need to repeat setup to get this date.':net<=0?'There are no net ticket sales to pay out yet.':'Your net ticket sales are shown above. A bank arrival date has not been confirmed.'}</Text>
      {setupError?<><Text style={text}>We couldn’t check payout setup.</Text><PageAction title="Retry payout status" disabled={disabled} onPress={onRefresh}/></>:setupNeeded?<>
        <Text style={label}>{payout!.exists?'Finish payout setup':'Set up payouts'}</Text>
        <Text style={text}>Add or update your bank and verification details securely with Stripe.</Text>
        {payout!.requirementsDue.map(item=><Text key={item} style={text}>• {item}</Text>)}
        <PageAction primary title="Complete payout setup" disabled={disabled} leadingIcon={<ArrowUpRight size={18} color={Colors.white}/>} onPress={onSetup}/>
      </>:reviewing?<><Text style={label}>Payout setup is being reviewed</Text><Text style={text}>No additional details are currently listed. Check again for an updated status.</Text><PageAction title="Check for updates" disabled={disabled} onPress={onRefresh}/></>:isPayee&&ready?<><Text style={label}>Payout setup complete</Text><PageAction quiet disclosure title="Payout settings" disabled={disabled} onPress={onSetup}/></>:<Text style={text}>The payout recipient manages the bank account and verification details.</Text>}
      <PageAction quiet disclosure title="Get payout help" disabled={disabled} onPress={onSupport}/>
    </View>
    <View style={s.breakdown}><Text accessibilityRole="header" style={[s.section,{fontFamily:f.display}]}>Sales breakdown</Text>
      {row('Ticket sales',formatCents(money.grossFaceCents))}
      {row('Platform fees',formatCents(money.commissionCents))}
      {data.refundedCents>0&&row('Partial refunds',formatCents(data.refundedCents))}
      {row('Net ticket sales',formatCents(net),true)}
      <Text style={[s.caption,{fontFamily:f.regular}]}>Fully refunded orders are excluded from these totals.</Text>
    </View>
    <View style={s.processing}>{row('Card processing',formatCents(money.processingCents))}<Text style={[s.caption,{fontFamily:f.regular}]}>Shown separately; not deducted again from net ticket sales.</Text></View>
  </View>;
}
const s=StyleSheet.create({
 content:{gap:20},identity:{gap:6},title:{...T.pageTitle,color:C.ink},event:{...T.title,color:C.ink},body:{...T.body,color:C.muted},label:{...T.caption,color:C.ink},caption:{...T.caption,color:C.muted},
 hero:{padding:22,gap:10,borderRadius:18,borderWidth:StyleSheet.hairlineWidth,borderColor:Surface.goldEdge},heroLabel:{flexDirection:'row',alignItems:'center',gap:8},total:{fontSize:FontSizes.displayXL,lineHeight:LineHeights.displayLG,color:Scene.text},heroFooter:{marginTop:8,paddingTop:14,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Scene.border,gap:4},
 payout:{backgroundColor:Colors.white,borderWidth:StyleSheet.hairlineWidth,borderColor:Surface.goldEdge,borderRadius:14,padding:18,gap:12},
 breakdown:{backgroundColor:Colors.white,borderRadius:14,padding:18,gap:6},section:{...T.pageSection,color:C.ink,marginBottom:6},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',justifyContent:'space-between',gap:12,paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:C.subtleLine},number:{...T.body,color:C.ink,fontVariant:['tabular-nums'],flexShrink:1},processing:{paddingHorizontal:4,gap:6},
});
