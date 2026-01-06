import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ConversationSummary } from "../types";
import { getHistoriesUrl } from "../config/api";

interface HistoryListProps {
  projectPath: string | null;
  onConversationSelect?: (sessionId: string) => void;
}

export function HistoryList({
  projectPath,
  onConversationSelect,
}: HistoryListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const currentSessionId = searchParams.get("sessionId");

  // Load conversations when project changes
  useEffect(() => {
    if (projectPath) {
      loadConversations(projectPath);
    } else {
      setConversations([]);
    }
  }, [projectPath]);

  const loadConversations = async (path: string) => {
    try {
      setLoading(true);
      setError(null);

      // Convert path to Claude format for API (leading / becomes -)
      const encodedName = path.replace(/^\//, "-").replace(/[/\\:._]/g, "-");
      const url = getHistoriesUrl(encodedName);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load histories: ${response.statusText}`);
      }

      const data = await response.json();
      const conversationsData = data.conversations || [];

      // Sort by lastTime descending (newest first)
      const sorted = [...conversationsData].sort(
        (a: ConversationSummary, b: ConversationSummary) =>
          new Date(b.lastTime || 0).getTime() -
          new Date(a.lastTime || 0).getTime(),
      );

      setConversations(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load histories");
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleConversationSelect = useCallback(
    (sessionId: string) => {
      // Update URL with sessionId
      const params = new URLSearchParams(searchParams);
      params.set("sessionId", sessionId);
      navigate(`/?${params.toString()}`);

      onConversationSelect?.(sessionId);
    },
    [navigate, searchParams, onConversationSelect],
  );

  // No project selected
  if (!projectPath) {
    return (
      <div className="w-72 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-slate-500 dark:text-slate-400 text-sm text-center px-4">
          Select a project to view history
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="w-72 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-slate-500 dark:text-slate-400 text-sm">
          Loading history...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="w-72 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-red-500 dark:text-red-400 text-sm text-center px-4">
          {error}
        </div>
      </div>
    );
  }

  // Empty state
  if (conversations.length === 0) {
    return (
      <div className="w-72 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-slate-500 dark:text-slate-400 text-sm text-center px-4">
          No conversations yet
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-slate-800 dark:text-slate-100 font-medium text-sm">
          History
        </h3>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conversation) => {
          const isSelected = currentSessionId === conversation.sessionId;
          const lastMessagePreviewText =
            conversation.lastMessagePreview?.slice(0, 30) ||
            "No message preview";
          const lastTime = conversation.lastTime
            ? new Date(conversation.lastTime).toLocaleDateString()
            : "";

          return (
            <button
              key={conversation.sessionId}
              onClick={() => handleConversationSelect(conversation.sessionId)}
              className={`w-full text-left p-3 border-b border-slate-100 dark:border-slate-700 transition-colors ${
                isSelected
                  ? "bg-blue-50 dark:bg-blue-900/20"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-mono">
                  {conversation.sessionId}
                </span>
                {lastTime && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {lastTime}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200 truncate">
                {lastMessagePreviewText}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
