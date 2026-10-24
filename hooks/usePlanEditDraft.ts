import { useCallback, useState, type SetStateAction } from 'react';
import { FEATURED_DEFAULT_CAPACITY } from '../constants/GroupLimits';
import { getLAWallParts } from '../lib/laDate';
import { minMaxToAgeRanges, type AgeRange, type PlanEditDraft } from '../lib/planEditDraft';

export type PlanEditSource = {
  title: string; description: string | null; host_message: string | null;
  location_text: string | null; location_lat: number | null; location_lng: number | null;
  tickets_url: string | null; image_url: string | null; primary_vibe: string | null;
  gender_rule: string | null; target_age_min: number | null; target_age_max: number | null;
  max_invites: number | null; is_featured: boolean;
  featured_type: PlanEditDraft['featuredType'] | null;
  start_time: string; end_time: string | null;
};
type DateSelection = Pick<PlanEditDraft, 'year' | 'month' | 'day'>;
type TimeSelection = Pick<PlanEditDraft, 'hour' | 'minute' | 'period'>;

function emptyDraft(): PlanEditDraft {
  return {
    title: '', description: '', creatorMessage: '', location: '', locationLat: null,
    locationLng: null, ticketUrl: '', imageUrl: null, category: null, genderRule: 'mixed',
    year: new Date().getFullYear(), month: 0, day: 1, hour: 7, minute: '00', period: 'PM',
    timeChanged: false, ageRanges: [], ageChanged: false, groupSize: 6, groupChanged: false,
    featured: false, featuredChanged: false, featuredType: 'washedup_event',
    featuredCapacity: FEATURED_DEFAULT_CAPACITY,
  };
}

/** Local editor state only. The screen and usePlanEdit retain visit/account
 * checks, permission gates, photo requests, writes and uncertain-save recovery.
 * Reset only when starting a fresh edit, never when reopening an uncertain save.
 */
export function usePlanEditDraft() {
  const [draft, setDraft] = useState(emptyDraft);
  const [original, setOriginal] = useState<PlanEditSource | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [dateSelection, setDateSelection] = useState<DateSelection>(() => ({
    year: new Date().getFullYear(), month: 0, day: 1,
  }));
  const [timeSelection, setTimeSelection] = useState<TimeSelection>({ hour: 7, minute: '00', period: 'PM' });
  const validTime = timeSelection.hour >= 1 && timeSelection.hour <= 12 &&
    /^\d{1,2}$/.test(timeSelection.minute) && Number(timeSelection.minute) <= 59;

  const setField = useCallback(<K extends keyof PlanEditDraft>(key: K, value: SetStateAction<PlanEditDraft[K]>) => {
    setDraft(previous => ({ ...previous, [key]: typeof value === 'function' ? value(previous[key]) : value }));
  }, []);
  const setTimeField = <K extends keyof TimeSelection>(key: K, value: TimeSelection[K]) => {
    setTimeSelection(previous => ({ ...previous, [key]: value }));
  };
  const closeDatePicker = useCallback(() => setDatePickerVisible(false), []);
  const closeTimePicker = useCallback(() => setTimePickerVisible(false), []);
  const closePickers = useCallback(() => {
    setDatePickerVisible(false);
    setTimePickerVisible(false);
  }, []);

  const reset = (plan: PlanEditSource) => {
    const start = getLAWallParts(plan.start_time);
    setOriginal({ ...plan });
    setDraft(previous => ({
      ...previous,
      title: plan.title, description: plan.description ?? '', creatorMessage: plan.host_message ?? '',
      location: plan.location_text ?? '', locationLat: plan.location_lat ?? null,
      locationLng: plan.location_lng ?? null, ticketUrl: plan.tickets_url ?? '', imageUrl: plan.image_url ?? null,
      category: plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null,
      genderRule: plan.gender_rule ?? 'mixed', ageRanges: minMaxToAgeRanges(plan.target_age_min, plan.target_age_max),
      groupSize: plan.max_invites ?? 6, featured: plan.is_featured,
      featuredType: plan.featured_type ?? 'washedup_event',
      featuredCapacity: plan.is_featured ? (plan.max_invites ?? 99) + 1 : FEATURED_DEFAULT_CAPACITY,
      timeChanged: false, ageChanged: false, groupChanged: false, featuredChanged: false,
      ...(start ? {
        year: start.y, month: start.m, day: start.d, hour: start.hour24 % 12 || 12,
        minute: String(start.minute).padStart(2, '0'), period: start.hour24 >= 12 ? 'PM' as const : 'AM' as const,
      } : {}),
    }));
    return !!start;
  };
  const openDatePicker = () => {
    setDateSelection({ year: draft.year, month: draft.month, day: draft.day });
    setDatePickerVisible(true);
  };
  const selectDate = (date: DateSelection) => {
    setDraft(previous => ({ ...previous, ...date, timeChanged: true }));
    closeDatePicker();
  };
  const openTimePicker = () => {
    setTimeSelection({ hour: draft.hour, minute: draft.minute, period: draft.period });
    setTimePickerVisible(true);
  };
  const confirmTime = () => {
    if (!validTime) return;
    setDraft(previous => ({ ...previous, ...timeSelection, minute: timeSelection.minute.padStart(2, '0'), timeChanged: true }));
    closeTimePicker();
  };
  const toggleAgeRange = (range: AgeRange) => {
    setDraft(previous => {
      const filtered = previous.ageRanges.filter(item => item !== 'All Ages');
      const ageRanges = range === 'All Ages' ? [range] : filtered.includes(range)
        ? filtered.filter(item => item !== range) : filtered.length >= 2 ? filtered : [...filtered, range];
      return { ...previous, ageChanged: true, ageRanges };
    });
  };

  return {
    draft, original, setField, reset, toggleAgeRange,
    datePickerVisible, dateSelection, openDatePicker, closeDatePicker, selectDate,
    timePickerVisible, timeSelection, validTime, setTimeField, openTimePicker, closeTimePicker, confirmTime,
    closePickers,
  };
}
