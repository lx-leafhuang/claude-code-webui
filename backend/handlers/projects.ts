import { Context } from "hono";
import type { ProjectInfo, ProjectsResponse } from "../../shared/types.ts";
import { getEncodedProjectName } from "../history/pathUtils.ts";
import { parseAllHistoryFiles } from "../history/parser.ts";
import { logger } from "../utils/logger.ts";
import { readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

/**
 * Get the most recent lastActiveTime for a project from its history files
 * This function silently handles corrupted history files to avoid logging errors
 */
async function getProjectLastActiveTime(
  encodedName: string,
): Promise<string | undefined> {
  const homeDir = getHomeDir();
  if (!homeDir) return undefined;

  const historyDir = `${homeDir}/.claude/projects/${encodedName}`;

  try {
    // Use silent mode to avoid logging errors for corrupted history files
    // when only getting the last active time for project sorting
    const conversationFiles = await parseAllHistoryFiles(historyDir, true);

    // Find the maximum lastTime across all conversation files
    let maxLastTime: string | undefined;

    for (const conv of conversationFiles) {
      if (conv.lastTime && conv.messageCount > 0) {
        if (!maxLastTime || conv.lastTime > maxLastTime) {
          maxLastTime = conv.lastTime;
        }
      }
    }

    return maxLastTime;
  } catch {
    // Silently return undefined for any errors (e.g., corrupted history files)
    return undefined;
  }
}

/**
 * Handles GET /api/projects requests
 * Retrieves list of available project directories from Claude configuration
 * Sorted by last active time (most recent first)
 * @param c - Hono context object
 * @returns JSON response with projects array
 */
export async function handleProjectsRequest(c: Context) {
  try {
    const homeDir = getHomeDir();
    if (!homeDir) {
      return c.json({ error: "Home directory not found" }, 500);
    }

    const claudeConfigPath = `${homeDir}/.claude.json`;

    try {
      const configContent = await readTextFile(claudeConfigPath);
      const config = JSON.parse(configContent);

      if (config.projects && typeof config.projects === "object") {
        const projectPaths = Object.keys(config.projects);

        // Get encoded names for each project with last active time
        const projectsWithTime: ProjectInfo[] = [];
        for (const path of projectPaths) {
          const encodedName = await getEncodedProjectName(path);
          // Only include projects that have history directories
          if (encodedName) {
            const lastActiveTime = await getProjectLastActiveTime(encodedName);
            projectsWithTime.push({
              path,
              encodedName,
              lastActiveTime,
            });
          }
        }

        // Sort by lastActiveTime descending (most recent first)
        // Projects without activity time go to the end
        projectsWithTime.sort((a, b) => {
          const timeA = a.lastActiveTime
            ? new Date(a.lastActiveTime).getTime()
            : 0;
          const timeB = b.lastActiveTime
            ? new Date(b.lastActiveTime).getTime()
            : 0;
          return timeB - timeA;
        });

        const response: ProjectsResponse = { projects: projectsWithTime };
        return c.json(response);
      } else {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
    } catch (error) {
      // Handle file not found errors in a cross-platform way
      if (error instanceof Error && error.message.includes("No such file")) {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
      throw error;
    }
  } catch (error) {
    logger.api.error("Error reading projects: {error}", { error });
    return c.json({ error: "Failed to read projects" }, 500);
  }
}
