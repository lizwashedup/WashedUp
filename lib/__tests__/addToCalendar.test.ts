import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { showAddToCalendar } from '../addToCalendar';
import * as Calendar from 'expo-calendar';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createEventAsync: jest.fn(),
}));

const stamp = '2026-11-14T21:00:00Z';
let choose: (index: number) => void;
let alert: jest.SpyInstance;
const success = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = 'ios';
  jest.spyOn(ActionSheetIOS,'showActionSheetWithOptions').mockImplementation((_,selected) => { choose = selected; });
  alert = jest.spyOn(Alert,'alert').mockImplementation(() => {});
  jest.mocked(Calendar.requestCalendarPermissionsAsync).mockResolvedValue({status:'granted'} as any);
  jest.mocked(Calendar.getCalendarsAsync).mockResolvedValue([{id:'fictional-calendar',allowsModifications:true}] as any);
  jest.mocked(Calendar.createEventAsync).mockResolvedValue('fictional-event');
});
afterEach(() => jest.restoreAllMocks());
async function add(callback?:()=>void) {
  showAddToCalendar('Fictional picnic',stamp,null,'A public park',callback);
  await choose(0);
}
it('does not try to save into a read-only calendar',async()=>{
  jest.mocked(Calendar.getCalendarsAsync).mockResolvedValue([{id:'readonly',allowsModifications:false}] as any);
  await add(success);
  expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('No calendar found',expect.any(String));
  expect(success).not.toHaveBeenCalled();
});
it.each(['thrown','empty ID'])('asks the member to check before retrying an unconfirmed save (%s)',async mode=>{
  if(mode==='thrown')jest.mocked(Calendar.createEventAsync).mockRejectedValue(Error('lost receipt'));
  else jest.mocked(Calendar.createEventAsync).mockResolvedValue('');
  await add(success);
  expect(alert).toHaveBeenCalledWith('Couldn’t confirm the calendar entry',expect.stringMatching(/check/i));
  expect(success).not.toHaveBeenCalled();
});
it('confirms a saved event when called from the plan without a success callback',async()=>{
  await add();
  expect(alert).toHaveBeenCalledWith('Added to your calendar',expect.stringContaining('Fictional picnic'));
});
it('shows a failed calendar read before making any write',async()=>{
  jest.mocked(Calendar.getCalendarsAsync).mockRejectedValue(Error('offline'));
  await add(success);
  expect(alert).toHaveBeenCalledWith('Couldn’t open Apple Calendar',expect.any(String));
  expect(Calendar.createEventAsync).not.toHaveBeenCalled();
});
it('preserves the supplied success action and selected interval',async()=>{
  await add(success);
  expect(success).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  expect(Calendar.createEventAsync).toHaveBeenCalledWith('fictional-calendar',expect.objectContaining({
    title:'Fictional picnic',location:'A public park',startDate:new Date(stamp),endDate:new Date('2026-11-14T23:00:00Z'),
  }));
});
it('leaves cancel and denied permission free of writes',async()=>{
  showAddToCalendar('Fictional picnic',stamp,null,'A public park',success);
  await choose(2);
  expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  jest.mocked(Calendar.requestCalendarPermissionsAsync).mockResolvedValue({status:'denied'} as any);
  await add(success);
  expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});
