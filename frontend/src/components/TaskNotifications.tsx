import { useNavigate, useLocation } from "react-router-dom";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useCallback } from "react";

export function TaskNotifications() {
  const navigate = useNavigate();
  const location = useLocation();
  const { notifications, removeNotification } = useWebSocketContext();

  const handleNotificationClick = useCallback(
    (notification: (typeof notifications)[0]) => {
      // Navigate to the project and session
      if (notification.workingDirectory) {
        // Use URL encoding (ChatPage uses decodeURIComponent to decode)
        const encodedPath = encodeURIComponent(notification.workingDirectory);
        navigate(
          `/projects/${encodedPath}?sessionId=${notification.sessionId}`,
        );
      } else {
        navigate(`/?sessionId=${notification.sessionId}`);
      }
      // Remove the notification after clicking
      removeNotification(notification.taskId);
    },
    [navigate, removeNotification],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.stopPropagation();
      removeNotification(taskId);
    },
    [removeNotification],
  );

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notification) => {
        const isFromCurrentSession = location.search.includes(
          `sessionId=${notification.sessionId}`,
        );

        return (
          <div
            key={notification.taskId}
            onClick={() => handleNotificationClick(notification)}
            className={`
              p-4 rounded-lg shadow-lg cursor-pointer transition-all duration-300
              ${
                isFromCurrentSession
                  ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              }
              hover:shadow-xl hover:scale-102
            `}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      notification.status === "completed"
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      isFromCurrentSession
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {notification.status === "completed" ? "完成" : "失败"}
                  </span>
                  {isFromCurrentSession && (
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      (当前对话)
                    </span>
                  )}
                </div>
                <p
                  className={`text-sm truncate ${
                    isFromCurrentSession
                      ? "text-blue-800 dark:text-blue-200"
                      : "text-slate-800 dark:text-slate-200"
                  }`}
                >
                  {notification.output || "任务已完成"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {notification.workingDirectory
                    ? notification.workingDirectory.split("/").pop() ||
                      notification.workingDirectory
                    : "未知项目"}
                  {notification.sessionId && ` • ${notification.sessionId}`}
                </p>
              </div>
              <button
                onClick={(e) => handleClose(e, notification.taskId)}
                className="flex-shrink-0 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                aria-label="关闭通知"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
