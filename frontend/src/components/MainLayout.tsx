import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProjectTree } from "./ProjectTree";
import { ChatPanel } from "./ChatPanel";
import { HistoryList } from "./HistoryList";
import { SettingsModal } from "./SettingsModal";

export function MainLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Get current state from URL
  const projectPath = searchParams.get("project");
  const sessionId = searchParams.get("sessionId");

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      {/* Left: Project Tree (w-64, fixed) */}
      <ProjectTree
        onProjectSelect={() => {
          // When project is selected, we don't set sessionId here
          // HistoryList will load the first conversation automatically
        }}
      />

      {/* Middle: History List (w-72, fixed, only show when project selected) */}
      <HistoryList
        projectPath={projectPath}
        onConversationSelect={(sessionId) => {
          // Update URL with sessionId
          const params = new URLSearchParams(searchParams);
          params.set("sessionId", sessionId);
          setSearchParams(params);
        }}
      />

      {/* Right: Chat Panel (flex-1, max-w-4xl) */}
      <ChatPanel projectPath={projectPath} sessionId={sessionId} />

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
    </div>
  );
}
