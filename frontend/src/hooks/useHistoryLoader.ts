import { useState, useEffect, useCallback } from "react";
import type { AllMessage, TimestampedSDKMessage } from "../types";
import type { ConversationHistory } from "../../../shared/types";
import { API_CONFIG, getConversationUrl } from "../config/api";
import { useMessageConverter } from "./useMessageConverter";

interface HistoryLoaderState {
  messages: AllMessage[];
  loading: boolean;
  error: string | null;
  sessionId: string | null;
}

interface HistoryLoaderResult extends HistoryLoaderState {
  loadHistory: (projectPath: string, sessionId: string) => Promise<void>;
  clearHistory: () => void;
}

// Type guard to check if a message is a TimestampedSDKMessage
function isTimestampedSDKMessage(
  message: unknown,
): message is TimestampedSDKMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "timestamp" in message &&
    typeof (message as { timestamp: unknown }).timestamp === "string"
  );
}

/**
 * Hook for loading and converting conversation history from the backend
 */
export function useHistoryLoader(): HistoryLoaderResult {
  const [state, setState] = useState<HistoryLoaderState>({
    messages: [],
    loading: false,
    error: null,
    sessionId: null,
  });

  const { convertConversationHistory } = useMessageConverter();

  const loadHistory = useCallback(
    async (encodedProjectName: string, sessionId: string) => {
      if (!encodedProjectName || !sessionId) {
        setState((prev) => ({
          ...prev,
          error: "Encoded project name and session ID are required",
        }));
        return;
      }

      try {
        setState((prev) => ({
          ...prev,
          loading: true,
          error: null,
        }));

        const response = await fetch(
          getConversationUrl(encodedProjectName, sessionId),
        );

        if (!response.ok) {
          throw new Error(
            `Failed to load conversation: ${response.status} ${response.statusText}`,
          );
        }

        const conversationHistory: ConversationHistory = await response.json();

        // Validate the response structure
        if (
          !conversationHistory.messages ||
          !Array.isArray(conversationHistory.messages)
        ) {
          throw new Error("Invalid conversation history format");
        }

        // Convert unknown[] to TimestampedSDKMessage[] with type checking
        const timestampedMessages: TimestampedSDKMessage[] = [];
        for (const msg of conversationHistory.messages) {
          if (isTimestampedSDKMessage(msg)) {
            timestampedMessages.push(msg);
          } else {
            console.warn("Skipping invalid message in history:", msg);
          }
        }

        // Convert to frontend message format
        const convertedMessages =
          convertConversationHistory(timestampedMessages);

        setState((prev) => ({
          ...prev,
          messages: convertedMessages,
          loading: false,
          sessionId: conversationHistory.sessionId,
        }));
      } catch (error) {
        console.error("Error loading conversation history:", error);

        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load conversation history",
        }));
      }
    },
    [convertConversationHistory],
  );

  const clearHistory = useCallback(() => {
    setState({
      messages: [],
      loading: false,
      error: null,
      sessionId: null,
    });
  }, []);

  return {
    ...state,
    loadHistory,
    clearHistory,
  };
}

/**
 * Hook for loading conversation history on mount when sessionId is provided
 * If no sessionId is provided, automatically loads the most recent conversation
 */
export function useAutoHistoryLoader(
  encodedProjectName?: string | null,
  sessionId?: string | null,
): HistoryLoaderResult {
  const historyLoader = useHistoryLoader();

  // Convert URL-encoded project name to Claude's internal encoding format
  // Claude uses '-' instead of '/' and other special chars in directory names
  const convertToClaudeFormat = (urlEncoded: string): string => {
    // First decode URL encoding
    const decoded = decodeURIComponent(urlEncoded);
    // Then replace leading / and other special chars with -
    return decoded.replace(/^\//, "-").replace(/[/\\:._]/g, "-");
  };

  // Auto-load most recent conversation when no sessionId is provided
  useEffect(() => {
    if (!encodedProjectName) {
      // If no encodedProjectName yet, clear history and wait
      historyLoader.clearHistory();
      return;
    }

    // Convert to Claude's internal format for API call
    const claudeFormatName = convertToClaudeFormat(encodedProjectName);

    if (sessionId) {
      // If sessionId is provided, load that specific conversation
      historyLoader.loadHistory(claudeFormatName, sessionId);
    } else {
      // Fetch latest conversation
      // If no sessionId, fetch the conversation list and load the most recent one
      const fetchLatestConversation = async () => {
        try {
          // Use the Claude format name for the API
          const response = await fetch(
            `${API_CONFIG.ENDPOINTS.HISTORIES}/${claudeFormatName}/histories`,
          );
          if (response.ok) {
            const data = await response.json();
            if (data.conversations && data.conversations.length > 0) {
              // Sort by lastTime descending (most recently active first)
              // Note: lastTime can be ISO string or timestamp
              // Put conversations without lastTime at the end
              const sortedConversations = [...data.conversations].sort(
                (a, b) => {
                  const timeA =
                    typeof a.lastTime === "number"
                      ? a.lastTime
                      : a.lastTime
                        ? new Date(a.lastTime).getTime()
                        : 0;
                  const timeB =
                    typeof b.lastTime === "number"
                      ? b.lastTime
                      : b.lastTime
                        ? new Date(b.lastTime).getTime()
                        : 0;
                  return timeB - timeA;
                },
              );
              // Find first conversation with actual messages (has lastTime and messageCount > 0)
              const latestConversation =
                sortedConversations.find(
                  (c) => c.lastTime && c.messageCount > 0,
                ) || sortedConversations[0];
              await historyLoader.loadHistory(
                claudeFormatName,
                latestConversation.sessionId,
              );
            } else {
              historyLoader.clearHistory();
            }
          } else {
            historyLoader.clearHistory();
          }
        } catch (error) {
          console.error("Error fetching latest conversation:", error);
          historyLoader.clearHistory();
        }
      };

      // Small delay to ensure projects are loaded
      const timer = setTimeout(fetchLatestConversation, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedProjectName, sessionId]);

  return historyLoader;
}
