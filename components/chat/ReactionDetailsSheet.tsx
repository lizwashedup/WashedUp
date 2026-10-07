import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isMessageReactionRemoved, loadMessageReactionDetails, removeMessageReaction, type ReactionDetailsScope, type ReactionDetailsTarget, type ReactionPerson } from '../../lib/messageReactionDetails';

export interface ReactionDetailsRequest extends ReactionDetailsTarget {
  scope: ReactionDetailsScope;
  canRemove: () => boolean;
  onChanged: () => void;
}
const keyFor = (person: ReactionPerson) => JSON.stringify([person.userId, person.storageKey]);

/** A read of the existing reaction stores. No profile discovery or new reaction policy. */
export function ReactionDetailsSheet({ request, onClose }: { request: ReactionDetailsRequest | null; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<ReactionPerson[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(request), readAttempt = useRef<object | null>(null), writeAttempt = useRef<object | null>(null);
  const isCurrent = useCallback(() => !!request && active.current === request && request.scope.isCurrent(), [request]);
  const scope = useMemo(() => ({ userId: request?.scope.userId ?? '', isCurrent }), [request, isCurrent]);
  useLayoutEffect(() => {
    active.current = request; readAttempt.current = null; writeAttempt.current = null;
    setPeople([]); setNextOffset(null); setLoading(false); setLoadError(false); setBusyKey(null); setUncertain(null); setNotice(null);
    return () => { active.current = null; readAttempt.current = null; writeAttempt.current = null; };
  }, [request]);
  const load = useCallback(async (offset = 0) => {
    if (!request || !isCurrent() || readAttempt.current) return;
    const attempt = {}; readAttempt.current = attempt; setLoading(true); setLoadError(false);
    try {
      const page = await loadMessageReactionDetails(request, scope, offset);
      if (!isCurrent() || readAttempt.current !== attempt) return;
      setPeople(previous => [...new Map([...(offset ? previous : []), ...page.people].map(person => [keyFor(person), person])).values()]);
      setNextOffset(page.nextOffset);
    } catch { if (isCurrent() && readAttempt.current === attempt) setLoadError(true); }
    finally { if (isCurrent() && readAttempt.current === attempt) { readAttempt.current = null; setLoading(false); } }
  }, [request, scope, isCurrent]);
  useEffect(() => { if (request) void load(); }, [request, load]);
  const close = () => { active.current = null; readAttempt.current = null; writeAttempt.current = null; onClose(); };
  const remove = async (person: ReactionPerson, checkOnly = false) => {
    if (!request || !isCurrent() || !person.mine || writeAttempt.current || (!checkOnly && (!request.canRemove() || uncertain))) return;
    const attempt = {}, key = keyFor(person); writeAttempt.current = attempt; setBusyKey(key); setNotice(null);
    const writeScope = { userId: scope.userId, isCurrent: () => isCurrent() && (checkOnly || request.canRemove()) };
    try {
      let removed = true;
      if (checkOnly) removed = await isMessageReactionRemoved(request, person.storageKey, writeScope);
      else await removeMessageReaction(request, person.storageKey, writeScope);
      if (!isCurrent() || writeAttempt.current !== attempt) return;
      setUncertain(null);
      if (removed) {
        // Reset pagination after a deletion so shifted rows cannot be skipped.
        request.onChanged(); readAttempt.current = null; void load();
        setPeople(previous => previous.filter(item => keyFor(item) !== key));
      } else setNotice('Your reaction is still here. You can remove it again.');
    } catch {
      if (isCurrent() && writeAttempt.current === attempt) { setUncertain(key); setNotice('We couldn’t confirm the change. Check its status before trying again.'); }
    } finally { if (isCurrent() && writeAttempt.current === attempt) { writeAttempt.current = null; setBusyKey(null); } }
  };
  const visible = !!request && request.scope.isCurrent();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
    <View style={s.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close reaction details" />
      <View accessibilityViewIsModal style={[s.sheet, { maxHeight: Math.max(180, height - 64), paddingBottom: Math.max(12, insets.bottom) }]}>
        <View style={s.heading}><Text style={s.title} accessibilityRole="header">Reactions</Text><Pressable style={s.close} onPress={close} accessibilityRole="button" accessibilityLabel="Close reaction details"><X size={22} color={Colors.asphalt}/></Pressable></View>
        <Text style={s.subtitle}>Who reacted to this message</Text>
        <FlatList data={people} keyExtractor={keyFor} style={s.list} keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const key = keyFor(item), pending = busyKey === key, checking = uncertain === key;
            return <View style={s.person}>
              {item.photo ? <Image source={{uri:item.photo}} style={s.avatar} contentFit="cover" accessibilityIgnoresInvertColors/> : <View style={[s.avatar,s.initial]}><Text style={s.initialText}>{item.name?.slice(0,1).toUpperCase() ?? '·'}</Text></View>}
              <View style={s.identity}><Text style={s.name}>{item.mine ? 'You' : item.name ?? 'Member unavailable'}</Text>{item.mine && <Text style={s.meta}>Your reaction</Text>}</View>
              <Text style={s.emoji} accessibilityLabel={`Reaction ${item.emoji}`}>{item.emoji}</Text>
              {item.mine && (request?.canRemove() || checking) && <Pressable style={s.remove} disabled={!!busyKey || (!!uncertain && !checking)} onPress={() => { void remove(item, checking); }} accessibilityRole="button" accessibilityLabel={`${checking ? 'Check' : 'Remove'} your ${item.emoji} reaction`} accessibilityState={{busy:pending,disabled:!!busyKey || (!!uncertain && !checking)}}>
                {pending ? <ActivityIndicator color={Colors.terracotta} size="small"/> : <Text style={s.action}>{checking ? 'Check' : 'Remove'}</Text>}
              </Pressable>}
            </View>;
          }}
          ListEmptyComponent={!loading && !loadError ? <Text style={s.empty}>No reactions on this message yet.</Text> : null}
          ListFooterComponent={<View style={s.footer}>
            {loading && <View accessibilityRole="progressbar" accessibilityLabel="Loading reactions"><ActivityIndicator color={Colors.terracotta}/></View>}
            {loadError && <><Text style={s.empty}>Reactions couldn’t load.</Text><Pressable style={s.retry} onPress={() => { void load(people.length ? nextOffset ?? 0 : 0); }} accessibilityRole="button" accessibilityLabel="Retry loading reactions"><Text style={s.action}>Try again</Text></Pressable></>}
            {!loading && !loadError && nextOffset !== null && <Pressable style={s.retry} onPress={() => { void load(nextOffset); }} accessibilityRole="button" accessibilityLabel="Show more reactions"><Text style={s.action}>Show more</Text></Pressable>}
          </View>}/>
        {!!notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  backdrop:{flex:1,justifyContent:'flex-end',alignItems:'center',backgroundColor:Colors.scrimSepia},
  sheet:{width:'100%',maxWidth:480,backgroundColor:Colors.cardBg,borderTopLeftRadius:24,borderTopRightRadius:24,paddingTop:10,overflow:'hidden'},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingLeft:20,paddingRight:8},
  title:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyLG,color:Colors.asphalt},
  close:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  subtitle:{fontFamily:Fonts.sans,fontSize:FontSizes.bodySM,color:Colors.secondary,paddingHorizontal:20,marginBottom:12},
  list:{flexGrow:0,flexShrink:1,minHeight:80},
  person:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,paddingHorizontal:18,minHeight:66},
  avatar:{width:40,height:40,borderRadius:20},initial:{alignItems:'center',justifyContent:'center',backgroundColor:Colors.inputBg},
  initialText:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyLG,color:Colors.terracotta},
  identity:{flex:1,minWidth:0,gap:2},name:{fontFamily:Fonts.sansMedium,fontSize:FontSizes.bodyLG,color:Colors.asphalt},meta:{fontFamily:Fonts.sans,fontSize:FontSizes.bodySM,color:Colors.secondary},
  emoji:{fontSize:FontSizes.displayMD},remove:{minWidth:60,minHeight:44,alignItems:'center',justifyContent:'center'},
  action:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyMD,color:Colors.terracotta},
  retry:{minHeight:44,alignItems:'center',justifyContent:'center',paddingHorizontal:20},footer:{paddingVertical:8},
  empty:{fontFamily:Fonts.sans,fontSize:FontSizes.bodyMD,color:Colors.secondary,textAlign:'center',padding:16},
  notice:{fontFamily:Fonts.sans,fontSize:FontSizes.bodySM,color:Colors.secondary,paddingHorizontal:20,paddingVertical:12},
});
