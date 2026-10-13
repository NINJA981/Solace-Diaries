import type { ComponentType } from 'react';
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from './RootLayout';
import LandingPage from '@/features/landing/LandingPage';
import NotFound from './NotFound';
import { RouteError } from './RouteError';
import { appPages } from './pages';

/** Route metadata read by RootLayout for document titles. */
export type RouteHandle = { title?: string };

type Loader = () => Promise<{ default: ComponentType }>;
/** Route-level code splitting: each page is its own chunk. */
const page = (load: Loader): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
});

export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    ErrorBoundary: RouteError,
    children: [
      {
        ErrorBoundary: RouteError,
        children: [
          // The landing page ships in the entry chunk: it's the first impression, so no extra round trip.
          { index: true, Component: LandingPage, handle: { title: '' } },
          { path: 'privacy', ...page(() => import('@/features/landing/PrivacyPage')), handle: { title: 'Privacy' } },
          { path: 'terms', ...page(() => import('@/features/landing/TermsPage')), handle: { title: 'Terms' } },
          { path: 'login', ...page(() => import('@/features/auth/LoginPage')), handle: { title: 'Sign in' } },
          { path: 'signup', ...page(() => import('@/features/auth/SignupPage')), handle: { title: 'Create your journal' } },
          { path: 'reset', ...page(() => import('@/features/auth/ResetRequestPage')), handle: { title: 'Reset password' } },
          { path: 'reset/update', ...page(() => import('@/features/auth/ResetUpdatePage')), handle: { title: 'Choose a new password' } },
          { path: 'auth/callback', ...page(() => import('@/features/auth/AuthCallbackPage')), handle: { title: 'Signing you in' } },
          { path: 'onboarding', ...page(() => import('@/features/onboarding/OnboardingPage')), handle: { title: 'Welcome' } },
          {
            path: 'app',
            ...page(() => import('@/components/layout/AppShell')),
            children: [
              {
                ErrorBoundary: RouteError,
                children: [
                  { index: true, element: <Navigate to="today" replace /> },
                  { path: 'today', ...page(appPages.today), handle: { title: 'Today' } },
                  { path: 'entries/:id', ...page(appPages.entry), handle: { title: 'Entry' } },
                  { path: 'journal', ...page(appPages.journal), handle: { title: 'Journal' } },
                  { path: 'reflect', ...page(appPages.reflect), handle: { title: 'Reflect' } },
                  { path: 'reflect/:threadId', ...page(appPages.reflect), handle: { title: 'Reflect' } },
                  { path: 'insights', ...page(appPages.insights), handle: { title: 'Insights' } },
                  { path: 'settings', ...page(appPages.settings), handle: { title: 'Settings' } },
                  { path: '*', Component: NotFound, handle: { title: 'Not found' } },
                ],
              },
            ],
          },
          { path: '*', Component: NotFound, handle: { title: 'Not found' } },
        ],
      },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
