import React, { useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native';
import { ArrowUp, Camera, Image, MapPin, Plus, X } from 'lucide-react-native';
import { useChatInputHeight } from '../../hooks/useChatInputHeight';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

interface Action {
  onPress: () => void;
  disabled: boolean;
}
interface Props {
  fonts: AfterglowFontFamilies;
  composerInputRef?: React.RefObject<TextInput | null>;
  inputProps: Omit<TextInputProps, 'style'>;
  photo: Action & { busy: boolean };
  location: Action;
  camera?: Action;
  onSend: () => void;
  sendDisabled: boolean;
  sending: boolean;
  editing: boolean;
  attachmentsVisible?: boolean;
  sendLabel?: string;
}

/** Presentation only. Each room retains its own draft, mention selection,
 * send receipt, photo/location actions and admission/expiry gates. */
export function CommunityChatComposer({ fonts, composerInputRef, inputProps, photo, location, camera, onSend, sendDisabled, sending, editing, attachmentsVisible = true, sendLabel }: Props) {
  const localInputRef = useRef<TextInput>(null);
  const inputRef = composerInputRef ?? localInputRef;
  const { inputHeight, measureWebInput, onContentSizeChange } = useChatInputHeight(inputRef, inputProps.value, fonts.regular, 120);
  // iOS Fabric may stop content-size events with a fixed height. Its native
  // multiline layout grows and shrinks within the existing min/max bounds.
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  // Android actions need 48dp targets; keep iOS/web and the text field unchanged.
  const actionBounds = Platform.OS === 'android' ? styles.androidAction : undefined;
  const canAttach = attachmentsVisible && !editing && (!photo.disabled || !location.disabled || !!camera && !camera.disabled);
  return <View>
    {attachmentsOpen && canAttach && <View style={styles.attachments}>
      {!!camera && <TouchableOpacity style={styles.attachment} disabled={camera.disabled} accessibilityRole="button" accessibilityLabel="Take photo"
        accessibilityState={{disabled:camera.disabled}} onPress={()=>{setAttachmentsOpen(false);if(!camera.disabled)camera.onPress();}}>
        <Camera size={22} color={Colors.clay}/><Text style={[styles.attachmentLabel,{fontFamily:fonts.medium}]}>Camera</Text>
      </TouchableOpacity>}
      <TouchableOpacity style={styles.attachment} disabled={photo.disabled} accessibilityRole="button" accessibilityLabel="Add photo"
        accessibilityState={{disabled:photo.disabled,busy:photo.busy}} onPress={()=>{setAttachmentsOpen(false);if(!photo.disabled)photo.onPress();}}>
        <Image size={21} color={Colors.clay}/><Text style={[styles.attachmentLabel,{fontFamily:fonts.medium}]}>Photos</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.attachment} disabled={location.disabled} accessibilityRole="button" accessibilityLabel="Share location"
        accessibilityState={{disabled:location.disabled}} onPress={()=>{setAttachmentsOpen(false);if(!location.disabled)location.onPress();}}>
        <MapPin size={21} color={Colors.clay}/><Text style={[styles.attachmentLabel,{fontFamily:fonts.medium}]}>Location</Text>
      </TouchableOpacity>
    </View>}
    <View style={styles.bar}>
    {attachmentsVisible && !editing && <TouchableOpacity style={[styles.utility, actionBounds]} onPress={()=>setAttachmentsOpen(open=>!open)} disabled={!canAttach}
      accessibilityRole="button" accessibilityLabel={photo.busy ? 'Uploading photo' : attachmentsOpen ? 'Close attachments' : 'Add attachment'}
      accessibilityState={{disabled:!canAttach,busy:photo.busy,expanded:attachmentsOpen && canAttach}}>
      {photo.busy ? <ActivityIndicator size="small" color={Colors.muted}/> : attachmentsOpen && canAttach
        ? <X size={22} strokeWidth={1.8} color={Colors.clay}/>
        : <Plus size={25} strokeWidth={1.8} color={canAttach?Colors.clay:Colors.muted}/>}
    </TouchableOpacity>}
    <TextInput ref={inputRef} accessibilityLabel="Message" placeholderTextColor={Colors.muted} numberOfLines={Platform.OS === 'web' ? 1 : undefined} {...inputProps}
      onFocus={event => { setAttachmentsOpen(false); inputProps.onFocus?.(event); }}
      onContentSizeChange={event => { onContentSizeChange(event); inputProps.onContentSizeChange?.(event); }}
      onLayout={event => { measureWebInput(); inputProps.onLayout?.(event); }}
      style={[styles.input, { fontFamily: fonts.regular, height: Platform.OS === 'ios' ? undefined : inputHeight }]} />
    <TouchableOpacity style={[styles.send, actionBounds, sendDisabled && styles.sendDisabled]} onPress={onSend} disabled={sendDisabled}
      accessibilityRole="button" accessibilityLabel={sendLabel ?? (sending ? editing ? 'Saving changes' : 'Sending message' : editing ? 'Save changes' : 'Send message')}
      accessibilityState={{ disabled: sendDisabled, busy: sending }} aria-disabled={sendDisabled} aria-busy={sending}>
      <CreatorActionFill />
      <View pointerEvents="none" style={styles.sendContent}>
        {sending ? <ActivityIndicator size="small" color={Colors.white} /> : <ArrowUp size={23} strokeWidth={2.2} color={Colors.white} />}
      </View>
    </TouchableOpacity>
  </View></View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.subtleLine, backgroundColor: Colors.paper },
  attachments: {flexDirection:'row',gap:10,paddingHorizontal:14,paddingVertical:10,backgroundColor:Colors.paper},
  attachment: {flex:1,minHeight:68,flexDirection:'column',alignItems:'center',justifyContent:'center',gap:9,borderRadius:16,backgroundColor:Colors.white,borderWidth:StyleSheet.hairlineWidth,borderColor:Colors.subtleLine},
  attachmentLabel: {...AfterglowType.caption,color:Colors.ink},
  utility: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 120, ...AfterglowType.message, backgroundColor: Colors.white, color: Colors.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.line, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, textAlignVertical: 'top' },
  send: { width: 44, height: 44, flexShrink: 0, marginLeft: 4, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.clay },
  androidAction: { width: 48, height: 48, borderRadius: 24 },
  sendDisabled: { opacity: 0.45 },
  sendContent: { zIndex: 1, alignItems: 'center', justifyContent: 'center' },
});
