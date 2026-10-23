import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/toast';
import { MotionProvider } from '@/lib/motion/provider';
import { SessionProvider } from '@/lib/session';
import { useDeviceWorld } from '@/lib/theme';
import { activateWorld } from '@/worlds';
import { createQueryClient } from './queryClient';
import { createRouter } from './router';

/** Whenever the world changes (here, in another tab, or from the profile), load what it needs. */
function WorldEffects() {
  const world = useDeviceWorld();
  useEffect(() => activateWorld(world), [world]);
  return null;
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MotionProvider>
          <WorldEffects />
          <RouterProvider router={router} />
          <Toaster />
        </MotionProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
