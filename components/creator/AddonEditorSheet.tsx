import {CreatorActionFill} from './CreatorActionFill';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
/**
 * The add-on editor (doc 114): name, price, description, image, quantity,
 * per-order max. Mirrors TierEditorSheet's shape and tokens; reachable only
 * from the probe-gated add-ons section, so it cannot exist before the
 * schema does. The image goes to the event-images bucket via the existing
 * uploader (event-pinned path law).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { X, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { pickAndUploadEventImage } from '../../lib/creatorEvents';
import { TIER_DESCRIPTION_MAX, TIER_NAME_MAX } from '../../lib/ticketing';
import { type AddonDraft, type AddonVariation, type EventAddon } from '../../lib/ticketPromosAddons';

import { addonOptionsProblem,CreatorAddonRejected,CreatorAddonChanged,type CreatorAddonDispatch } from '../../lib/creatorAddonEditor';
import {keepCreatorAddonPhoto,uploadCreatorAddonPhoto,clearCreatorAddonPhoto,type CreatorAddonPhoto} from '../../lib/creatorAddonPhoto';
import { useCreatorAddonDraft } from '../../hooks/useCreatorAddonDraft';
import type { CreatorAddon } from '../../lib/creatorAddonEditor';
import type { CreatorPageScope } from '../../lib/creatorPageReview';

interface AddonEditorSheetProps {
  eventId: string;
  scope: CreatorPageScope;
  visible: boolean;
  /** null = creating a new add-on */
  addon: EventAddon | null;
  busy: boolean;
  onSave: (draft: AddonDraft, recordId: string, write: boolean, baseline: CreatorAddon | null, dispatch:CreatorAddonDispatch) => Promise<unknown>;
  onClose: () => void;
}

function parsePriceCents(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  if(!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned))return null;
  const cents=Math.round(Number(cleaned)*100);
  return Number.isSafeInteger(cents)&&cents<=2147483647?cents:null;
}

