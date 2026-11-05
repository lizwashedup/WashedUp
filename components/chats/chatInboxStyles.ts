import { StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export const revised = StyleSheet.create({
  container: { backgroundColor: AfterglowColors.paper },
  separator: { backgroundColor: AfterglowColors.subtleLine },
});

export const styles = StyleSheet.create({
  loadErrorCard: { marginHorizontal:20, marginTop:24, padding:24, borderRadius:24, backgroundColor:Colors.cardBg, borderWidth:1, borderColor:Colors.border, alignItems:'flex-start', gap:12 },
  loadErrorIcon: { width:48, height:48, borderRadius:24, backgroundColor:Colors.accentSubtle, alignItems:'center', justifyContent:'center', marginBottom:4 },
  loadErrorTitle: { fontFamily:Fonts.sansBold, fontSize:FontSizes.bodyLG, color:Colors.asphalt },
  loadErrorBody: { fontFamily:Fonts.sans, fontSize:FontSizes.bodyMD, color:Colors.secondary },
  loadErrorButton: { minHeight:48, paddingHorizontal:24, borderRadius:24, justifyContent:'center', alignItems:'center', marginTop:8 },
  loadErrorButtonText: { fontFamily:Fonts.sansBold, fontSize:FontSizes.bodyMD, color:Colors.white },
  communityStatus: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  communityStatusText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  communityRetry: { minHeight: 44, justifyContent: 'center' },
  communityRetryText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  container: { flex: 1, backgroundColor: '#FAF5EC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2C1810',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },

  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  segmentTab: { marginRight: 24, paddingVertical: 8 },
  segmentLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  segmentLabelOn: { color: Colors.asphalt, fontFamily: Fonts.sansBold },
  segmentUnderline: {
    height: 2.5,
    backgroundColor: Colors.terracotta,
    borderRadius: 2,
    marginTop: 6,
  },

  sectionLabel: {
    fontWeight: '700',
    fontSize: 11,
    color: '#B5522E',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  pastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
  },
  pastHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pastLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: '#78695C',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowUnread: {
    backgroundColor: '#FAF0E8',
  },
  rowPast: { opacity: 0.55 },

  avatarContainer: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#F5EDE0',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  avatarIcon: {
    width: 44,
    height: 44,
  },

  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B5522E',
  },
  planTitle: { fontWeight: '700', fontSize: 15, color: '#2C1810', flex: 1 },
  textPast: { color: '#A09385' },
  timestamp: { fontSize: 12, color: '#A09385' },

  badge: {
    backgroundColor: '#B5522E',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },

  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { fontSize: 13, color: '#78695C', flex: 1 },
  datePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5EDE0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  datePillText: { fontSize: 10, fontWeight: '500', color: '#78695C' },
  countdownText: {
    fontSize: 12,
    color: '#78695C',
    marginTop: 2,
  },
  separator: { height: 1, backgroundColor: '#F5EDE0', marginLeft: 84 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyLogo: {
    width: 96,
    height: 96,
    marginBottom: 8,
  },
  emptyTitle: { fontWeight: '700', fontSize: 20, color: '#2C1810', textAlign: 'center' },
  emptySubtitle: { fontSize: 15, color: '#78695C', textAlign: 'center', lineHeight: 22 },
  emptyButton: {
    backgroundColor: '#B5522E',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 999,
    marginTop: 8,
  },
  emptyButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  noActiveState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 12,
  },
  noActiveText: { fontSize: 15, color: '#78695C', textAlign: 'center' },
  noActiveButton: {
    backgroundColor: '#B5522E',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  noActiveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
