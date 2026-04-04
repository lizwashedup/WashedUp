import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import Colors from '../../../constants/Colors';
import { capDisplayCount } from '../../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { openUrl } from '../../../lib/url';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { useChat, ChatMessage, MessageReaction } from '../../../hooks/useChat';
import MiniProfileCard from '../../../components/MiniProfileCard';
import { ReportModal } from '../../../components/modals/ReportModal';
import { useBlock } from '../../../hooks/useBlock';
import { BrandedAlert, BrandedAlertButton } from '../../../components/BrandedAlert';

// ─── Event Header Data ────────────────────────────────────────────────────────

interface EventInfo {
  id: string;
  title: string;
  start_time: string;
  tickets_url: string | null;
  member_count: number;
  members: Array<{ id: string; first_name: string | null; avatar_url: string | null }>;
}

async function fetchEventInfo(eventId: string): Promise<EventInfo> {
  // Run event + member list in parallel — both only need eventId
  const [eventResult, memberResult] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, start_time, tickets_url, member_count')
      .eq('id', eventId)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('status', 'joined')
      .limit(6),
  ]);

  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) throw new Error('Event not found');
  const event = eventResult.data;
  const memberRows = memberResult.data;

  const userIds = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);

  let members: EventInfo['members'] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', userIds);

    members = (profiles ?? []).map((p: any) => ({
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    }));
  }

  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    tickets_url: (event as any).tickets_url ?? null,
    member_count: (event as any).member_count ?? 0,
    members,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatChatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return 'Today';
  if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMessageTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatEventDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

// ─── Linked Text ─────────────────────────────────────────────────────────────

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;

