import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

// Lazy-load expo-calendar to avoid crash when native module isn't built yet
let Calendar: typeof import('expo-calendar') | null = null;
try { Calendar = require('expo-calendar'); } catch {}

function buildGoogleCalendarUrl(title: string, startTime: string, endTime?: string | null, location?: string): string {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: location || '',
    details: 'washedup plan — washedup.app',
  });
  return `https://calendar.google.com/calendar/event?${params.toString()}`;
}

async function addToAppleCalendar(
  title: string,
  startTime: string,
  endTime?: string | null,
  location?: string,
): Promise<boolean> {
  if (!Calendar) {
    Alert.alert('Not available', 'Apple Calendar requires a native rebuild. Use Google Calendar instead.');
    return false;
  }
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow calendar access in Settings to add events.');
      return false;
    }

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const defaultCal = calendars.find(c => c.allowsModifications && c.source?.name === 'iCloud')
      ?? calendars.find(c => c.allowsModifications)
      ?? calendars[0];

    if (!defaultCal) {
      Alert.alert('No calendar found', 'Could not find a writable calendar on this device.');
      return false;
    }

    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + 2 * 60 * 60 * 1000);

    await Calendar.createEventAsync(defaultCal.id, {
      title,
      startDate: start,
      endDate: end,
      location: location || undefined,
      notes: 'washedup plan — washedup.app',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    return true;
  } catch {
    return false;
  }
}

export function showAddToCalendar(
  title: string,
  startTime: string,
  endTime?: string | null,
  location?: string,
  onSuccess?: () => void,
) {
  const options = ['Apple Calendar', 'Google Calendar', 'Cancel'];

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: 2, title: 'Add to Calendar' },
      async (idx) => {
        if (idx === 0) {
          const ok = await addToAppleCalendar(title, startTime, endTime, location);
          if (ok) onSuccess?.();
        } else if (idx === 1) {
          Linking.openURL(buildGoogleCalendarUrl(title, startTime, endTime, location));
          onSuccess?.();
        }
      },
    );
  } else {
    Alert.alert('Add to Calendar', '', [
      {
        text: 'Google Calendar',
        onPress: () => {
          Linking.openURL(buildGoogleCalendarUrl(title, startTime, endTime, location));
          onSuccess?.();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
}
