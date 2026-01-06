import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";

interface TaskNotification {
  taskId: string;
  sessionId: string;
  workingDirectory?: string;
  status: string;
  output: string;
  timestamp: number;
}

interface WebSocketMessage {
  type: string;
  taskId: string;
  data: unknown;
  timestamp: number;
}

interface WebSocketContextType {
  isConnected: boolean;
  notifications: TaskNotification[];
  addNotification: (notification: TaskNotification) => void;
  removeNotification: (taskId: string) => void;
  clearNotifications: () => void;
  // Project notification tracking for sidebar badges
  projectNotifications: Map<string, number>; // projectPath -> unreadCount
  markProjectAsRead: (projectPath: string) => void;
  // Task subscription methods
  subscribeToSession: (sessionId: string) => void;
  subscribeToTask: (taskId: string) => void;
  onTaskMessage: (callback: (message: WebSocketMessage) => void) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocketContext must be used within a WebSocketProvider",
    );
  }
  return context;
}

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  // Project notification badges for sidebar
  const [projectNotifications, setProjectNotifications] = useState<
    Map<string, number>
  >(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const processedNotificationsRef = useRef<Set<string>>(new Set());
  const taskMessageCallbackRef = useRef<
    ((message: WebSocketMessage) => void) | null
  >(null);

  // Add a notification
  const addNotification = useCallback((notification: TaskNotification) => {
    setNotifications((prev) => [notification, ...prev].slice(0, 10));
  }, []);

  // Remove a specific notification
  const removeNotification = useCallback((taskId: string) => {
    setNotifications((prev) => prev.filter((n) => n.taskId !== taskId));
  }, []);

  // Clear all notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Mark a project's notifications as read (clear the badge)
  const markProjectAsRead = useCallback((projectPath: string) => {
    setProjectNotifications((prev) => {
      const next = new Map(prev);
      next.delete(projectPath);
      return next;
    });
  }, []);

  // Subscribe to a session for task updates
  const subscribeToSession = useCallback((sessionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "subscribe_session",
          sessionId,
        }),
      );
      console.log(`[WebSocket] Subscribed to session: ${sessionId}`);
    }
  }, []);

  // Subscribe to a specific task
  const subscribeToTask = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "subscribe",
          taskId,
        }),
      );
      console.log(`[WebSocket] Subscribed to task: ${taskId}`);
    }
  }, []);

  // Set callback for task messages
  const onTaskMessage = useCallback(
    (callback: (message: WebSocketMessage) => void) => {
      taskMessageCallbackRef.current = callback;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    let ws: WebSocket | null = null;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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
          console.log("[WebSocket] Connected to global WebSocket");
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const message = JSON.parse(event.data);
            console.log("[WebSocket] Received message:", message.type);

            // Handle task messages (for current session/task)
            if (
              message.type === "task_message" ||
              message.type === "task_complete"
            ) {
              if (taskMessageCallbackRef.current) {
                taskMessageCallbackRef.current(message as WebSocketMessage);
              }
            }

            // Handle task notifications (cross-session)
            if (message.type === "task_notification") {
              const notificationData = message.data || message;
              const taskId = notificationData.taskId;

              console.log("[WebSocket] Processing task notification:", {
                taskId,
                sessionId: notificationData.sessionId,
                status: notificationData.status,
                output: notificationData.output,
              });

              // Skip duplicate notifications
              if (processedNotificationsRef.current.has(taskId)) {
                console.log(
                  "[WebSocket] Skipping duplicate notification:",
                  taskId,
                );
                return;
              }
              processedNotificationsRef.current.add(taskId);

              // Clean up old processed notifications (keep last 100)
              if (processedNotificationsRef.current.size > 100) {
                const iterator = processedNotificationsRef.current.values();
                for (let i = 0; i < 50; i++) {
                  const value = iterator.next().value;
                  if (value) {
                    processedNotificationsRef.current.delete(value);
                  }
                }
              }

              const notification: TaskNotification = {
                taskId: notificationData.taskId,
                sessionId: notificationData.sessionId || "",
                workingDirectory: message.workingDirectory || undefined,
                status: notificationData.status,
                output: notificationData.output || "",
                timestamp: message.timestamp,
              };

              console.log("[WebSocket] Adding notification:", notification);
              addNotification(notification);

              // Track project notification for sidebar badge
              if (notification.workingDirectory) {
                setProjectNotifications((prev) => {
                  const next = new Map(prev);
                  const count =
                    (next.get(notification.workingDirectory!) || 0) + 1;
                  next.set(notification.workingDirectory!, count);
                  return next;
                });
              }

              // Auto-remove notification is disabled - user must click or close to dismiss
            }

            // Handle connection acknowledgment
            if (message.type === "connected") {
              console.log(
                `[WebSocket] Global subscription confirmed, ${message.globalConnections} clients connected`,
              );
            }

            // Handle session subscription acknowledgment
            if (message.type === "session_subscribed") {
              console.log(
                `[WebSocket] Session subscribed with tasks:`,
                message.tasks,
              );
            }
          } catch (parseError) {
            console.error("Failed to parse WebSocket message:", parseError);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        ws.onclose = () => {
          if (!mounted) return;
          setIsConnected(false);
          console.log("WebSocket connection closed");

          // Reconnect after 3 seconds
          setTimeout(() => {
            if (mounted) {
              connect();
            }
          }, 3000);
        };
      } catch (error) {
        console.error("Failed to create WebSocket connection:", error);
        // Reconnect after 3 seconds
        setTimeout(() => {
          if (mounted) {
            connect();
          }
        }, 3000);
      }
    };

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, "Component unmounted");
        } catch {
          // Ignore close errors
        }
        wsRef.current = null;
      }
    };
  }, [addNotification, removeNotification]);

  const value = useMemo(
    () => ({
      isConnected,
      notifications,
      addNotification,
      removeNotification,
      clearNotifications,
      projectNotifications,
      markProjectAsRead,
      subscribeToSession,
      subscribeToTask,
      onTaskMessage,
    }),
    [
      isConnected,
      notifications,
      addNotification,
      removeNotification,
      clearNotifications,
      projectNotifications,
      markProjectAsRead,
      subscribeToSession,
      subscribeToTask,
      onTaskMessage,
    ],
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
