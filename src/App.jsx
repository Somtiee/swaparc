import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout.jsx";
import DocsLayout from "./layouts/DocsLayout.jsx";
import DocsArticlePage from "./pages/DocsArticlePage.jsx";
import { DEFAULT_DOC_PAGE_ID } from "./docsPreviewCatalog";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<Navigate to={DEFAULT_DOC_PAGE_ID} replace />} />
          <Route path=":pageId" element={<DocsArticlePage />} />
        </Route>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
