import { QueryClient } from '@tanstack/react-query';

// Single app-wide React Query client. Lives in its own module (rather than
// being created inline in app/_layout.tsx) so non-React code — e.g. the
// background album upload worker in lib/uploadAlbumMedia.ts — can invalidate
// the same cache the QueryClientProvider serves. This is the exact same
// instance/behavior as before; only its definition site moved.
export const queryClient = new QueryClient();
