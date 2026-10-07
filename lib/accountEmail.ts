import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { ticketReadAuthorization } from './creatorTicketRead';
import { createAccountEmailApi } from './accountEmailContract';
export { AccountEmailFailure, type AccountEmailState, type AccountEmailScope } from './accountEmailContract';
export const accountEmail = createAccountEmailApi({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY,
 fetch: (input, init) => fetch(input, init), authorization: async scope => {
  const token = await ticketReadAuthorization(scope);
  if (!token) throw Error('Check your sign-in.');
  return token;
 }});
