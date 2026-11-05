import { useState } from 'react';
import { FEATURED_DEFAULT_CAPACITY } from '../constants/GroupLimits';
import { getLAWallParts } from '../lib/laDate';
import type { PlanDetail } from '../lib/planDetailData';
import { minMaxToAgeRanges, type AgeRange } from '../lib/planEditDraft';

/** Local form values only. The route and usePlanEdit retain permissions,
 * request ownership, unknown-save recovery and native modal transitions. */
export function usePlanEditDraft() {
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCreatorMessage, setEditCreatorMessage] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLocationLat, setEditLocationLat] = useState<number | null>(null);
  const [editLocationLng, setEditLocationLng] = useState<number | null>(null);
  const [editTicketUrl, setEditTicketUrl] = useState('');
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editDateMonth, setEditDateMonth] = useState(0);
  const [editDateDay, setEditDateDay] = useState(1);
  const [editDateYear, setEditDateYear] = useState(new Date().getFullYear());
  const [editTimeHour, setEditTimeHour] = useState(7);
  const [editTimeMinute, setEditTimeMinute] = useState<string>('00');
  const [editTimePeriod, setEditTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [editGenderRule, setEditGenderRule] = useState('mixed');
  const [editAgeRanges, setEditAgeRanges] = useState<AgeRange[]>([]);
  const [editGroupSize, setEditGroupSize] = useState(6);
  const [editOriginal, setEditOriginal] = useState<PlanDetail | null>(null);
  const [editAgeChanged, setEditAgeChanged] = useState(false);
  const [editTimeChanged, setEditTimeChanged] = useState(false);
  const [editGroupChanged, setEditGroupChanged] = useState(false);
  const [editFeaturedChanged, setEditFeaturedChanged] = useState(false);
  const [featuredToggle, setFeaturedToggle] = useState(false);
  const [featuredType, setFeaturedType] = useState<'washedup_event' | 'birthday_party' | 'special_event' | 'plan_in_making'>('washedup_event');
  const [featuredCapacity, setFeaturedCapacity] = useState(FEATURED_DEFAULT_CAPACITY);

  const initialize = (plan: PlanDetail) => {
    setEditOriginal({ ...plan });
    setEditAgeChanged(false); setEditTimeChanged(false); setEditGroupChanged(false); setEditFeaturedChanged(false);
    setFeaturedToggle(plan.is_featured);
    setFeaturedType(plan.featured_type ?? 'washedup_event');
    setFeaturedCapacity(plan.is_featured ? (plan.max_invites ?? 99) + 1 : FEATURED_DEFAULT_CAPACITY);
    setEditTitle(plan.title);
    setEditDescription(plan.description ?? '');
    setEditCreatorMessage(plan.host_message ?? '');
    setEditLocation(plan.location_text ?? '');
    setEditLocationLat(plan.location_lat ?? null);
    setEditLocationLng(plan.location_lng ?? null);
    setEditTicketUrl(plan.tickets_url ?? '');
    setEditImageUrl(plan.image_url ?? null);
    setEditCategory(plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null);
    setEditGenderRule(plan.gender_rule ?? 'mixed');
    setEditAgeRanges(minMaxToAgeRanges(plan.target_age_min, plan.target_age_max));
    setEditGroupSize(plan.max_invites ?? 6);
    // Seed the date / time pickers from the existing plan.start_time
    const start = getLAWallParts(plan.start_time);
    if (!start) return false;
    setEditDateMonth(start.m);
    setEditDateDay(start.d);
    setEditDateYear(start.y);
    const h24 = start.hour24;
    const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setEditTimeHour(h12);
    // Preserve the exact published minute when opening Manage. A no-op edit
    // must never silently move a Plan to a quarter-hour boundary.
    setEditTimeMinute(String(start.minute).padStart(2, '0'));
    setEditTimePeriod(period);
    return true;
  };

  return {
    title: editTitle,
    setTitle: setEditTitle,
    description: editDescription,
    setDescription: setEditDescription,
    creatorMessage: editCreatorMessage,
    setCreatorMessage: setEditCreatorMessage,
    location: editLocation,
    setLocation: setEditLocation,
    locationLat: editLocationLat,
    setLocationLat: setEditLocationLat,
    locationLng: editLocationLng,
    setLocationLng: setEditLocationLng,
    ticketUrl: editTicketUrl,
    setTicketUrl: setEditTicketUrl,
    imageUrl: editImageUrl,
    setImageUrl: setEditImageUrl,
    dateMonth: editDateMonth,
    setDateMonth: setEditDateMonth,
    dateDay: editDateDay,
    setDateDay: setEditDateDay,
    dateYear: editDateYear,
    setDateYear: setEditDateYear,
    timeHour: editTimeHour,
    setTimeHour: setEditTimeHour,
    timeMinute: editTimeMinute,
    setTimeMinute: setEditTimeMinute,
    timePeriod: editTimePeriod,
    setTimePeriod: setEditTimePeriod,
    datePickerVisible: showEditDatePicker,
    setDatePickerVisible: setShowEditDatePicker,
    timePickerVisible: showEditTimePicker,
    setTimePickerVisible: setShowEditTimePicker,
    category: editCategory,
    setCategory: setEditCategory,
    genderRule: editGenderRule,
    setGenderRule: setEditGenderRule,
    ageRanges: editAgeRanges,
    setAgeRanges: setEditAgeRanges,
    groupSize: editGroupSize,
    setGroupSize: setEditGroupSize,
    original: editOriginal,
    setOriginal: setEditOriginal,
    ageChanged: editAgeChanged,
    setAgeChanged: setEditAgeChanged,
    timeChanged: editTimeChanged,
    setTimeChanged: setEditTimeChanged,
    groupChanged: editGroupChanged,
    setGroupChanged: setEditGroupChanged,
    featuredChanged: editFeaturedChanged,
    setFeaturedChanged: setEditFeaturedChanged,
    featured: featuredToggle,
    setFeatured: setFeaturedToggle,
    featuredType: featuredType,
    setFeaturedType: setFeaturedType,
    featuredCapacity: featuredCapacity,
    setFeaturedCapacity: setFeaturedCapacity,
    initialize,
  };
}
