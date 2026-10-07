import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { ticketReadAuthorization } from './creatorTicketRead';
import { createMembershipRequestsApi, createMembershipDecisionStore } from './pageMembershipRequests';
export const membershipRequests = createMembershipRequestsApi(async (name, args, scope) => {
  const authorization = await ticketReadAuthorization(scope);
  const result = await supabase.rpc(name, args).setHeader('Authorization', authorization!);
  if (!scope.isCurrent()) throw Error('This page visit has changed.');
  if (result.error) throw result.error;
  return result.data;
});
export const membershipDecisionStore = createMembershipDecisionStore(AsyncStorage);
