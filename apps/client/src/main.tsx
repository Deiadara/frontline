import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { onSessionEnd } from './store/session';
import './fonts.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      /*
       * On, and it was off.
       *
       * This is a game other people are playing while this tab is in the background. Coming back to
       * it after ten minutes on something else and being shown the ten-minute-old board is the
       * single most misleading state the client can be in, because it is indistinguishable from a
       * board where nothing happened. React Query refetches only what a mounted screen is actually
       * using, and `staleTime` still keeps a tab-flick from refetching anything.
       */
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
});

/*
 * A session ending takes the previous account's data with it.
 *
 * Registered here rather than inside the store because the store is imported by `api.ts` and so by
 * every query in the app: importing the query client from there would close an import cycle. This
 * is the one place that already owns both.
 */
onSessionEnd(() => queryClient.clear());

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
