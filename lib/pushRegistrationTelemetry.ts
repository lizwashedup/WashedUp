import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type PushRegistrationStage =
  | 'identity_ready'
  | 'permission_observed'
  | 'provisional_requested'
  | 'provisional_granted'
  | 'prompt_requested'
  | 'registered'
  | 'failed';

export type PushPermissionTelemetry =
  | 'not_determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'unknown';

// Keep each account's stages in observed order. Supabase requests resolve
// independently; without this queue, a slower identity_ready write could land
// after registered and make the diagnostic row look as though setup regressed.
const accountWrites = new Map<string, Promise<void>>();

export function recordPushRegistrationState(
  userId: string,
  stage: PushRegistrationStage,
  permissionStatus: PushPermissionTelemetry = 'unknown',
  errorCode?: string | null,
): void {
  if (!userId || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  const updateId = typeof Updates.updateId === 'string' ? Updates.updateId : null;
  const runtimeVersion = typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion : null;
  const previous = accountWrites.get(userId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    await supabase.rpc('record_push_registration_state', {
      p_user_id: userId,
      p_platform: Platform.OS,
      p_stage: stage,
      p_permission_status: permissionStatus,
      p_app_version: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? null,
      p_build_number: Constants.nativeBuildVersion ?? null,
      p_update_id: updateId,
      p_runtime_version: runtimeVersion,
      p_error_code: errorCode?.slice(0, 120) ?? null,
    });
  });
  accountWrites.set(userId, write);
  void write.finally(() => {
    if (accountWrites.get(userId) === write) accountWrites.delete(userId);
  }).catch(() => undefined);
}
