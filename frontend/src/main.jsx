import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import LandingPage from './pages/LandingPage';
import ProductPage from './pages/ProductPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/calculator" element={<App />} />
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
