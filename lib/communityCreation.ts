import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';

export type CommunityCreationDetails = { handle: string; name: string; city: string; purpose: string; method: 'open' | 'approval_required' };
export type CommunityCreationAttempt = { userId: string; requestId: string; details: CommunityCreationDetails };
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const key = (scope: CreatorPageScope) => `community-creation:v1:${scope.userId}`;
const locks = new Set<string>();
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export class CommunityCreationUnknown extends Error {
  constructor() { super('We couldn’t confirm whether your community was created. Check this request before starting another.'); }
}
function normalize(details: CommunityCreationDetails): CommunityCreationDetails {
  if (!details || !['open', 'approval_required'].includes(details.method)
    || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(details.handle)
    || ['name', 'city', 'purpose'].some(field => typeof details[field as keyof CommunityCreationDetails] !== 'string')) throw new Error('Check your community details.');
  const result = { handle: details.handle, name: details.name.trim(), city: details.city.trim(), purpose: details.purpose.trim(), method: details.method };
  if (result.name.length < 2 || result.name.length > 60 || !result.city.length || result.city.length > 60 || result.purpose.length < 10 || result.purpose.length > 140) throw new Error('Check your community details.');
  return result;
}
const same = (a: CommunityCreationDetails, b: CommunityCreationDetails) => (['handle', 'name', 'city', 'purpose', 'method'] as const).every(field => a[field] === b[field]);
async function token(scope: CreatorPageScope) {
  current(scope);
  const { data, error } = await requestWithDeadline(supabase.auth.getSession(), 8_000);
  current(scope);
  if (error) throw error;
  if (data.session?.user.id !== scope.userId || !data.session.access_token) throw new CreatorPageScopeExpired();
  return `Bearer ${data.session.access_token}`;
}
export async function readCommunityCreationAttempt(scope: CreatorPageScope): Promise<CommunityCreationAttempt | null> {
  current(scope); const raw = await AsyncStorage.getItem(key(scope)); current(scope);
  if (raw === null) return null;
  let attempt: CommunityCreationAttempt;
  try { attempt = JSON.parse(raw); } catch { throw new Error('Couldn’t read the saved community request.'); }
  if (attempt.userId !== scope.userId || !uuid.test(attempt.requestId)) throw new Error('Couldn’t read the saved community request.');
  normalize(attempt.details);
  return attempt;
}
/** A receipt is only accepted for the initiating account and exact submitted details. */
export async function checkCommunityCreation(attempt: CommunityCreationAttempt, scope: CreatorPageScope) {
  if (attempt.userId !== scope.userId || !uuid.test(attempt.requestId)) throw new CreatorPageScopeExpired();
  const authorization = await token(scope);
  const { data, error } = await requestWithDeadline(supabase.rpc('get_community_creation_attempt', { p_request_id: attempt.requestId }).setHeader('Authorization', authorization), 12_000);
  current(scope);
  if (error) throw error;
  if (data === null) return null; // Absence is not proof a timed-out transaction failed.
  if (data.request_id !== attempt.requestId || !uuid.test(data.community_id) || !same(normalize(data.payload), normalize(attempt.details))) throw new CommunityCreationUnknown();
  return data.community_id as string;
}
/** Called only after a verified receipt has been presented. Never clears an unknown request. */
export async function finishCommunityCreation(attempt: CommunityCreationAttempt, scope: CreatorPageScope) {
  current(scope); const ownedKey = key(scope);
  if (locks.has(ownedKey)) throw new Error('Your community request is already running.');
  locks.add(ownedKey);
  try {
    const id = await checkCommunityCreation(attempt, scope);
    if (!id) throw new CommunityCreationUnknown();
    const saved = await readCommunityCreationAttempt(scope);
    if (saved?.requestId === attempt.requestId) { current(scope); await AsyncStorage.removeItem(ownedKey); current(scope); }
    return id;
  } finally { locks.delete(ownedKey); }
}
export async function createCommunityWithJoining(details: CommunityCreationDetails, scope: CreatorPageScope) {
  current(scope); const ownedKey = key(scope);
  if (locks.has(ownedKey)) throw new Error('Your community request is already running.');
  locks.add(ownedKey);
  try {
    const normalized = normalize(details), authorization = await token(scope);
    let attempt = await readCommunityCreationAttempt(scope);
    if (attempt && !same(attempt.details, normalized)) throw new CommunityCreationUnknown();
    const firstDispatch = attempt === null;
    if (!attempt) {
      attempt = { userId: scope.userId, requestId: Crypto.randomUUID(), details: normalized };
      await AsyncStorage.setItem(ownedKey, JSON.stringify(attempt)); current(scope);
    }
    let response;
    try {
      response = await requestWithDeadline(supabase.rpc('create_community_with_joining', {
        p_request_id: attempt.requestId, p_handle: normalized.handle, p_name: normalized.name,
        p_city: normalized.city, p_purpose: normalized.purpose, p_join_policy: normalized.method,
      }).setHeader('Authorization', authorization), 15_000);
    } catch { current(scope); throw new CommunityCreationUnknown(); }
    current(scope);
    if (firstDispatch && response.error && /^[0-9A-Z]{5}$/.test(response.error.code ?? '')) {
      await AsyncStorage.removeItem(ownedKey); current(scope); throw response.error;
    }
    // A rejected transaction does not establish the result of an earlier retry.
    // Keep its intent until read-only reconciliation, including explicit errors.
    if (response.error || !uuid.test(response.data)) throw new CommunityCreationUnknown();
    const id = await checkCommunityCreation(attempt, scope);
    if (id !== response.data) throw new CommunityCreationUnknown();
    return { id, attempt };
  } finally { locks.delete(ownedKey); }
}