function LinkedText({ text, style, linkStyle }: { text: string; style: any; linkStyle?: any }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;

  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (URL_PATTERN.test(part)) {
          return (
            <Text
              key={i}
              style={[linkStyle ?? { textDecorationLine: 'underline' as const }]}
              onPress={() => openUrl(part)}
            >
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

// ─── Location helpers ─────────────────────────────────────────────────────────

function openLocationInMaps(lat: number, lng: number, address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.OS === 'ios'
    ? `maps://app?ll=${lat},${lng}&q=${encoded}`
    : `geo:${lat},${lng}?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    // fallback: Apple Maps web URL works on iOS even without the Maps app
    Linking.openURL(`https://maps.apple.com/?ll=${lat},${lng}&q=${encoded}`).catch(() => {});
  });
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  isGrouped: boolean;
  currentUserId: string;
  planTitle?: string;
  onPhotoPress?: (url: string) => void;
  onReaction?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

const MessageBubble = memo(function MessageBubble({ message, isOwn, showAvatar, showName, isGrouped, currentUserId, planTitle, onPhotoPress, onReaction, onDelete }: BubbleProps) {
  const lastTapRef = React.useRef(0);

  if (message.message_type === 'system') {
    // Replace generic "the plan" references with the actual plan title
    let displayContent = message.content;
    if (planTitle) {
      displayContent = displayContent
        .replace(/joined the plan/gi, `joined ${planTitle}`)
        .replace(/the plan/gi, planTitle);
    }
    return (
      <View style={bubbleStyles.systemRow}>
        <Text style={bubbleStyles.systemText}>{displayContent}</Text>
      </View>
    );
  }

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onReaction?.(message.id);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const handleLongPress = () => {
    if (!isOwn || !onDelete) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Delete Message', 'Cancel'],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
        },
        (idx) => { if (idx === 0) onDelete(message.id); },
      );
    } else {
      Alert.alert('Message', '', [
        { text: 'Delete Message', style: 'destructive', onPress: () => onDelete(message.id) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const reactions = message.reactions ?? [];
  const heartCount = reactions.filter(r => r.reaction === 'heart').length;
  const iHearted = reactions.some(r => r.reaction === 'heart' && r.user_id === currentUserId);

  const borderRadius = isOwn
    ? { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 4 }
    : { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, borderBottomRightRadius: 18 };

  return (
    <View style={[bubbleStyles.row, isOwn ? bubbleStyles.rowOwn : bubbleStyles.rowOther]}>
      {!isOwn && (
        <View style={bubbleStyles.avatarSlot}>
          {showAvatar ? (
            message.sender?.avatar_url ? (
              <Image source={{ uri: message.sender.avatar_url }} style={bubbleStyles.avatar} contentFit="cover" />
            ) : (
              <View style={[bubbleStyles.avatar, bubbleStyles.avatarFallback]}>
                <Text style={bubbleStyles.avatarInitial}>
                  {message.sender?.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )
          ) : null}
        </View>
      )}

      <View style={[bubbleStyles.bubbleWrapper, isOwn ? bubbleStyles.wrapperOwn : bubbleStyles.wrapperOther]}>
        {!isOwn && showName && (
          <Text style={bubbleStyles.senderLine}>
            <Text style={bubbleStyles.senderName}>{message.sender?.first_name ?? 'Someone'}</Text>
            <Text style={bubbleStyles.senderDot}> · </Text>
            <Text style={bubbleStyles.senderTime}>{formatMessageTime(message.created_at)}</Text>
          </Text>
        )}

        <Pressable
          onPress={handleDoubleTap}
          onLongPress={!message.image_url && message.message_type !== 'location' ? handleLongPress : undefined}
          delayLongPress={400}
        >
          {!!message.image_url ? (
            <Pressable
              onPress={() => onPhotoPress?.(message.image_url!)}
              onLongPress={handleLongPress}
              delayLongPress={400}
            >
              <Image
                source={{ uri: message.image_url }}
                style={[bubbleStyles.messageImage, borderRadius]}
                contentFit="cover"
                transition={200}
                placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                cachePolicy="memory-disk"
              />
            </Pressable>
          ) : message.message_type === 'location' ? (() => {
            let lat = 0, lng = 0, address = '';
            try { const p = JSON.parse(message.content); lat = p.lat; lng = p.lng; address = p.address; } catch {}
            return (
              <Pressable
                onPress={() => openLocationInMaps(lat, lng, address)}
                onLongPress={handleLongPress}
                delayLongPress={400}
                style={[
                  bubbleStyles.bubble,
                  bubbleStyles.locationBubble,
                  isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
                  borderRadius,
                ]}
              >
                <View style={bubbleStyles.locationPinRow}>
                  <Ionicons name="location" size={15} color={isOwn ? Colors.white : Colors.terracotta} />
                  <Text style={[bubbleStyles.locationLabel, isOwn && bubbleStyles.locationLabelOwn]}>
                    Shared location
                  </Text>
                </View>
                <Text style={[bubbleStyles.locationAddress, isOwn && bubbleStyles.locationAddressOwn]} numberOfLines={2}>
                  {address}
                </Text>
                <Text style={[bubbleStyles.locationTapHint, isOwn && bubbleStyles.locationTapHintOwn]}>
                  Tap to open in Maps
                </Text>
              </Pressable>
            );
          })() : (
            <View style={[
              bubbleStyles.bubble,
              bubbleStyles.bubbleText,
              isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
              borderRadius,
            ]}>
              <LinkedText
                text={message.content}
                style={[bubbleStyles.messageText, isOwn && bubbleStyles.messageTextOwn]}
                linkStyle={isOwn ? bubbleStyles.linkOwn : bubbleStyles.linkOther}
              />
            </View>
          )}

          {heartCount > 0 && (
            <View style={[bubbleStyles.reactionBadge, isOwn ? bubbleStyles.reactionBadgeOwn : bubbleStyles.reactionBadgeOther]}>
              <Text style={[bubbleStyles.reactionHeart, iHearted && bubbleStyles.reactionHeartActive]}>
                {iHearted ? '\u2764\uFE0F' : '\u2661'}
              </Text>
              {heartCount > 1 && (
                <Text style={bubbleStyles.reactionCount}>{heartCount}</Text>
              )}
            </View>
          )}
        </Pressable>

      </View>
    </View>
  );
});

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2, paddingHorizontal: 16 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  avatarSlot: { width: 28, marginRight: 8, alignSelf: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  bubbleWrapper: { maxWidth: '75%', gap: 3 },
  wrapperOwn: { alignItems: 'flex-end' },
  wrapperOther: { alignItems: 'flex-start' },
  senderLine: { marginBottom: 2, marginLeft: 4 },
  senderName: { fontWeight: '700', fontSize: 12, color: '#B5522E' },
  senderDot: { fontSize: 10, color: '#A09385' },
  senderTime: { fontSize: 10, color: '#78695C' },
  bubble: { overflow: 'hidden' },
  bubbleText: { paddingHorizontal: 13, paddingVertical: 9 },
  bubbleOwn: { backgroundColor: '#B5522E' },
  bubbleOther: {
    backgroundColor: '#F5EDE0',
  },
  messageText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: '#2C1810', lineHeight: 21 },
  messageTextOwn: { color: '#FFFFFF' },
  inlineTime: { fontSize: 10, color: '#A09385', textAlign: 'right', marginTop: 3 },
  inlineTimeOwn: { color: 'rgba(255,255,255,0.6)' },
  linkOther: { textDecorationLine: 'underline' as const, color: Colors.terracotta },
  linkOwn: { textDecorationLine: 'underline' as const, color: Colors.white },
  messageImage: { width: 240, height: 180 },
  systemRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  systemText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: '#A09385',
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    bottom: -10,
    gap: 2,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  reactionBadgeOwn: { right: 4 },
  reactionBadgeOther: { left: 4 },
  reactionHeart: { fontSize: FontSizes.bodySM },
  reactionHeartActive: { color: Colors.errorRed },
  reactionCount: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
  },
  locationBubble: { paddingHorizontal: 13, paddingVertical: 10, minWidth: 180 },
  locationPinRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  locationLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  locationLabelOwn: { color: Colors.white },
  locationAddress: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 6,
    lineHeight: 20,
  },
  locationAddressOwn: { color: Colors.white },
  locationTapHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
  },
  locationTapHintOwn: { color: 'rgba(255,255,255,0.7)' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoViewUrl, setPhotoViewUrl] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const listRef = useRef<FlatList>(null);

  const { messages, loading, currentUserId, sendMessage, sendLocation, deleteMessage, toggleReaction, refetch } = useChat(id);

  useFocusEffect(
    useCallback(() => {
      refetch(true);
    }, [refetch]),
  );

  const { blockUser } = useBlock();

  const { data: event, isError: eventError } = useQuery({
    queryKey: ['event-info', id],
    queryFn: () => fetchEventInfo(id),
    enabled: !!id,
    staleTime: 60_000,
    retry: 2,
  });

  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messages.forEach(m => {
      if (m.image_url && !prefetchedRef.current.has(m.image_url)) {
        prefetchedRef.current.add(m.image_url);
        Image.prefetch(m.image_url).catch(() => {});
      }
    });
  }, [messages]);

  if (!id || eventError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.parchment }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium }}>
            {eventError ? 'Could not load this chat' : 'Chat not found'}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 }}
          >
            <Text style={{ fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isPast = event
    ? new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000)
    : false;

  const handleReportMenu = useCallback(async () => {
    // Fetch ALL members (no limit) for the report menu
    const { data: memberRows } = await supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', id)
      .eq('status', 'joined');

    const userIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
    const otherIds = userIds.filter((uid) => uid !== currentUserId);

    if (otherIds.length === 0) {
      setAlertInfo({ title: 'No other members', message: 'There are no other members in this plan to report.' });
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', otherIds);

    const members = (profiles ?? []).map((p: any) => ({
      id: p.id as string,
      name: (p.first_name_display as string | null) ?? 'Unknown',
    }));

    // Pick a member, then show report/block options — all via native action sheets
    const memberNames = members.map(m => m.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...memberNames, 'Cancel'], cancelButtonIndex: memberNames.length, title: 'Members' },
        (idx) => {
          if (idx >= members.length) return;
          const member = members[idx];
          setTimeout(() => {
            ActionSheetIOS.showActionSheetWithOptions(
              { options: ['Report User', 'Block User', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2, title: member.name },
              (actionIdx) => {
                if (actionIdx === 0) { setReportTarget(member); setShowReport(true); }
                if (actionIdx === 1) blockUser(member.id, member.name, () => router.back());
              },
            );
          }, 300);
        },
      );
    } else {
      setAlertInfo({
        title: 'Members',
        message: 'Select a member',
        buttons: [
          ...members.map((member) => ({
            text: member.name,
            onPress: () => {
              setTimeout(() => {
                Alert.alert(member.name, '', [
                  { text: 'Report User', onPress: () => { setReportTarget(member); setShowReport(true); } },
                  { text: 'Block User', style: 'destructive', onPress: () => blockUser(member.id, member.name, () => router.back()) },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }, 100);
            },
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      });
    }
  }, [id, currentUserId, blockUser]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || uploading) return;
    setInputText('');
    sendMessage(text);  // fire-and-forget for instant feel
  }, [inputText, uploading, sendMessage]);

  const doPhotoAction = useCallback(async (choice: 'camera' | 'library') => {
    if (!currentUserId) return;

    if (choice === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({ title: 'Camera access needed', message: 'Please allow camera access in Settings to take photos.' });
        return;
      }
    }

    const result = choice === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: false,
          quality: 0.8,
        });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      if (!manipulated.base64) throw new Error('No base64 data');

      const fileName = `${currentUserId}/${Date.now()}.jpg`;
      const publicUrl = await uploadBase64ToStorage('chat-images', fileName, manipulated.base64);

      await sendMessage('', publicUrl);
    } catch {
      setAlertInfo({ title: 'Could not send photo', message: 'Something went wrong uploading the image. Please try again.' });
    } finally {
      setUploading(false);
    }
  }, [currentUserId, sendMessage]);

  const handleLocationSend = useCallback(async () => {
    if (!currentUserId) return;
    Keyboard.dismiss();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setAlertInfo({ title: 'Location access needed', message: 'Please allow location access in Settings to share your location.' });
      return;
    }

    setUploading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      const geocoded = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = geocoded[0];
      let address = '';
      if (place) {
        const parts = [place.name, place.street, place.city].filter(Boolean);
        address = parts.join(', ');
      }
      if (!address) address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      await sendLocation(latitude, longitude, address);
    } catch {
      setAlertInfo({ title: 'Could not get location', message: 'Something went wrong retrieving your location. Please try again.' });
    } finally {
      setUploading(false);
    }
  }, [currentUserId, sendLocation]);

  const handleAttachPress = useCallback(() => {
    if (!currentUserId) return;
    Keyboard.dismiss();

    const doLocation = () => {
      setAlertInfo({
        title: 'Share your location?',
        message: 'Your current location will be sent to the group.',
        buttons: [
          { text: 'Send Location', onPress: handleLocationSend },
          { text: 'Cancel', style: 'cancel' as const },
        ],
      });
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Take Photo', 'Choose from Library', 'Share Location', 'Cancel'],
          cancelButtonIndex: 3,
        },
        (idx) => {
          if (idx === 0) doPhotoAction('camera');
          else if (idx === 1) doPhotoAction('library');
          else if (idx === 2) doLocation();
        },
      );
    } else {
      Alert.alert('Add to chat', '', [
        { text: 'Take Photo', onPress: () => doPhotoAction('camera') },
        { text: 'Choose from Library', onPress: () => doPhotoAction('library') },
        { text: 'Share Location', onPress: doLocation },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [currentUserId, doPhotoAction, handleLocationSend]);

  type EnrichedItem = ChatMessage | { type: 'date'; label: string; id: string } | { type: 'time'; label: string; id: string };
  const enrichedItems = useMemo<EnrichedItem[]>(() => {
    const items: EnrichedItem[] = [];
    messages.forEach((msg, i) => {
      const prev = messages[i - 1];
      if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
        items.push({ type: 'date', label: formatChatDate(msg.created_at), id: `date-${msg.id}` });
      } else if (prev) {
        const gap = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
        if (gap >= 10 * 60 * 1000) {
          items.push({ type: 'time', label: formatMessageTime(msg.created_at), id: `time-${msg.id}` });
        }
      }
      items.push(msg);
    });
    return items.reverse();
  }, [messages]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.parchment }}>
      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.white }}>
        <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={chatStyles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>

          <View style={chatStyles.headerCenter}>
            <Text style={chatStyles.headerTitle} numberOfLines={1}>{event?.title ?? '...'}</Text>
            {event && (
              <Text style={chatStyles.headerSub}>{formatEventDate(event.start_time)}</Text>
            )}
          </View>

          <TouchableOpacity
            onPress={() => router.push(`/plan/${id}` as any)}
            style={chatStyles.viewPlanBtn}
          >
            <Text style={chatStyles.viewPlanText}>View Plan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleReportMenu}
            style={chatStyles.ellipsisBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={Colors.warmGray} />
          </TouchableOpacity>
        </View>

        {/* Ticket banner */}
        {event?.tickets_url && (
          <TouchableOpacity
            style={chatStyles.ticketBanner}
            onPress={() => openUrl(event.tickets_url!)}
          >
            <View style={chatStyles.ticketLeft}>
              <Ionicons name="ticket-outline" size={16} color={Colors.terracotta} />
              <Text style={chatStyles.ticketText}>Tickets available</Text>
            </View>
            <Text style={chatStyles.ticketCta}>Get Tickets</Text>
          </TouchableOpacity>
        )}

        {/* Member avatars row */}
        {event && event.members.length > 0 && (
          <View style={chatStyles.membersRow}>
            {event.members.slice(0, event.members.length > 5 ? 4 : 5).map((member) => (
              <TouchableOpacity
                key={member.id}
                style={chatStyles.memberItem}
                onPress={() => setMiniProfileUserId(member.id)}
                activeOpacity={0.7}
              >
                {member.avatar_url ? (
                  <Image source={{ uri: member.avatar_url }} style={chatStyles.memberAvatar} contentFit="cover" />
                ) : (
                  <View style={[chatStyles.memberAvatar, chatStyles.memberAvatarFallback]}>
                    <Text style={chatStyles.memberInitial}>{member.first_name?.[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <Text style={chatStyles.memberName} numberOfLines={1}>{member.first_name ?? ''}</Text>
              </TouchableOpacity>
            ))}
            {event.members.length > 5 && (
              <View style={chatStyles.memberItem}>
                <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                  <Text style={chatStyles.memberOverflowText}>+{event.members.length - 4}</Text>
                </View>
              </View>
            )}
          </View>
        )}

      </SafeAreaView>

      {/* ── Messages ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={enrichedItems}
            keyExtractor={item => item.id}
            inverted={true}
            contentContainerStyle={chatStyles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            windowSize={10}
            maxToRenderPerBatch={15}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            ListFooterComponent={event ? (
              <TouchableOpacity
                style={chatStyles.pinnedCard}
                onPress={() => router.push(`/plan/${id}` as any)}
                activeOpacity={0.8}
              >
                <Text style={chatStyles.pinnedTitle} numberOfLines={1}>{event.title}</Text>
                <View style={chatStyles.pinnedRow}>
                  <View style={chatStyles.pinnedDetail}>
                    <Ionicons name="calendar-outline" size={12} color="#B5522E" />
                    <Text style={chatStyles.pinnedDetailText}>{formatEventDate(event.start_time)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => showAddToCalendar(event.title, event.start_time)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={chatStyles.pinnedCalLink}>Add to Calendar</Text>
                  </TouchableOpacity>
                </View>
                <View style={chatStyles.pinnedRow}>
                  <Text style={chatStyles.pinnedSpots}>
                    {capDisplayCount(event.member_count)} going
                  </Text>
                </View>
                {!isPast && (() => {
                  const diff = new Date(event.start_time).getTime() - Date.now();
                  const hours = Math.floor(diff / 3600000);
                  const days = Math.floor(diff / 86400000);
                  if (diff < 0) return null;
                  const label = hours < 1 ? 'Starting soon!'
                    : hours < 24 ? `Tonight at ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                    : days === 1 ? 'Tomorrow!'
                    : `Happening in ${days} days`;
                  return <Text style={chatStyles.pinnedCountdown}>{label}</Text>;
                })()}
              </TouchableOpacity>
            ) : null}
            renderItem={({ item, index }) => {
              if ('type' in item && (item.type === 'date' || item.type === 'time')) {
                return (
                  <View style={bubbleStyles.systemRow}>
                    <Text style={bubbleStyles.systemText}>{item.label}</Text>
                  </View>
                );
              }

              const msg = item as ChatMessage;
              const isOwn = msg.user_id === currentUserId;

              // In inverted list: index-1 = newer in time, index+1 = older in time
              const newerItem = enrichedItems[index - 1];
              const newerMsg = newerItem && !('type' in newerItem) ? newerItem as ChatMessage : null;
              const olderItem = enrichedItems[index + 1];
              const olderMsg = olderItem && !('type' in olderItem) ? olderItem as ChatMessage : null;

              // In inverted list: index-1 = newer in time (below visually), index+1 = older in time (above visually)
              const isGroupedWithOlder = !!(olderMsg?.user_id === msg.user_id && isSameDay(olderMsg.created_at, msg.created_at));
              const isGroupedWithNewer = !!(newerMsg?.user_id === msg.user_id && isSameDay(msg.created_at, newerMsg.created_at));

              // Avatar: show on bottom-most message of group (when newer msg is different sender or doesn't exist)
              const showAvatar = !isOwn && !isGroupedWithNewer;
              // Name: show above top-most message of group (when older msg is different sender or doesn't exist)
              const showName = !isOwn && !isGroupedWithOlder;

              return (
                <View style={{ marginBottom: isGroupedWithOlder ? 1 : (msg.reactions?.length ? 16 : 10) }}>
                  <MessageBubble
                    message={msg}
                    isOwn={isOwn}
                    showAvatar={showAvatar}
                    showName={showName}
                    isGrouped={isGroupedWithNewer}
                    currentUserId={currentUserId}
                    planTitle={event?.title}
                    onPhotoPress={setPhotoViewUrl}
                    onReaction={toggleReaction}
                    onDelete={deleteMessage}
                  />
                </View>
              );
            }}
          />
        )}

        {/* Input bar */}
        {isPast ? (
          <View style={[chatStyles.readOnlyBar, { paddingBottom: insets.bottom + 8 }]}>
            <Text style={chatStyles.readOnlyText}>This chat is read-only — {event?.title ?? 'the plan'} has ended</Text>
          </View>
        ) : (
          <View style={[chatStyles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity onPress={handleAttachPress} style={chatStyles.cameraBtn} disabled={uploading}>
              {uploading ? (
                <ActivityIndicator size="small" color={Colors.warmGray} />
              ) : (
                <Ionicons name="add-circle-outline" size={26} color={Colors.warmGray} />
              )}
            </TouchableOpacity>

            <TextInput
              style={chatStyles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message..."
              placeholderTextColor={Colors.warmGray}
              multiline
              maxLength={1000}
              returnKeyType="default"
              autoCorrect={true}
              spellCheck={true}
            />

            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || uploading}
              style={[chatStyles.sendBtn, inputText.trim() ? chatStyles.sendBtnActive : chatStyles.sendBtnDisabled]}
            >
              <Ionicons name="arrow-up" size={18} color={Colors.white} />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Report user modal */}
      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => {
            setShowReport(false);
            setReportTarget(null);
          }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={id}
        />
      )}

      {/* Full-screen photo viewer */}
      <Modal visible={!!photoViewUrl} transparent animationType="fade">
        <Pressable style={chatStyles.photoModal} onPress={() => setPhotoViewUrl(null)}>
          {photoViewUrl && (
            <Image source={{ uri: photoViewUrl }} style={chatStyles.photoFull} contentFit="contain" />
          )}
          <TouchableOpacity style={chatStyles.photoClose} onPress={() => setPhotoViewUrl(null)}>
            <Ionicons name="close" size={24} color={Colors.white} />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      <MiniProfileCard
        userId={miniProfileUserId}
        visible={!!miniProfileUserId}
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setReportTarget({ id: uid, name: uname });
          setShowReport(true);
        }}
        onBlock={(uid, uname) => blockUser(uid, uname, () => router.back())}
      />

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </View>
  );
}

const chatStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    gap: 8,
  },
  backBtn: { padding: 2 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: '#2C1810' },
  headerSub: { fontSize: 11, color: '#78695C', marginTop: 1 },
  viewPlanBtn: {
    borderWidth: 1.5,
    borderColor: '#B5522E',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  viewPlanText: { fontSize: 12, fontWeight: '600' as const, color: '#B5522E' },
  ellipsisBtn: {
    padding: 4,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: Colors.white,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8DDD0',
  },
  memberItem: {
    alignItems: 'center',
    width: 40,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  memberAvatarFallback: {
    backgroundColor: '#F5EDE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B5522E',
  },
  memberName: {
    fontSize: 9,
    color: '#78695C',
    marginTop: 2,
    textAlign: 'center',
    maxWidth: 40,
  },
  memberOverflow: {
    backgroundColor: '#FAF5EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberOverflowText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B5522E',
  },

  ticketBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.parchment,
    borderLeftWidth: 3,
    borderLeftColor: Colors.terracotta,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  ticketLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  ticketCta: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },


  pinnedCard: {
    backgroundColor: '#FAF5EC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8DDD0',
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  pinnedTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: '#2C1810',
    marginBottom: 6,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pinnedDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinnedDetailText: {
    fontSize: 11,
    color: '#78695C',
  },
  pinnedCalLink: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B5522E',
  },
  pinnedSpots: {
    fontSize: 11,
    fontWeight: '600',
    color: '#78695C',
  },
  pinnedCountdown: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B5522E',
    marginTop: 6,
  },

  messageList: { paddingVertical: 12 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
    gap: 8,
  },
  cameraBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: '#F5F0E8',
    borderRadius: 20,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 9,
    paddingBottom: 9,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    maxHeight: 100,
    textAlign: 'left',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnActive: { backgroundColor: '#B5522E' },
  sendBtnDisabled: { backgroundColor: '#C5C0B8' },

  readOnlyBar: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  readOnlyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, fontStyle: 'italic' },

  photoModal: {
    flex: 1,
    backgroundColor: Colors.overlayDarker,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFull: { width: '100%', height: '80%' },
  photoClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
