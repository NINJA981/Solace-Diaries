import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/toast';
import { SessionProvider } from '@/lib/session';
import { createQueryClient } from './queryClient';
import { createRouter } from './router';

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
          <Toaster />
        </MotionConfig>
      </SessionProvider>
    </QueryClientProvider>
  );
}
