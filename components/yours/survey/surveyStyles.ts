import { StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

export const styles = StyleSheet.create({
  attendancePerson: { paddingVertical: 8 },
  attendanceChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  attendanceChoice: { flexGrow: 1, minHeight: 44, paddingVertical: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, justifyContent: 'center' },
  attendanceChoiceSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  attendanceChoiceText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt, textAlign: 'center' },
  attendanceChoiceTextSelected: { color: Colors.white, fontFamily: Fonts.sansBold },
  attendanceSummary: { paddingHorizontal: 24, paddingTop: 8 },
  attendanceError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed },
  skipAttendance: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  root: { flex: 1, justifyContent: 'flex-end' },
  keyboardSpace: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.surveyScrim },

  // ── Plan card behind ──
  planContext: { ...StyleSheet.absoluteFillObject },
  cardBehindWrap: { paddingHorizontal: 20 },
  cardBehindEyebrow: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginBottom: 12,
  },
  cardBehind: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    alignItems: 'center',
  },
  cardBehindImg: { width: 56, height: 56, borderRadius: 10 },
  cardBehindImgFallback: { backgroundColor: Colors.yoursGhostBg },
  cardBehindBody: { flex: 1, minWidth: 0 },
  cardBehindTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  cardBehindMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },

  // ── Sheet ──
  sheet: {
    // Stay inside the safe space above the keyboard instead of translating
    // a fixed-height sheet past the top of a small screen.
    flexShrink: 1,
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.iconMuted,
    marginTop: 12,
  },

  // ── Header ──
  header: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.tertiary,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginTop: 4,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  stepDotOn: { backgroundColor: Colors.terracotta },
  stepDotDone: { backgroundColor: Colors.gold },
  stepCounter: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.terracotta,
    marginLeft: 6,
  },

  // ── Body + footer ──
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8, flexGrow: 1 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  primary: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  escape: { alignItems: 'center', paddingVertical: 8 },
  escapeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },

  // ── Step 1 pills (checkpoint 2 refines) ──
  pillCol: { gap: 10 },
  pill: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.terracotta },
  pillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  pillTextOn: { color: Colors.cream },

  // ── Step 1 comment reveal ──
  commentReveal: {
    overflow: 'hidden',
    marginTop: 6,
    justifyContent: 'flex-start',
  },
  commentLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.secondary,
    marginBottom: 8,
  },
  commentInput: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    minHeight: 72,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  commentHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 6,
  },

  // ── Step 2 attendance rows ──
  whoHelper: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: 19,
    marginBottom: 14,
  },
  attendList: { gap: 2 },
  attendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  // "Didn't make it" = the whole row dims. The faded rows answer "who's out" at
  // a glance; no strikethrough anywhere (striking "Didn't make it" double-negates).
  attendRowOut: { opacity: 0.5 },
  attendName: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  // Made = gold-tint FILL + ink text (reads filled). Missed = plain outline.
  tagMade: { borderColor: Colors.gold, backgroundColor: Colors.surveyChipFill },
  tagMissed: { borderColor: Colors.border, backgroundColor: 'transparent' },
  tagText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM },
  tagTextMade: { color: Colors.asphalt },
  tagTextMissed: { color: Colors.secondary },

  // ── Step 3 keep chips ──
  keepHeadline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    lineHeight: 28,
    marginBottom: 18,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 14,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  // Selected reads ADDED: gold-tint fill + terracotta ring + full-color avatar/ink.
  chipOn: { borderColor: Colors.terracotta, backgroundColor: Colors.surveyChipFill },
  // Deselected is a ghost: no fill, faint border, avatar + text dimmed.
  chipOff: { borderColor: Colors.border, backgroundColor: 'transparent', opacity: 0.45 },
  chipName: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },

  // ── Step 3 footer (equal-weight Add / Skip) ──
  keepRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  keepBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepBtnFill: { backgroundColor: Colors.terracotta },
  keepBtnFillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  keepBtnGhost: { borderWidth: 1.5, borderColor: Colors.border },
  keepBtnGhostText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },

  // ── Outcome overlay ──
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  toast: {
    backgroundColor: Colors.darkWarm,
    borderRadius: 18,
    overflow: 'hidden',
  },
  toastRule: { height: 3, backgroundColor: Colors.gold },
  toastInner: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  toastEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Colors.gold,
    marginBottom: 6,
  },
  toastTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
    lineHeight: 26,
  },
  toastQuiet: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.overlayWhite,
    marginTop: 6,
  },
  toastDismiss: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 10,
  },
  // Quiet variant (request-sent / failure, no mutual): a LIGHT cream/gold inline
  // toast. The dark gold-rule card is reserved exclusively for mutual moments.
  quietLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surveyQuietBg,
    borderWidth: 1,
    borderColor: Colors.goldAccent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  quietDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  quietTextCol: { flex: 1, gap: 3 },
  quietText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
});
