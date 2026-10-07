import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import type { CommunityOperationScope } from './communityChat';
import { requestWithDeadline } from './requestWithDeadline';

export interface TopicWelcomeAttempt { id: string; topicId: string; eventId: string; userId: string; text: string }
export interface TopicWelcomeState { text: string; attempt: TopicWelcomeAttempt | null; unsaved?: boolean }
const queues = new Map<string, Promise<unknown>>();
const retained = new Map<string, TopicWelcomeState>();
const uuid = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function current(owner: CommunityOperationScope) {
  if (!owner.userId || !owner.isCurrent()) throw Error('This conversation visit has changed.');
}
function key(topicId: string, eventId: string, owner: CommunityOperationScope) {
  current(owner);
  if (![topicId, eventId, owner.userId].every(id => uuid.test(id))) throw Error('This conversation is unavailable.');
  return `topic-welcome:v1:${owner.userId}:${topicId}`;
}
function validate(value: TopicWelcomeState, topicId: string, eventId: string, owner: CommunityOperationScope) {
  if (!value || typeof value.text !== 'string' || value.text.length > 4000) throw Error('Your welcome draft could not be read.');
  const a = value.attempt;
  if (a && (!uuid.test(a.id) || a.topicId !== topicId || a.eventId !== eventId || a.userId !== owner.userId || typeof a.text !== 'string' || !a.text.trim() || a.text.length > 4000)) throw Error('Your original welcome could not be read.');
}
async function serial<T>(storageKey: string, work: () => Promise<T>) {
  const next = (queues.get(storageKey) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(storageKey, next);
  try { return await next; } finally { if (queues.get(storageKey) === next) queues.delete(storageKey); }
}
async function read(storageKey: string, topicId: string, eventId: string, owner: CommunityOperationScope): Promise<TopicWelcomeState> {
  const memory = retained.get(storageKey);
  if (memory) { validate(memory, topicId, eventId, owner); return { ...memory, unsaved: true }; }
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return { text: '', attempt: null };
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.eventId !== eventId || value.topicId !== topicId || value.userId !== owner.userId) throw Error('Your welcome draft could not be read.');
  validate(value, topicId, eventId, owner);
  return { text: value.text, attempt: value.attempt ?? null };
}
async function persist(storageKey: string, topicId: string, eventId: string, owner: CommunityOperationScope, state: TopicWelcomeState) {
  validate(state, topicId, eventId, owner);
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify({ version: 1, topicId, eventId, userId: owner.userId, text: state.text, attempt: state.attempt }));
    retained.delete(storageKey);
  } catch (error) { retained.set(storageKey, state); throw error; }
}
export async function readTopicWelcome(topicId: string, eventId: string, owner: CommunityOperationScope) {
  const storageKey = key(topicId, eventId, owner);
  return serial(storageKey, async () => { current(owner); const state = await read(storageKey, topicId, eventId, owner); current(owner); return state; });
}
export function saveTopicWelcomeDraft(topicId: string, eventId: string, owner: CommunityOperationScope, text: string) {
  const storageKey = key(topicId, eventId, owner);
  // Already initiated local writes finish under their original account/room key
  // on navigation; future reads wait for them. They never dispatch a message.
  return serial(storageKey, async () => {
    const state = await read(storageKey, topicId, eventId, owner);
    await persist(storageKey, topicId, eventId, owner, { text, attempt: state.attempt });
  });
}
export function prepareTopicWelcome(topicId: string, eventId: string, owner: CommunityOperationScope, text: string) {
  const storageKey = key(topicId, eventId, owner);
  return serial(storageKey, async () => {
    current(owner);
    const state = await read(storageKey, topicId, eventId, owner);
    if (state.attempt) throw Error('Check your original welcome first.');
    const attempt = { id: Crypto.randomUUID(), topicId, eventId, userId: owner.userId, text };
    current(owner);
    await persist(storageKey, topicId, eventId, owner, { text: state.text, attempt });
    current(owner); return attempt;
  });
}
type Query<T> = PromiseLike<T> & { setHeader(name: string, value: string): Query<T>; abortSignal?(signal: AbortSignal): Query<T> };
async function request<T>(owner: CommunityOperationScope, make: () => Query<T>) {
  current(owner);
  const { data, error } = await supabase.auth.getSession();
  current(owner);
  if (error || data.session?.user.id !== owner.userId || !data.session.access_token) throw Error('Sign in with the account that started this welcome.');
  const query = make().setHeader('Authorization', `Bearer ${data.session.access_token}`);
  const result = await requestWithDeadline(query, 12000);
  current(owner); return result;
}
export async function checkTopicWelcome(attempt: TopicWelcomeAttempt, owner: CommunityOperationScope) {
  key(attempt.topicId, attempt.eventId, owner); validate({ text: attempt.text, attempt }, attempt.topicId, attempt.eventId, owner);
  const { data, error } = await request(owner, () => supabase.from('community_topic_messages')
    .select('id,created_at,body,sender_id,topic_id').eq('id', attempt.id).eq('topic_id', attempt.topicId).eq('sender_id', attempt.userId).maybeSingle());
  if (error) throw error;
  if (!data) return null;
  if (data.id !== attempt.id || data.topic_id !== attempt.topicId || data.sender_id !== attempt.userId || data.body !== attempt.text.trim() || !Number.isFinite(Date.parse(data.created_at))) throw Error('The welcome confirmation did not match.');
  return { id: data.id, created_at: data.created_at };
}
export async function sendTopicWelcome(attempt: TopicWelcomeAttempt, owner: CommunityOperationScope) {
  const storageKey = key(attempt.topicId, attempt.eventId, owner);
  await serial(storageKey, async () => {
    current(owner);
    const state = await read(storageKey, attempt.topicId, attempt.eventId, owner);
    if (JSON.stringify(state.attempt) !== JSON.stringify(attempt)) throw Error('Your original welcome changed.');
    await persist(storageKey, attempt.topicId, attempt.eventId, owner, state);
  });
  const existing = await checkTopicWelcome(attempt, owner); if (existing) return existing;
  try {
    const { data, error } = await request(owner, () => supabase.rpc('set_event_chat_welcome_message', { p_event_id: attempt.eventId, p_message: attempt.text, p_message_id: attempt.id }));
    if (error) throw error;
    if (data?.id !== attempt.id || !Number.isFinite(Date.parse(data.created_at))) throw Error('The saved welcome could not be confirmed.');
    return data as { id: string; created_at: string };
  } catch (error) { const saved = await checkTopicWelcome(attempt, owner); if (saved) return saved; throw error; }
}
export function finishTopicWelcome(attempt: TopicWelcomeAttempt, owner: CommunityOperationScope) {
  const storageKey = key(attempt.topicId, attempt.eventId, owner);
  return serial(storageKey, async () => {
    current(owner);
    const state = await read(storageKey, attempt.topicId, attempt.eventId, owner);
    if (JSON.stringify(state.attempt) !== JSON.stringify(attempt)) throw Error('Your saved welcome changed.');
    const next = { text: state.text === attempt.text ? '' : state.text, attempt: null };
    try { await persist(storageKey, attempt.topicId, attempt.eventId, owner, next); current(owner); return next; }
    catch (error) { retained.set(storageKey, state); throw error; }
  });
}
