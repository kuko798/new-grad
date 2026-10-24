import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import { StoreProvider } from './state/store.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { OnboardingPage } from './pages/OnboardingPage.tsx';
import { NotFound } from './pages/NotFound.tsx';

const ResultsPage = lazy(() => import('./pages/ResultsPage.tsx'));
const NeighborhoodPage = lazy(() => import('./pages/NeighborhoodPage.tsx'));
const ComparePage = lazy(() => import('./pages/ComparePage.tsx'));
const SavedPage = lazy(() => import('./pages/SavedPage.tsx'));
const DataPage = lazy(() => import('./pages/DataPage.tsx'));

function PageLoading() {
  return (
    <div className="page" aria-busy="true">
      <div className="skeleton" style={{ width: 240, height: 30 }} />
      <div className="skeleton" style={{ width: 420, maxWidth: '100%', height: 20, marginTop: 12 }} />
    </div>
  );
}

/** Moves focus to the main region on navigation so keyboard and screen-reader users land on the new page. */
function FocusOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.getElementById('main');
    if (main && document.activeElement !== document.body) main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <FocusOnNavigate />
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="start" element={<OnboardingPage />} />
              <Route path="compare" element={<ComparePage />} />
              <Route path="saved" element={<SavedPage />} />
              <Route path="data" element={<DataPage />} />
              <Route path=":city" element={<ResultsPage />} />
              <Route path=":city/n/:id" element={<NeighborhoodPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </StoreProvider>
  );
}
