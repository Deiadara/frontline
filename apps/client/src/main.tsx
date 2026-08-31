import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
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
