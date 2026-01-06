import { useEffect, useCallback, useState, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeftIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import type {
  ChatRequest,
  ChatMessage,
  ProjectInfo,
  PermissionMode,
} from "../types";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useAbortController } from "../hooks/chat/useAbortController";
import { useAutoHistoryLoader } from "../hooks/useHistoryLoader";
import { useAutoApprovePermissions } from "../hooks/useSettings";
import { useWebSocketContext } from "../context/WebSocketContext";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { HistoryButton } from "./chat/HistoryButton";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { HistoryView } from "./HistoryView";
import { getProjectsUrl, createTaskUrl } from "../config/api";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);

  // Auto approve permissions setting
  const { autoApprovePermissions, toggleAutoApprovePermissions } =
    useAutoApprovePermissions();
  // Use ref to avoid stale closure in streaming context
  const autoApprovePermissionsRef = useRef(autoApprovePermissions);
  autoApprovePermissionsRef.current = autoApprovePermissions;

  // Task messages ref for WebSocket updates
  const taskMessagesRef = useRef<
    Array<{ type: string; data: unknown; timestamp: number }>
  >([]);
  // Track processed message timestamps to prevent duplicates
  const processedMessagesRef = useRef<Set<number>>(new Set());

  // Extract and normalize working directory from URL
  const workingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath) return undefined;

    // URL decode the path
    const decodedPath = decodeURIComponent(rawPath);

    // Normalize Windows paths (remove leading slash from /C:/... format)
    return normalizeWindowsPath(decodedPath);
  })();

  // Get current view and sessionId from query parameters
  const currentView = searchParams.get("view");
  const sessionId = searchParams.get("sessionId");
  const isHistoryView = currentView === "history";
  const isLoadedConversation = !!sessionId && !isHistoryView;

  const { abortRequest } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  // Convert working directory to Claude's internal encoding format
  // Claude uses '-' instead of '/' and other special chars in directory names
  const convertToClaudeFormat = useCallback((path: string): string => {
    return path.replace(/[/\\:._]/g, "-");
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

  // Load projects for additional metadata (encodedName fallback still works without this)
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

  // Derived state for encoded name - can compute immediately since getEncodedName
  // now handles both cases (projects list and direct computation)
  const encodedProjectName = getEncodedName();

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
    sessionId: loadedSessionId,
  } = useAutoHistoryLoader(encodedProjectName, sessionId);

  // Initialize chat state with loaded history
  // Use sessionId from URL when available, fall back to loadedSessionId after history loads
  // This ensures we preserve the sessionId from URL even before history is loaded
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
    // Use URL sessionId if available, otherwise use loadedSessionId after history loads
    // This prevents creating a new random sessionId during initial render
    initialSessionId: sessionId || loadedSessionId || undefined,
  });

  const {
    allowedTools,
    permissionRequest,
    closePermissionRequest,
    isPermissionMode,
    closePlanModeRequest,
    updatePermissionMode,
    planModeRequest,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
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
        const effectivePermissionMode = autoApprovePermissionsRef.current
          ? "bypassPermissions"
          : overridePermissionMode || permissionMode;

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
        setTaskStatus("running");
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
        setTaskStatus("aborted");
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
      sendMessage("continue", allowedTools, true, "bypassPermissions");
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    closePermissionRequest,
  ]);

  const handlePermissionAllowPermanent = useCallback(() => {
    if (!permissionRequest) return;

    closePermissionRequest();

    // Use bypassPermissions mode to truly approve the permission
    if (currentSessionId) {
      sendMessage("continue", allowedTools, true, "bypassPermissions");
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

  // Plan mode request handlers
  const handlePlanAcceptWithEdits = useCallback(() => {
    updatePermissionMode("acceptEdits");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "acceptEdits");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanAcceptDefault = useCallback(() => {
    updatePermissionMode("default");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "default");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanKeepPlanning = useCallback(() => {
    updatePermissionMode("plan");
    closePlanModeRequest();
  }, [updatePermissionMode, closePlanModeRequest]);

  // Create permission data for inline permission interface
  const permissionData = permissionRequest
    ? {
        patterns: permissionRequest.patterns,
        onAllow: handlePermissionAllow,
        onAllowPermanent: handlePermissionAllowPermanent,
        onDeny: handlePermissionDeny,
      }
    : undefined;

  // Create plan permission data for plan mode interface
  const planPermissionData = planModeRequest
    ? {
        onAcceptWithEdits: handlePlanAcceptWithEdits,
        onAcceptDefault: handlePlanAcceptDefault,
        onKeepPlanning: handlePlanKeepPlanning,
      }
    : undefined;

  const handleHistoryClick = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleSettingsClick = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleBackToChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const handleBackToHistory = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleBackToProjects = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUTS.ABORT && isLoading && currentRequestId) {
        e.preventDefault();
        handleAbort();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isLoading, currentRequestId, handleAbort]);

  // Update page title based on working directory and session
  useEffect(() => {
    const titleParts = [];
    if (workingDirectory) {
      titleParts.push(workingDirectory);
    }
    if (sessionId) {
      titleParts.push(`[${sessionId}]`);
    }
    document.title =
      titleParts.length > 0 ? titleParts.join(" - ") : "Claude Code Web UI";
  }, [workingDirectory, sessionId]);

  // Helper to extract text content from Claude SDK message
  const extractMessageContent = useCallback((data: unknown): string => {
    if (typeof data !== "object" || data === null) {
      return String(data);
    }

    const sdkData = data as Record<string, unknown>;

    // Check if this is a result message (has "result" field)
    if ("result" in sdkData) {
      const result = sdkData.result;
      if (typeof result === "string") {
        return result;
      }
      if (typeof result === "object" && result !== null) {
        return JSON.stringify(result, null, 2);
      }
      return String(result);
    }

    // For assistant type messages, look for message.content
    if ("message" in sdkData && sdkData.message) {
      const messageObj = sdkData.message;
      if (typeof messageObj === "object") {
        const message = messageObj as Record<string, unknown>;
        if ("content" in message && Array.isArray(message.content)) {
          const content = message.content as Array<{
            type: string;
            text?: string;
            thinking?: string;
          }>;
          const textParts: string[] = [];
          for (const block of content) {
            if (block.type === "text" && block.text) {
              textParts.push(block.text);
            } else if (block.type === "thinking" && block.thinking) {
              textParts.push(`[Thinking] ${block.thinking}`);
            }
          }
          if (textParts.length > 0) {
            return textParts.join("\n");
          }
        }
      }
    }

    return JSON.stringify(data, null, 2);
  }, []);

  // WebSocket callback handlers - wrapped in useCallback to prevent re-connections
  const handleWebSocketMessage = useCallback(
    (message: {
      type: string;
      taskId: string;
      data: unknown;
      timestamp: number;
    }) => {
      // Only handle task messages for the current task
      if (message.type === "task_message" && message.taskId === currentTaskId) {
        // Skip duplicate messages
        if (processedMessagesRef.current.has(message.timestamp)) {
          console.log(
            `[WebSocket] Skipping duplicate message with timestamp: ${message.timestamp}`,
          );
          return;
        }
        processedMessagesRef.current.add(message.timestamp);

        taskMessagesRef.current.push({
          type: message.type,
          data: message.data,
          timestamp: message.timestamp,
        });

        // Only add to chat if it's a result or assistant message
        const content = extractMessageContent(message.data);
        if (content && content.trim()) {
          addMessage({
            type: "chat",
            role: "assistant",
            content: content.trim(),
            timestamp: message.timestamp,
          });
        }
      }
    },
    [addMessage, extractMessageContent, currentTaskId],
  );

  // Use global WebSocket connection from context
  const {
    isConnected: wsConnected,
    subscribeToSession,
    subscribeToTask,
    onTaskMessage,
  } = useWebSocketContext();

  // Set up task message handler when session changes
  useEffect(() => {
    if (currentSessionId) {
      subscribeToSession(currentSessionId);
    }
  }, [currentSessionId, subscribeToSession]);

  // Register task message callback
  useEffect(() => {
    if (currentSessionId) {
      onTaskMessage(handleWebSocketMessage);
    }
  }, [currentSessionId, handleWebSocketMessage, onTaskMessage]);

  // Subscribe to new task when currentTaskId changes
  useEffect(() => {
    if (currentTaskId && wsConnected) {
      subscribeToTask(currentTaskId);
    }
  }, [currentTaskId, wsConnected, subscribeToTask]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-6xl mx-auto p-3 sm:p-6 h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
          <div className="flex items-center gap-4">
            {isHistoryView && (
              <button
                onClick={handleBackToChat}
                className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
                aria-label="Back to chat"
              >
                <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            )}
            {isLoadedConversation && (
              <button
                onClick={handleBackToHistory}
                className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
                aria-label="Back to history"
              >
                <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            )}
            <div>
              <nav aria-label="Breadcrumb">
                <div className="flex items-center">
                  <button
                    onClick={handleBackToProjects}
                    className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-md px-1 -mx-1"
                    aria-label="Back to project selection"
                  >
                    {workingDirectory ? (
                      <span className="font-mono text-sm">
                        {workingDirectory}
                      </span>
                    ) : (
                      "Claude Code Web UI"
                    )}
                  </button>
                </div>
              </nav>
              {sessionId && (
                <div className="flex items-center text-sm font-mono mt-1">
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    Session: {sessionId}
                  </span>
                  {currentTaskId && taskStatus && (
                    <span className="ml-3 flex items-center">
                      <span
                        className={`w-2 h-2 rounded-full mr-1.5 ${
                          taskStatus === "running"
                            ? "bg-green-500 animate-pulse"
                            : taskStatus === "pending"
                              ? "bg-yellow-500"
                              : taskStatus === "completed"
                                ? "bg-blue-500"
                                : taskStatus === "failed"
                                  ? "bg-red-500"
                                  : "bg-gray-500"
                        }`}
                      ></span>
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        Task: {taskStatus}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isHistoryView && <HistoryButton onClick={handleHistoryClick} />}
            {/* Auto Approve Permissions Toggle */}
            <button
              onClick={toggleAutoApprovePermissions}
              className={`p-2 rounded-lg border transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md ${
                autoApprovePermissions
                  ? "bg-green-50/80 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                  : "bg-white/80 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              }`}
              role="switch"
              aria-checked={autoApprovePermissions}
              aria-label={`Auto approve permissions. Currently ${autoApprovePermissions ? "enabled" : "disabled"}. Click to toggle.`}
              title={
                autoApprovePermissions
                  ? "Auto approve enabled - click to disable"
                  : "Auto approve disabled - click to enable"
              }
            >
              <ShieldCheckIcon
                className={`w-5 h-5 ${
                  autoApprovePermissions
                    ? "text-green-600 dark:text-green-400"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              />
            </button>
            <SettingsButton onClick={handleSettingsClick} />
          </div>
        </div>

        {/* Main Content */}
        {isHistoryView ? (
          <HistoryView
            workingDirectory={workingDirectory || ""}
            encodedName={encodedProjectName || getEncodedName()}
            onBack={handleBackToChat}
          />
        ) : historyLoading ? (
          /* Loading conversation history */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400">
                Loading conversation history...
              </p>
            </div>
          </div>
        ) : historyError ? (
          /* Error loading conversation history */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                Error Loading Conversation
              </h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
                {historyError}
              </p>
              <button
                onClick={() => navigate({ search: "" })}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Start New Conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Messages */}
            <ChatMessages messages={messages} isLoading={isLoading} />

            {/* Session Selection Prompt - Show when messages exist but no session selected */}
            {!sessionId && messages.length > 0 && (
              <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                  💡 对话已保存。点击右上角
                  <button
                    onClick={handleHistoryClick}
                    className="mx-1 font-medium hover:underline text-blue-600 dark:text-blue-400"
                  >
                    "历史记录"
                  </button>
                  选择会话继续对话
                </p>
              </div>
            )}

            {/* Input */}
            <ChatInput
              input={input}
              isLoading={isLoading}
              currentRequestId={currentRequestId}
              onInputChange={setInput}
              onSubmit={() => sendMessage()}
              onAbort={handleAbort}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              showPermissions={isPermissionMode}
              permissionData={permissionData}
              planPermissionData={planPermissionData}
            />
          </>
        )}

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>
    </div>
  );
}
