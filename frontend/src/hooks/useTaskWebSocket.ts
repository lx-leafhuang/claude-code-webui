import { useEffect, useRef, useState, useCallback } from "react";

interface WebSocketMessage {
  type: string;
  taskId: string;
  data: unknown;
  timestamp: number;
}

interface UseWebSocketOptions {
  sessionId: string | null;
  onMessage: (message: WebSocketMessage) => void;
  onComplete?: (data: { status: string; output: string }) => void;
  onError?: (error: Event | Error) => void;
  onClose?: (event: CloseEvent) => void;
}

/**
 * Persistent WebSocket hook for real-time task updates
 *
 * This hook maintains a persistent WebSocket connection that:
 * - Connects immediately when sessionId is available
 * - Sends subscribe_session on connect to receive all active task updates
 * - Handles task subscriptions dynamically
 */
export function useWebSocket({
  sessionId,
  onMessage,
  onComplete,
  onError,
  onClose,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const subscribedTasksRef = useRef<Set<string>>(new Set());

  // Stable callbacks using refs to prevent re-connections
  const onMessageRef = useRef(onMessage);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
    onCloseRef.current = onClose;
  }, [onMessage, onComplete, onError, onClose]);

  // Subscribe to a task
  const subscribeToTask = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "subscribe",
          taskId,
        }),
      );
      subscribedTasksRef.current.add(taskId);
      console.log(`[WebSocket] Subscribed to task: ${taskId}`);
    }
  }, []);

  // Unsubscribe from a task
  const unsubscribeFromTask = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "unsubscribe",
          taskId,
        }),
      );
      subscribedTasksRef.current.delete(taskId);
    }
  }, []);

  // Connect when sessionId is available
  useEffect(() => {
    // Cleanup function
    let mounted = true;
    let ws: WebSocket | null = null;

    const connect = async () => {
      // Only connect if we have a sessionId
      if (!sessionId || !mounted) {
        return;
      }

      // Close existing connection if session changed
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, "Session changed");
        } catch {
          // Ignore close errors
        }
        wsRef.current = null;
        subscribedTasksRef.current.clear();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Use a persistent WebSocket connection
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) {
            ws?.close(1000, "Component unmounted");
            return;
          }
          setIsConnected(true);
          console.log("[WebSocket] Connected to persistent session WebSocket");

          // Subscribe to all active tasks for this session
          if (sessionId && ws) {
            ws.send(
              JSON.stringify({
                type: "subscribe_session",
                sessionId,
              }),
            );
            console.log(`[WebSocket] Subscribed to session: ${sessionId}`);
          }
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            console.log("[WebSocket] Received message:", message.type);

            // Handle session_subscribed acknowledgment
            if (message.type === "session_subscribed") {
              console.log(
                `[WebSocket] Session subscribed with tasks:`,
                message.taskId,
              );
              return;
            }

            onMessageRef.current(message);

            if (message.type === "task_complete" && onCompleteRef.current) {
              onCompleteRef.current(
                message.data as { status: string; output: string },
              );
            }
          } catch (parseError) {
            console.error("Failed to parse WebSocket message:", parseError);
          }
        };

        ws.onerror = (error) => {
          if (!mounted) return;
          console.error("WebSocket error:", error);
          if (onErrorRef.current) onErrorRef.current(error);
        };

        ws.onclose = (event) => {
          if (!mounted) return;
          setIsConnected(false);
          subscribedTasksRef.current.clear();
          if (onCloseRef.current) onCloseRef.current(event);
          wsRef.current = null;
        };
      } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        if (onErrorRef.current && mounted) onErrorRef.current(error as Error);
      }
    };

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        try {
          // Unsubscribe from all tasks before closing
          subscribedTasksRef.current.forEach((taskId) => {
            try {
              wsRef.current?.send(
                JSON.stringify({
                  type: "unsubscribe",
                  taskId,
                }),
              );
            } catch {
              // Ignore errors during cleanup
            }
          });
          wsRef.current.close(1000, "Component unmounted");
        } catch {
          // Ignore errors during cleanup
        }
        wsRef.current = null;
        subscribedTasksRef.current.clear();
      }
      setIsConnected(false);
    };
  }, [sessionId]);

  return {
    isConnected,
    subscribeToTask,
    unsubscribeFromTask,
    sendMessage: (message: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      }
    },
  };
}
