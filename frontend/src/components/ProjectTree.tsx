import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderIcon } from "@heroicons/react/24/outline";
import type { ProjectInfo } from "../types";
import { getProjectsUrl } from "../config/api";
import { useWebSocketContext } from "../context/WebSocketContext";

interface ProjectTreeProps {
  onProjectSelect?: (projectPath: string) => void;
}

export function ProjectTree({ onProjectSelect }: ProjectTreeProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { projectNotifications, markProjectAsRead } = useWebSocketContext();

  const currentProject = searchParams.get("project");

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch(getProjectsUrl());
      if (!response.ok) {
        throw new Error(`Failed to load projects: ${response.statusText}`);
      }
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSelect = useCallback(
    (projectPath: string) => {
      // Mark project notifications as read
      markProjectAsRead(projectPath);

      // Navigate to project with new conversation
      const normalizedPath = projectPath.startsWith("/")
        ? projectPath
        : `/${projectPath}`;
      const params = new URLSearchParams();
      params.set("project", normalizedPath);
      navigate(`/?${params.toString()}`);

      onProjectSelect?.(normalizedPath);
    },
    [navigate, onProjectSelect, markProjectAsRead],
  );

  if (loading) {
    return (
      <div className="w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-slate-500 dark:text-slate-400 text-sm">
          Loading projects...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex items-center justify-center h-full flex-shrink-0">
        <div className="text-red-500 dark:text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-slate-800 dark:text-slate-100 font-semibold text-sm">
          Projects
        </h2>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        {projects.length > 0 ? (
          <div className="py-2">
            {projects.map((project) => {
              const isSelected = currentProject === project.path;
              const notificationCount =
                projectNotifications.get(project.path) || 0;

              return (
                <button
                  key={project.path}
                  onClick={() => handleProjectSelect(project.path)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-500"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  }`}
                >
                  <FolderIcon className="h-4 w-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                  <span
                    className="flex-1 text-sm text-slate-700 dark:text-slate-200 overflow-hidden text-ellipsis"
                    title={project.path}
                  >
                    {project.path}
                  </span>
                  {notificationCount > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 text-xs font-medium text-white bg-red-500 rounded-full">
                      {notificationCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
            No projects found
          </div>
        )}
      </div>
    </div>
  );
}
