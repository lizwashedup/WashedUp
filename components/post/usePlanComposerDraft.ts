import { useState } from 'react';
import { getTodayInLA } from '../../lib/laDate';
import type { PlanCategory } from '../../constants/Categories';
import type { InviteChip } from './InvitePeopleSection';
import type { GenderPreference, AgeRange } from './planComposerRules';

/** Editable fields only. The screen owns async work, validation and navigation. */
export function usePlanComposerDraft() {
  // ── Core fields ──
  const [title, setTitle] = useState('');
  const [exploreEventId, setExploreEventId] = useState<string | null>(null);
  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [creatorMessage, setCreatorMessage] = useState('');

  // ── Place ──
  const [location, setLocation] = useState('');
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [neighborhood, setNeighborhood] = useState('');

  // ── When ──
  const today = getTodayInLA();
  const [dateMonth, setDateMonth] = useState(today.m);
  const [dateDay, setDateDay] = useState(today.d);
  const [dateYear, setDateYear] = useState(today.y);
  const [dateSelected, setDateSelected] = useState(false);
  const [timeHour, setTimeHour] = useState(8);
  const [timeMinute, setTimeMinute] = useState('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [timeSelected, setTimeSelected] = useState(false);
  // End time is optional (legacy parity). When set we compose end_time, rolling
  // to the next day for an overnight plan; min 30 min after start.
  const [endTimeHour, setEndTimeHour] = useState(9);
  const [endTimeMinute, setEndTimeMinute] = useState('00');
  const [endTimePeriod, setEndTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [endTimeSelected, setEndTimeSelected] = useState(false);

  // ── How many + audience ──
  const [groupSize, setGroupSize] = useState(6); // max_invites; UI shows groupSize+1 total
  const [genderPref, setGenderPref] = useState<GenderPreference>('mixed');
  const [ageRanges, setAgeRanges] = useState<AgeRange[]>([]);

  // ── Link/tickets, joinability, + secondary optional fields (surfaced from the
  //    retired "more options" collapsible) ──
  const [ticketUrl, setTicketUrl] = useState('');
  const [dropIn, setDropIn] = useState(true);
  const [allowDuplicate, setAllowDuplicate] = useState(true);
  const [description, setDescription] = useState('');
  const [invited, setInvited] = useState<InviteChip[]>([]);

  const resetFields = () => {
    setTitle(''); setExploreEventId(null); setCategory(null); setImageUrl(null); setCreatorMessage('');
    setLocation(''); setLocationLat(null); setLocationLng(null); setNeighborhood('');
    setTicketUrl(''); setDescription(''); setGenderPref('mixed'); setAgeRanges([]);
    setGroupSize(6); setDateSelected(false); setTimeSelected(false); setDropIn(true);
    setAllowDuplicate(true); setInvited([]);
    setEndTimeSelected(false);
    setDateMonth(today.m); setDateDay(today.d); setDateYear(today.y);
    setTimeHour(8); setTimeMinute('00'); setTimePeriod('PM');
    setEndTimeHour(9); setEndTimeMinute('00'); setEndTimePeriod('PM');
  };
  return {
    title, setTitle, exploreEventId, setExploreEventId, category, setCategory,
    imageUrl, setImageUrl, creatorMessage, setCreatorMessage, location, setLocation,
    locationLat, setLocationLat, locationLng, setLocationLng, neighborhood, setNeighborhood,
    dateMonth, setDateMonth, dateDay, setDateDay, dateYear, setDateYear,
    dateSelected, setDateSelected, timeHour, setTimeHour, timeMinute, setTimeMinute,
    timePeriod, setTimePeriod, timeSelected, setTimeSelected, endTimeHour, setEndTimeHour,
    endTimeMinute, setEndTimeMinute, endTimePeriod, setEndTimePeriod, endTimeSelected, setEndTimeSelected,
    groupSize, setGroupSize, genderPref, setGenderPref, ageRanges, setAgeRanges,
    ticketUrl, setTicketUrl, dropIn, setDropIn, allowDuplicate, setAllowDuplicate,
    description, setDescription, invited, setInvited,
    resetFields,
  };
}