export function AddonEditorSheet({ visible, addon, busy, onSave, onClose, eventId, scope }: AddonEditorSheetProps) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const {height}=useWindowDimensions();
  const draft = useCreatorAddonDraft(eventId,addon?.id??'new',scope,visible);
  const form=draft.value?.form;
  const name=form?.name??'',description=form?.description??'',priceText=form?.priceText??'',imageUrl=form?.imageUrl??'',capText=form?.capText??'',perOrderMaxText=form?.perOrderMaxText??'',options=form?.options??[];
  const setName=(v:string)=>draft.change('name',v),setDescription=(v:string)=>draft.change('description',v),setPriceText=(v:string)=>draft.change('priceText',v),setImageUrl=(v:string)=>draft.change('imageUrl',v),setCapText=(v:string)=>draft.change('capText',v),setPerOrderMaxText=(v:string)=>draft.change('perOrderMaxText',v);
  const setOptions=(v:AddonVariation[]|((old:AddonVariation[])=>AddonVariation[]))=>draft.change('options',v);
  const recordId=draft.value?.recordId??'',savedStatus=draft.value?.baseline?.status??'draft';
  const [uploading,setUploading]=useState(false),[photoError,setPhotoError]=useState<string|null>(null);
  const loading=!draft.loaded&&!draft.error,loadError=!draft.loaded&&!!draft.error;
  const [changed,setChanged]=useState<CreatorAddon|null>(null);
  const [saveError,setSaveError]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const locked=useRef(false),photoLocked=useRef(false),mounted=useRef(false);
  const visit=useMemo(()=>({}),[visible,addon?.id,eventId,scope]);const latest=useRef(visit);latest.current=visit;
  const current=()=>mounted.current&&visible&&latest.current===visit&&scope.isCurrent();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{locked.current=false;photoLocked.current=false;setSaving(false);setUploading(false);setSaveError(null);setChanged(null);setPhotoError(null);},[visit]);

  const priceCents = parsePriceCents(priceText);
  const validLimit=(value:string)=>!value.trim()||(/^[1-9]\d*$/.test(value.trim())&&Number(value)<=2147483647);
  const limitsValid=validLimit(capText)&&validLimit(perOrderMaxText);
  const optionProblem=addonOptionsProblem(options);
  const problem =
    priceCents === null
      ? /* copy to the taste gate */ 'that price does not read as a number.'
      : !limitsValid?'Use a positive whole number, or leave the limit blank.':optionProblem;
  const editingDisabled=busy||saving||uploading||!draft.ready||!!draft.value?.pending;
  const requestClose=async()=>{
    if(locked.current||photoLocked.current||busy||uploading)return;
    if(!draft.loaded){onClose();return;}
    locked.current=true;setSaving(true);
    try{if(await draft.save()&&current())onClose();}finally{if(current()){locked.current=false;setSaving(false);}}
  };
  const canSave = name.trim().length > 0 && problem === null && !editingDisabled && current() && !!recordId && !draft.value?.photo;

  const handlePickImage = async (retry=false) => {
    if(!current()||editingDisabled||locked.current||photoLocked.current)return;
    photoLocked.current=true;setPhotoError(null);
    hapticLight();setUploading(true);
    let original:CreatorAddonPhoto|null=retry?draft.value?.photo??null:null;
    try {
      const assertCurrent=()=>{if(!current())throw Error('Editing visit changed.');};
      const upload=async(uri:string)=>{
        original=await keepCreatorAddonPhoto(eventId,uri,scope);assertCurrent();
        if(!await draft.preparePhoto(original))throw Error('Keep the original photo on this device before retrying.');
        assertCurrent();return uploadCreatorAddonPhoto(eventId,original,scope);
      };
      const url=retry&&original?await uploadCreatorAddonPhoto(eventId,original,scope):retry?null:await pickAndUploadEventImage({assertCurrent,check:async()=>{assertCurrent();}},upload);
      if(url&&original&&current()&&await draft.finishPhoto(original,url)&&current())await clearCreatorAddonPhoto(eventId,original,scope).catch(()=>undefined);
    } catch(error) {if(current())setPhotoError(error instanceof Error?error.message:'The photo could not be saved. Try again.');}
    finally{if(current()){photoLocked.current=false;setUploading(false);}}
  };

  const handleSave = async (write=true) => {
    if ((!canSave&&!draft.value?.pending) || !draft.ready || busy || locked.current || photoLocked.current) return;
    locked.current=true;setSaving(true);setSaveError(null);setChanged(null);
    hapticLight();
    const cap = capText.trim() ? parseInt(capText, 10) : null;
    const perOrderMax = perOrderMaxText.trim() ? parseInt(perOrderMaxText, 10) : null;
    try {
    if(draft.value?.confirmed){if(await draft.finish()&&current())onClose();return;}
    const original=await draft.prepare({
      variations:options.map(o=>({id:o.id,label:o.label.trim()})),
      name: name.trim().slice(0, TIER_NAME_MAX),
      description: description.trim() ? description.trim().slice(0, TIER_DESCRIPTION_MAX) : null,
      price_cents: priceCents??0,
      image_url: imageUrl || null,
      quantity_cap: cap && cap > 0 ? cap : null,
      per_order_max: perOrderMax && perOrderMax >= 1 ? perOrderMax : null,
      // a new extra starts as a draft; the list's own flip puts it on sale
      // (the tier pattern), so nothing goes buyable by the act of existing
      status: savedStatus,
    });
    if(!original||!current())return;
    await onSave(original.pending!,original.recordId,write,original.baseline,{previouslyDispatched:original.dispatched??true,beforeDispatch:()=>draft.markDispatched()});
    if(current()&&await draft.finish()&&current())onClose();
    }catch(error){if(current()){
      if(error instanceof CreatorAddonRejected){if(await draft.releaseRejected()&&current())setSaveError(error.message);}
      else if(error instanceof CreatorAddonChanged){if(await draft.settleChanged()&&current()){setChanged(error.saved);setSaveError(error.saved?'This extra has changed. Your draft is kept; use the saved version to continue editing it.':'This extra is no longer available. Your draft is kept.');}}
      else setSaveError('The save could not be confirmed. Your draft is kept. Check its status or retry the original save.');
    }}
    finally{if(current()){locked.current=false;setSaving(false);}}
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          <Pressable style={[styles.sheet,{maxHeight:height*0.9}]} onPress={() => Keyboard.dismiss()}>
            <View style={styles.headerRow}>
                {/* copy to the taste gate */}
                <Text style={styles.title}>{addon ? 'Edit extra' : 'New extra'}</Text>
                <TouchableOpacity onPress={requestClose} disabled={busy||saving||uploading} accessibilityRole="button" accessibilityLabel="Close extra editor" style={styles.closeButton} hitSlop={4}>
                  <X size={22} color={Colors.textMedium} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            <ScrollView style={styles.fields} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {loading && <ActivityIndicator size="small" color={Colors.terracotta}/>}
              {loadError && <View style={styles.recovery}><Text accessibilityRole="alert" style={styles.help}>Your extra or device draft couldn’t be loaded.</Text><TouchableOpacity accessibilityRole="button" onPress={()=>{void draft.retry();}} style={styles.quietAction}><Text style={styles.imageBtnText}>Try again</Text></TouchableOpacity></View>}
              {!loading && !loadError && <>
              <Text style={styles.label}>name</Text>
              <TextInput
                editable={!editingDisabled}
                style={styles.input}
                value={name}
                accessibilityLabel="Extra name"
                onChangeText={setName}
                placeholder="market food pass"
                placeholderTextColor={Colors.textLight}
                maxLength={TIER_NAME_MAX}
              />

              <Text style={styles.label}>price (blank or 0 = free)</Text>
              <TextInput
                editable={!editingDisabled}
                style={styles.input}
                value={priceText}
                accessibilityLabel="Extra price"
                onChangeText={setPriceText}
                placeholder="0.00"
                placeholderTextColor={Colors.textLight}
                keyboardType="decimal-pad"
              />
              {priceCents===null && <Text style={styles.problem}>Enter a price with up to two decimal places.</Text>}

              <Text style={styles.label}>description</Text>
              <TextInput
                editable={!editingDisabled}
                style={[styles.input, styles.inputMultiline]}
                value={description}
                accessibilityLabel="Extra description"
                onChangeText={setDescription}
                placeholder="what this extra gets them"
                placeholderTextColor={Colors.textLight}
                multiline
                maxLength={TIER_DESCRIPTION_MAX}
              />

              {/* the image: optional, event-bucket upload, quiet preview */}
              <TouchableOpacity style={styles.imageBtn} accessibilityRole="button" accessibilityLabel={imageUrl?"Change extra photo":"Add extra photo"} onPress={()=>{void handlePickImage();}} disabled={editingDisabled} activeOpacity={0.85}>
                {uploading ? (
                  <ActivityIndicator size="small" color={Colors.darkWarm} />
                ) : imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.imagePreview} contentFit="cover" />
                ) : (
                  /* copy to the taste gate */
                  <Text style={styles.imageBtnText}>add a photo</Text>
                )}
              </TouchableOpacity>

              {!!photoError&&<Text accessibilityRole="alert" style={styles.problem}>{photoError}</Text>}
              {!!draft.value?.photo&&<View><Text style={styles.help}>Your selected photo is kept until its upload is confirmed.</Text><View style={styles.recovery}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry extra photo" style={styles.quietAction} disabled={editingDisabled} onPress={()=>{void handlePickImage(true);}}><Text style={styles.imageBtnText}>Retry photo</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel="Skip selected extra photo" style={styles.quietAction} disabled={editingDisabled} onPress={async()=>{
                const original=draft.value?.photo;if(!original||!current()||locked.current||photoLocked.current||busy)return;
                photoLocked.current=true;setUploading(true);
                try{if(await draft.cancelPhoto(original)&&current()){setPhotoError(null);await clearCreatorAddonPhoto(eventId,original,scope).catch(()=>undefined);}}finally{if(current()){photoLocked.current=false;setUploading(false);}}
              }}><Text style={styles.imageBtnText}>{imageUrl?'Keep previous':'Skip photo'}</Text></TouchableOpacity></View></View>}
              <View style={styles.pairRow}>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>available quantity</Text>
                  <TextInput
                editable={!editingDisabled}
                    style={styles.input}
                    value={capText}
                    accessibilityLabel="Available quantity"
                onChangeText={setCapText}
                    placeholder="no cap"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>per purchase limit</Text>
                  <TextInput
                editable={!editingDisabled}
                    style={styles.input}
                    value={perOrderMaxText}
                    accessibilityLabel="Per purchase limit"
                onChangeText={setPerOrderMaxText}
                    placeholder="no limit"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {!limitsValid && <Text style={styles.problem}>Use a positive whole number, or leave the limit blank.</Text>}
              <View style={styles.optionsHeader}><Text style={styles.label}>options</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Add an option" disabled={editingDisabled||options.length>=20} style={styles.quietAction}
                onPress={()=>{if(current()&&!editingDisabled)setOptions(value=>[...value,{id:Crypto.randomUUID(),label:''}]);}}><Plus size={16} color={Colors.terracotta}/><Text style={styles.imageBtnText}>Add option</Text></TouchableOpacity></View>
              <Text style={styles.help}>For sizes or choices. All options share this extra’s price and stock.</Text>
              {options.map((option,index)=><View key={option.id} style={styles.optionRow}><TextInput editable={!editingDisabled} accessibilityLabel={`Option ${index+1}`} style={[styles.input,styles.optionInput]} value={option.label} maxLength={120} placeholder="e.g. Vegetarian" placeholderTextColor={Colors.textLight}
                onChangeText={label=>{if(current()&&!editingDisabled)setOptions(value=>value.map(o=>o.id===option.id?{...o,label}:o));}}/><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove option ${index+1}`} disabled={editingDisabled} style={styles.removeOption} onPress={()=>{if(current()&&!editingDisabled)setOptions(value=>value.filter(o=>o.id!==option.id));}}><X size={18} color={Colors.textMedium}/></TouchableOpacity></View>)}
              {!!optionProblem && <Text style={styles.problem}>{optionProblem}</Text>}
              {!!draft.error && <View><Text accessibilityRole="alert" style={styles.problem}>{draft.error}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry device draft" onPress={()=>{void draft.retry();}} style={styles.quietAction}><Text style={styles.imageBtnText}>Try again</Text></TouchableOpacity></View>}
              {!!draft.value?.pending && <View><Text style={styles.help}>{draft.value.confirmed?'Your extra is saved. Finish to close this draft.':'Your original save is kept. Check its status before trying again.'}</Text>{!draft.value.confirmed&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Check extra save" disabled={busy||saving} onPress={()=>{void handleSave(false);}} style={styles.quietAction}><Text style={styles.imageBtnText}>Check status</Text></TouchableOpacity>}</View>}
              {!!changed&&draft.value?.dispatched===false&&!!addon&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Use saved extra" disabled={busy||saving} style={styles.quietAction} onPress={async()=>{
                if(!current()||locked.current||photoLocked.current||busy)return;locked.current=true;setSaving(true);
                try{if(await draft.useSaved(changed)&&current()){setChanged(null);setSaveError(null);}}finally{if(current()){locked.current=false;setSaving(false);}}
              }}><Text style={styles.imageBtnText}>Use saved version</Text></TouchableOpacity>}
              {!!saveError && <Text accessibilityRole="alert" style={styles.problem}>{saveError}</Text>}
              </>}
            </ScrollView>
              {!loading && !loadError && <TouchableOpacity
                style={[styles.saveBtn, (!canSave&&!draft.value?.pending||busy||saving) && styles.saveBtnDisabled]}
                onPress={()=>{void handleSave();}}
                accessibilityRole="button"
                accessibilityLabel="Save extra"
                disabled={(!canSave&&!draft.value?.pending)||busy||saving}
                activeOpacity={0.85}
              >
                <CreatorActionFill />
                {(busy||saving) ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text numberOfLines={1} style={styles.saveBtnText}>{draft.value?.confirmed?'Finish':draft.value?.pending?'Retry save':'Save extra'}</Text>
                )}
              </TouchableOpacity>}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  fields: {flexShrink:1},
  closeButton: {minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  optionsHeader: {flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:18,paddingTop:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:Colors.border},
  optionRow: {flexDirection:'row',alignItems:'center',gap:8,marginTop:8},
  optionInput: {flex:1,minWidth:0},
  removeOption: {width:44,height:44,alignItems:'center',justifyContent:'center'},
  quietAction: {minHeight:44,flexDirection:'row',gap:4,alignItems:'center',paddingHorizontal:4},
  help: {fontFamily:fonts.regular,fontSize:FontSizes.bodySM,color:Colors.textMedium,lineHeight:18},
  recovery: {flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'flex-end' },
  avoider: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  label: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  problem: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 6 },
  imageBtn: {
    marginTop: 12, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  imageBtnText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  imagePreview: { width: '100%', height: 120 },
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCol: { flex: 1 },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
}); }
