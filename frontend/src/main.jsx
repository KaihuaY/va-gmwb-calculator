import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import App, { PRODUCT_PRESETS, encodeParamsToHash } from './App';
import LandingPage from './pages/LandingPage';
import ProductPage from './pages/ProductPage';
import RatingsIndex from './pages/RatingsIndex';
import RatingDetail from './pages/RatingDetail';
import MethodologyPage from './pages/MethodologyPage';
import './index.css';

// Clean-URL preset loader: /calculator/jackson → /calculator#p=<hash>
// Works for any id in PRODUCT_PRESETS; unknown ids fall through to a bare calculator.
function PresetRedirect() {
  const { presetId } = useParams();
  const preset = PRODUCT_PRESETS.find(p => p.id === presetId);
  const hash = preset ? encodeParamsToHash(preset.params) : '';
  return <Navigate to={`/calculator${hash}`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/calculator" element={<App />} />
        {/* Short preset URL: /calculator/jackson, /calculator/equitable, etc. */}
        <Route path="/calculator/:presetId" element={<PresetRedirect />} />
        {/* Ratings — public publication */}
        <Route path="/ratings" element={<RatingsIndex />} />
        <Route path="/ratings/:slug" element={<RatingDetail />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        {/* SEO product pages — each pre-loads the matching preset via hash */}
        <Route path="/jackson-national-gmwb-calculator" element={<ProductPage productId="jackson" />} />
        <Route path="/equitable-gmwb-calculator" element={<ProductPage productId="equitable" />} />
        <Route path="/tiaa-cref-glwb-calculator" element={<ProductPage productId="tiaa" />} />
        <Route path="/nationwide-lifetime-income-calculator" element={<ProductPage productId="nationwide" />} />
        <Route path="/lincoln-choiceplus-gmwb-calculator" element={<ProductPage productId="lincoln" />} />
        <Route path="/allianz-index-advantage-income-calculator" element={<ProductPage productId="allianz" />} />
        {/* Redirect any unknown path to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
