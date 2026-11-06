import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPostPlanSurveyHandled, markPostPlanSurveyHandled } from '../postPlanSurveyHandled';

beforeEach(() => AsyncStorage.clear());
afterEach(() => jest.restoreAllMocks());

it('respects legacy dismissals without adding new entries to the unowned list', async () => {
  const old = JSON.stringify(['past']);
  await AsyncStorage.setItem('postPlanSurvey.handledV1', old);
  await markPostPlanSurveyHandled('picnic', 'amelia');
  expect(await isPostPlanSurveyHandled('past', 'james')).toBe(true);
  expect(await isPostPlanSurveyHandled('picnic', 'james')).toBe(false);
  expect(await isPostPlanSurveyHandled('picnic', 'amelia')).toBe(true);
  expect(await AsyncStorage.getItem('postPlanSurvey.handledV1')).toBe(old);
});

it('replaces a malformed account list without losing valid older suppression', async () => {
  await AsyncStorage.setItem('postPlanSurvey.handledV2:amelia', '{');
  await AsyncStorage.setItem('postPlanSurvey.handledV1', '["past"]');
  expect(await isPostPlanSurveyHandled('past', 'amelia')).toBe(true);
  await markPostPlanSurveyHandled('picnic', 'amelia');
  expect(await isPostPlanSurveyHandled('picnic', 'amelia')).toBe(true);
});

it('keeps the dismissal history bounded for each account independently', async () => {
  await markPostPlanSurveyHandled('first', 'james');
  await markPostPlanSurveyHandled('first', 'amelia');
  for (let n=0; n<100; n++) await markPostPlanSurveyHandled(String(n), 'amelia');
  expect(await isPostPlanSurveyHandled('first', 'amelia')).toBe(false);
  expect(await isPostPlanSurveyHandled('first', 'james')).toBe(true);
});

it('does not trap someone in the survey if the device store is unavailable', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage offline'));
  await expect(markPostPlanSurveyHandled('picnic', 'amelia')).resolves.toBeUndefined();
  jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('storage offline'));
  await expect(isPostPlanSurveyHandled('picnic', 'amelia')).resolves.toBe(false);
});
