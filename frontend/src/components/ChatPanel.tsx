import { useEffect, useCallback, useState, useRef } from "react";
import type { ChatRequest, ChatMessage, ProjectInfo } from "../types";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useAbortController } from "../hooks/chat/useAbortController";
import { useAutoHistoryLoader } from "../hooks/useHistoryLoader";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { getProjectsUrl, createTaskUrl } from "../config/api";
import { normalizeWindowsPath } from "../utils/pathUtils";

interface ChatPanelProps {
  projectPath: string | null;
  sessionId?: string | null;
}

export function ChatPanel({ projectPath, sessionId }: ChatPanelProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Task messages ref for WebSocket updates
  const taskMessagesRef = useRef<
    Array<{ type: string; data: unknown; timestamp: number }>
  >([]);
  // Track processed message timestamps to prevent duplicates
  const processedMessagesRef = useRef<Set<number>>(new Set());

  // Working directory from project path
  const workingDirectory = projectPath || undefined;

  // Convert working directory to Claude's internal encoding format
  const convertToClaudeFormat = useCallback((path: string): string => {
    // Leading / becomes - first, then all special chars become -
    return path.replace(/^\//, "-").replace(/[/\\:._]/g, "-");
  }, []);

  // Get encoded name for current working directory
  const getEncodedName = useCallback(() => {
    if (!workingDirectory) {
      return null;
    }

    // First try to find in projects list
    if (projects.length > 0) {
      const project = projects.find((p) => p.path === workingDirectory);

      // Normalize paths for comparison (handle Windows path issues)
      const normalizedWorking = normalizeWindowsPath(workingDirectory);
      const normalizedProject = projects.find(
        (p) => normalizeWindowsPath(p.path) === normalizedWorking,
      );

      // Use normalized result if exact match fails
      const finalProject = project || normalizedProject;

      if (finalProject?.encodedName) {
        return finalProject.encodedName;
      }
    }

    // If not found in projects list, compute from working directory directly
    return convertToClaudeFormat(workingDirectory);
  }, [workingDirectory, projects, convertToClaudeFormat]);

  // Load projects for additional metadata
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await fetch(getProjectsUrl());
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (error) {
        console.error("Failed to load projects:", error);
      }
    };
    loadProjects();
  }, []);

  const encodedProjectName = getEncodedName();

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
    sessionId: loadedSessionId,
  } = useAutoHistoryLoader(encodedProjectName, sessionId);

  // Initialize chat state with loaded history
  const {
    messages,
    input,
    isLoading,
    currentSessionId,
    currentRequestId,
    setInput,
    addMessage,
    clearInput,
    generateRequestId,
    resetRequestState,
    startRequest,
  } = useChatState({
    initialMessages: historyMessages,
    initialSessionId: sessionId || loadedSessionId || undefined,
  });

  const { abortRequest } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  const {
    allowedTools,
    permissionRequest,
    closePermissionRequest,
    closePlanModeRequest,
    planModeRequest,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
    ) => {
      const content = messageContent || input.trim();
      if (!content || isLoading) return;

      const requestId = generateRequestId();

      // Only add user message to chat if not hidden
      if (!hideUserMessage) {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: content,
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      if (!messageContent) clearInput();
      startRequest();

      // Always use background task mode with WebSocket for real-time updates
      try {
        // Always bypass permissions for smoother experience
        const effectivePermissionMode = "bypassPermissions";

        const response = await fetch(createTaskUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            requestId,
            ...(currentSessionId ? { sessionId: currentSessionId } : {}),
            allowedTools: tools || allowedTools,
            ...(workingDirectory ? { workingDirectory } : {}),
            permissionMode: effectivePermissionMode,
          } as ChatRequest),
        });

        if (!response.ok) {
          throw new Error("Failed to create task");
        }

        const task = await response.json();

        // Set up task with WebSocket
        setCurrentTaskId(task.taskId);
        taskMessagesRef.current = [];
        processedMessagesRef.current.clear();

        // Add initial task creation message
        addMessage({
          type: "chat",
          role: "assistant",
          content: `Running task... (ID: ${task.taskId.substring(0, 8)})`,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("Failed to start task:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "Error: Failed to start task",
          timestamp: Date.now(),
        });
        resetRequestState();
      }
    },
    [
      input,
      isLoading,
      currentSessionId,
      allowedTools,
      workingDirectory,
      permissionMode,
      generateRequestId,
      clearInput,
      startRequest,
      addMessage,
      resetRequestState,
    ],
  );

  const handleAbort = useCallback(async () => {
    if (currentTaskId) {
      // Abort background task
      try {
        await fetch(`/api/tasks/${currentTaskId}/abort`, {
          method: "POST",
        });
        setCurrentTaskId(null);
        resetRequestState();
      } catch (error) {
        console.error("Failed to abort task:", error);
      }
    } else {
      abortRequest(currentRequestId, isLoading, resetRequestState);
    }
  }, [
    abortRequest,
    currentRequestId,
    isLoading,
    resetRequestState,
    currentTaskId,
  ]);

  // Permission request handlers
  const handlePermissionAllow = useCallback(() => {
    if (!permissionRequest) return;

    closePermissionRequest();

    // Use bypassPermissions mode to truly approve the permission
    if (currentSessionId) {
      sendMessage("continue", allowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    closePermissionRequest,
  ]);

  const handlePermissionDeny = useCallback(() => {
    closePermissionRequest();
  }, [closePermissionRequest]);

  // No project selected - show placeholder
  if (!projectPath) {
    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex items-center justify-center h-full max-w-4xl w-full mx-auto">
        <div className="text-slate-500 dark:text-slate-400 text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <p className="text-lg">Select a project to start chatting</p>
        </div>
      </div>
    );
  }

  // History loading state
  if (historyLoading) {
    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex items-center justify-center h-full max-w-4xl w-full mx-auto">
        <div className="text-slate-500 dark:text-slate-400">
          Loading conversation...
        </div>
      </div>
    );
  }

  // History error state
  if (historyError) {
    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex items-center justify-center h-full max-w-4xl w-full mx-auto">
        <div className="text-red-500 dark:text-red-400">
          Error: {historyError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-900 max-w-4xl w-full mx-auto">
      {/* Header */}
      <div className="px-6 py-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {projectPath.split("/").pop() || projectPath}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
              {projectPath}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentSessionId && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Session: {currentSessionId}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto">
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          taskMessages={taskMessagesRef.current}
          processedMessages={processedMessagesRef.current}
        />
      </div>

      {/* Chat Input */}
      <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <ChatInput
          input={input}
          isLoading={isLoading}
          onInputChange={setInput}
          onSubmit={sendMessage}
          onAbort={handleAbort}
          currentRequestId={currentRequestId}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          showPermissions={!!permissionRequest}
          permissionData={
            permissionRequest
              ? {
                  patterns: permissionRequest.patterns,
                  onAllow: handlePermissionAllow,
                  onAllowPermanent: handlePermissionAllow,
                  onDeny: handlePermissionDeny,
                }
              : undefined
          }
          planPermissionData={
            planModeRequest
              ? {
                  onAcceptWithEdits: () => {
                    closePlanModeRequest();
                    sendMessage("continue", allowedTools, true);
                  },
                  onAcceptDefault: () => {
                    closePlanModeRequest();
                    sendMessage("continue", allowedTools, true);
                  },
                  onKeepPlanning: () => closePlanModeRequest(),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
