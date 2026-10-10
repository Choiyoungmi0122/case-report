import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CaseInputPage from './pages/CaseInputPage';
import CaseOverviewPage from './pages/CaseOverviewPage';
import SectionDetailPage from './pages/SectionDetailPage';
import ManuscriptPage from './pages/ManuscriptPage';
import ManuscriptReviewImportPage from './pages/ManuscriptReviewImportPage';
import ManuscriptReviewResultPage from './pages/ManuscriptReviewResultPage';
import ModeSelectPage from './pages/ModeSelectPage';
import ScaffoldEntryPage from './pages/ScaffoldEntryPage';
import ScaffoldOverviewPage from './pages/ScaffoldOverviewPage';
import ScaffoldSectionPage from './pages/ScaffoldSectionPage';
import ScaffoldSummaryPage from './pages/ScaffoldSummaryPage';
import StudyEntryPage from './pages/StudyEntryPage';
import ResearchHistoryPage from './pages/ResearchHistoryPage';
import StudyWriteInterviewPage from './pages/StudyWriteInterviewPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ModeSelectPage />} />
        <Route path="/write" element={<CaseInputPage mode="write" />} />
        <Route path="/scaffold" element={<ScaffoldEntryPage />} />
        <Route path="/study/write" element={<StudyEntryPage mode="write" />} />
        <Route path="/study/scaffold" element={<StudyEntryPage mode="scaffold" />} />
        <Route path="/study/write/input" element={<CaseInputPage mode="write" />} />
        <Route path="/study/scaffold/input" element={<CaseInputPage mode="scaffold" />} />
        <Route path="/study/write/cases/:caseId" element={<CaseOverviewPage studyMode />} />
        <Route path="/study/write/cases/:caseId/interview" element={<StudyWriteInterviewPage />} />
        <Route path="/study/write/cases/:caseId/sections/:sectionId" element={<SectionDetailPage studyMode />} />
        <Route path="/study/write/cases/:caseId/manuscript" element={<ManuscriptPage studyMode />} />
        <Route path="/study/scaffold/cases/:caseId" element={<ScaffoldOverviewPage studyMode />} />
        <Route
          path="/study/scaffold/cases/:caseId/sections/:sectionId"
          element={<ScaffoldSectionPage />}
        />
        <Route path="/study/scaffold/cases/:caseId/summary" element={<ScaffoldSummaryPage studyMode />} />
        <Route path="/research/history" element={<ResearchHistoryPage />} />
        <Route path="/scaffold/cases/:caseId" element={<ScaffoldOverviewPage />} />
        <Route path="/scaffold/cases/:caseId/sections/:sectionId" element={<ScaffoldSectionPage />} />
        <Route path="/scaffold/cases/:caseId/summary" element={<ScaffoldSummaryPage />} />
        <Route path="/manuscript-review" element={<ManuscriptReviewImportPage />} />
        <Route path="/manuscript-review/:reviewId" element={<ManuscriptReviewResultPage />} />
        <Route path="/cases/:caseId" element={<CaseOverviewPage />} />
        <Route path="/cases/:caseId/sections/:sectionId" element={<SectionDetailPage />} />
        <Route path="/cases/:caseId/manuscript" element={<ManuscriptPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
