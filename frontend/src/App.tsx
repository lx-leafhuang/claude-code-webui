import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import { SettingsProvider } from "./contexts/SettingsContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { MainLayout } from "./components/MainLayout";
import { isDevelopment } from "./utils/environment";

// Lazy load DemoPage only in development
const DemoPage = isDevelopment()
  ? lazy(() =>
      import("./components/DemoPage").then((module) => ({
        default: module.DemoPage,
      })),
    )
  : null;

function App() {
  return (
    <SettingsProvider>
      <WebSocketProvider>
        <Router>
          <Routes>
            <Route path="/" element={<MainLayout />} />
            {DemoPage && (
              <Route
                path="/demo"
                element={
                  <Suspense fallback={<div>Loading demo...</div>}>
                    <DemoPage />
                  </Suspense>
                }
              />
            )}
          </Routes>
        </Router>
      </WebSocketProvider>
    </SettingsProvider>
  );
}

export default App;
