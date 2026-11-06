import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { requestWithDeadline } from './requestWithDeadline';
import { supabase } from './supabase';

type MemberReport = {
  reporter_user_id: string;
  reported_user_id: string;
  reported_event_id: string | null;
  reason: string;
  details: string;
};

const inFlight = new Set<string>();
const timeout = 12_000;

async function readReceipt(id: string, report: MemberReport) {
  const { data, error } = await requestWithDeadline(supabase.from('reports')
    .select('id, reporter_user_id, reported_user_id, reported_event_id, reason, details')
    .eq('id', id).eq('reporter_user_id', report.reporter_user_id).maybeSingle(), timeout);
  if (error) throw error;
  if (data === null) return 'missing';
  if (data?.id !== id || data.reporter_user_id !== report.reporter_user_id ||
      data.reported_user_id !== report.reported_user_id || data.reported_event_id !== report.reported_event_id) {
    throw new Error('Unexpected report receipt');
  }
  return data.reason === report.reason && data.details === report.details ? 'received' : 'previous';
}

/** Keep only an opaque ID on the device so an interrupted report can be checked again. */
export async function submitMemberReport(report: MemberReport, isCurrent: () => boolean) {
  const owner = JSON.stringify([report.reporter_user_id, report.reported_user_id, report.reported_event_id]);
  const key = 'member-report:v1:' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner);
  const checkVisit = () => { if (!isCurrent()) throw new Error('Report form closed'); };
  checkVisit();
  if (inFlight.has(key)) throw new Error('This report is still being checked');
  inFlight.add(key);
  try {
    const previousId = await AsyncStorage.getItem(key);
    checkVisit();
    if (previousId !== null && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(previousId)) {
      throw new Error('Could not identify the pending report');
    }
    const id = previousId ?? Crypto.randomUUID();
    let receipt = previousId ? await readReceipt(id, report) : 'missing';
    checkVisit();
    if (receipt === 'missing') {
      if (!previousId) await AsyncStorage.setItem(key, id);
      checkVisit();
      const result = await requestWithDeadline(supabase.from('reports').insert({ ...report, id }), timeout)
        .catch(() => null);
      checkVisit();
      receipt = result && !result.error ? 'received' : await readReceipt(id, report);
      checkVisit();
      if (receipt === 'missing') throw new Error('Report receipt unavailable');
    }
    // If local cleanup fails, a retry can still recognize the confirmed row.
    await AsyncStorage.removeItem(key).catch(() => {});
    return receipt === 'received' ? 'received' : 'previous';
  } finally {
    inFlight.delete(key);
  }
}
