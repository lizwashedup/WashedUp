import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitMemberReport } from '../memberReportSubmission';

const mockInsert = jest.fn();
const mockReceipt = jest.fn();
const mockFilter = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: () => ({
  insert: (row: unknown) => mockInsert(row),
  select: () => {
    const read = { eq: (key: string, value: string) => { mockFilter(key, value); return read; }, maybeSingle: () => mockReceipt() };
    return read;
  },
}) } }));

const report = { reporter_user_id: 'alex', reported_user_id: 'jamie', reported_event_id: 'picnic', reason: 'Other', details: 'Reported from plan' };
const current = () => true;
const lost = { error: new Error('reply lost') };
const missing = { data: null, error: null };
beforeEach(async () => {
  await AsyncStorage.clear();
  mockInsert.mockReset(); mockReceipt.mockReset(); mockFilter.mockClear();
});

it('confirms a committed report with only a read after losing its response', async () => {
  mockInsert.mockResolvedValueOnce(lost);
  mockReceipt.mockImplementationOnce(() => ({ data: mockInsert.mock.calls[0][0], error: null }));
  expect(await submitMemberReport(report, current)).toBe('received');
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockFilter.mock.calls).toEqual([['id', mockInsert.mock.calls[0][0].id], ['reporter_user_id', 'alex']]);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});

it('holds one opaque ID through failed reads and reuses it only after a successful empty read', async () => {
  mockInsert.mockResolvedValueOnce(lost);
  mockReceipt.mockRejectedValue(new Error('offline'));
  await expect(submitMemberReport(report, current)).rejects.toThrow();
  const id = mockInsert.mock.calls[0][0].id;
  const [key] = await AsyncStorage.getAllKeys();
  expect(key).toMatch(/^member-report:v1:[a-f0-9]{64}$/);
  expect(await AsyncStorage.getItem(key)).toBe(id);
  await expect(submitMemberReport(report, current)).rejects.toThrow();
  expect(mockInsert).toHaveBeenCalledTimes(1);
  mockReceipt.mockResolvedValueOnce(missing); mockInsert.mockResolvedValueOnce({ error: null });
  expect(await submitMemberReport(report, current)).toBe('received');
  expect(mockInsert.mock.calls[1][0].id).toBe(id);
});

it('does not submit an edited reason while resolving an earlier accepted report', async () => {
  mockInsert.mockResolvedValueOnce(lost); mockReceipt.mockRejectedValueOnce(new Error('offline'));
  await expect(submitMemberReport(report, current)).rejects.toThrow();
  mockReceipt.mockResolvedValueOnce({ data: mockInsert.mock.calls[0][0], error: null });
  const revised = { ...report, reason: 'Fake profile or spam' };
  expect(await submitMemberReport(revised, current)).toBe('previous');
  expect(mockInsert).toHaveBeenCalledTimes(1);
  mockInsert.mockResolvedValueOnce({ error: null });
  expect(await submitMemberReport(revised, current)).toBe('received');
  expect(mockInsert.mock.calls[1][0].id).not.toBe(mockInsert.mock.calls[0][0].id);
});

it.each(['reporter_user_id', 'reported_user_id', 'reported_event_id', 'id'])('rejects a mismatched %s without repeating the write', async field => {
  mockInsert.mockResolvedValueOnce(lost);
  mockReceipt.mockImplementation(() => ({ data: { ...mockInsert.mock.calls[0][0], [field]: 'unrelated' }, error: null }));
  await expect(submitMemberReport(report, current)).rejects.toThrow('Unexpected report receipt');
  await expect(submitMemberReport(report, current)).rejects.toThrow('Unexpected report receipt');
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it('keeps a second form from dispatching while the same report is in flight', async () => {
  let release!: () => void;
  let started!: () => void;
  const startedWrite = new Promise<void>(r => { started = r; });
  mockInsert.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = () => resolve({ error: null }); }); });
  const pending = submitMemberReport(report, current);
  await startedWrite;
  await expect(submitMemberReport(report, current)).rejects.toThrow('still being checked');
  release(); await pending;
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it('retires a delayed status read on leaving, and keeps another account independent', async () => {
  mockInsert.mockResolvedValueOnce(lost); mockReceipt.mockRejectedValueOnce(new Error('offline'));
  await expect(submitMemberReport(report, current)).rejects.toThrow();
  let active = true;
  mockReceipt.mockImplementationOnce(() => { active = false; return missing; });
  await expect(submitMemberReport(report, () => active)).rejects.toThrow('closed');
  mockInsert.mockResolvedValueOnce({ error:null });
  expect(await submitMemberReport({ ...report, reporter_user_id:'amelia' }, current)).toBe('received');
  expect(mockInsert.mock.calls[1][0].id).not.toBe(mockInsert.mock.calls[0][0].id);
  expect(await AsyncStorage.getAllKeys()).toHaveLength(1);
});
