import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import type { AfterglowFontFamilies } from '../../constants/Typography';
import ProfileButton from '../ProfileButton';
import { ChatContextHeader, chatHeaderActionStyle } from './ChatContextHeader';
import { ChatSizedText } from './ChatSizedText';
import { chatStyles } from './chatThreadStyles';
import type { ChatThreadMember, ChatThreadProps } from './ChatThread';

type HeaderProps = {
  thread: Pick<ChatThreadProps, 'title' | 'subtitle' | 'locationLabel' | 'viewContextLabel' | 'onViewContext' | 'calendarAction' | 'headerMenu' | 'renderHeaderBanner'>;
  typingLabel: string | null;
  conversationFonts: AfterglowFontFamilies;
  topInset: number;
  plusBtnRef: React.RefObject<View | null>;
  openPlusFromButton: () => void;
  handleReportMenu: () => void;
  loadingReportMembers: boolean;
  members: ChatThreadMember[];
  membersExpanded: boolean;
  setMembersExpanded: (expanded: boolean) => void;
  handleAvatarPress: (userId: string) => void;
  onBack: () => void;
};

/** Controlled header presentation; chat scope, member expansion and actions
 * remain owned by the existing conversation. */
export function ChatThreadHeader({ thread: props, typingLabel, conversationFonts, topInset,
  plusBtnRef, openPlusFromButton, handleReportMenu, loadingReportMembers, members,
  membersExpanded, setMembersExpanded, handleAvatarPress, onBack }: HeaderProps) {
  return (
      <View style={[chatStyles.headerSafe, COMMUNITY_CHAT_GROUPING_ENABLED && { backgroundColor: AfterglowColors.paper }, { paddingTop: topInset }]}>
        {COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatContextHeader
          title={props.title} subtitle={typingLabel ?? props.subtitle} location={props.locationLabel}
          contextLabel={props.viewContextLabel} fonts={conversationFonts}
          onBack={onBack} onViewContext={props.onViewContext}
          wrapActionsOnNarrow={!!props.calendarAction}
          actions={<>
            {props.calendarAction && <TouchableOpacity onPress={props.calendarAction.onPress} accessibilityRole="button" accessibilityLabel={props.calendarAction.label} style={chatHeaderActionStyle}>
              <Ionicons name="calendar-outline" size={21} color={AfterglowColors.clay} />
            </TouchableOpacity>}
            {props.headerMenu.type === 'plus' ? <TouchableOpacity ref={plusBtnRef} onPress={openPlusFromButton} style={chatHeaderActionStyle} accessibilityRole="button" accessibilityLabel="Add people or make a plan">
              <Ionicons name="add" size={24} color={AfterglowColors.clay} />
            </TouchableOpacity> : <TouchableOpacity onPress={handleReportMenu} disabled={loadingReportMembers} accessibilityState={{ disabled: loadingReportMembers, busy: loadingReportMembers }} style={chatHeaderActionStyle} accessibilityRole="button" accessibilityLabel="More options">
              {loadingReportMembers ? <ActivityIndicator size="small" color={AfterglowColors.ink} /> : <Ionicons name="ellipsis-horizontal" size={21} color={AfterglowColors.ink} />}
            </TouchableOpacity>}
          </>}
        /> : <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={onBack}
            style={chatStyles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to Chats"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>

          <View style={chatStyles.headerCenter}>
            <Text style={chatStyles.headerTitle} numberOfLines={1}>{props.title}</Text>
            {(typingLabel ?? props.subtitle) != null && (
              <Text style={chatStyles.headerSub} numberOfLines={1}>
                {typingLabel ?? props.subtitle}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={props.onViewContext}
            style={chatStyles.viewPlanBtn}
            accessibilityRole="button"
            accessibilityLabel={props.viewContextLabel}
          >
            <Text style={chatStyles.viewPlanText} numberOfLines={1}>{props.viewContextLabel}</Text>
          </TouchableOpacity>

          {props.headerMenu.type === 'plus' ? (
            <TouchableOpacity
              ref={plusBtnRef}
              onPress={openPlusFromButton}
              style={chatStyles.ellipsisBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Add people or make a plan"
            >
              <Ionicons name="add" size={24} color={Colors.terracotta} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleReportMenu}
              disabled={loadingReportMembers}
              accessibilityState={{ disabled: loadingReportMembers, busy: loadingReportMembers }}
              style={chatStyles.ellipsisBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              {loadingReportMembers ? <ActivityIndicator size="small" color={Colors.warmGray} /> : <Ionicons name="ellipsis-horizontal" size={20} color={Colors.warmGray} />}
            </TouchableOpacity>
          )}
          <ProfileButton compact/>
        </View>}

        {/* Header banner slot (plan ticket banner) */}
        {props.renderHeaderBanner?.()}

        {/* Member avatars row */}
        {members.length > 0 && (() => {
          const total = members.length;
          const isOverflow = total > 5;
          const visibleMembers = !isOverflow || membersExpanded
            ? members
            : members.slice(0, 4);
          return (
            <ScrollView
              decelerationRate="normal"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[chatStyles.membersRow, COMMUNITY_CHAT_GROUPING_ENABLED && { backgroundColor: AfterglowColors.paper }]}
              contentContainerStyle={chatStyles.membersRowContent}
            >
              {visibleMembers.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => handleAvatarPress(member.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${member.first_name || 'member'} profile`}
                >
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={chatStyles.memberAvatar} contentFit="cover" />
                  ) : (
                    <View style={[chatStyles.memberAvatar, chatStyles.memberAvatarFallback]}>
                      <ChatSizedText allowFontScaling={!COMMUNITY_CHAT_GROUPING_ENABLED} style={[chatStyles.memberInitial, COMMUNITY_CHAT_GROUPING_ENABLED && { fontFamily: conversationFonts.medium, color: AfterglowColors.clay }]}>{member.first_name?.[0]?.toUpperCase() ?? '?'}</ChatSizedText>
                    </View>
                  )}
                  <ChatSizedText style={[chatStyles.memberName, COMMUNITY_CHAT_GROUPING_ENABLED && { fontFamily: conversationFonts.regular, color: AfterglowColors.muted }]} numberOfLines={1}>{member.first_name ?? ''}</ChatSizedText>
                </TouchableOpacity>
              ))}
              {isOverflow && !membersExpanded && (
                <TouchableOpacity
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => setMembersExpanded(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${total - 4} more members`}
                >
                  <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                    <ChatSizedText style={chatStyles.memberOverflowText}>+{total - 4}</ChatSizedText>
                  </View>
                </TouchableOpacity>
              )}
              {isOverflow && membersExpanded && (
                <TouchableOpacity
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => setMembersExpanded(false)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Show fewer members"
                >
                  <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                    <Ionicons name="chevron-back" size={16} color={Colors.terracotta} />
                  </View>
                </TouchableOpacity>
              )}
            </ScrollView>
          );
        })()}

      </View>
  );
}
