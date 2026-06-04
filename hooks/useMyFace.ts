import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * The current user's own display face (name + photo) for the left side of
 * the "you & [name]" hero. Separate from useAuthProfile, which fetches the
 * auth-routing columns (onboarding/referral/phone), not the display pair.
 */
export interface MyFace {
  first_name_display: string | null;
  profile_photo_url: string | null;
}

export function useMyFace(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['yours', 'my-face', userId ?? ''],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MyFace | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name_display, profile_photo_url')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return (data as MyFace) ?? null;
    },
  });
}
