import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CaseInputPage from './pages/CaseInputPage';
import CaseOverviewPage from './pages/CaseOverviewPage';
import SectionDetailPage from './pages/SectionDetailPage';
import ManuscriptPage from './pages/ManuscriptPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CaseInputPage />} />
        <Route path="/cases/:caseId" element={<CaseOverviewPage />} />
        <Route path="/cases/:caseId/sections/:sectionId" element={<SectionDetailPage />} />
        <Route path="/cases/:caseId/manuscript" element={<ManuscriptPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
