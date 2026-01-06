/**
 * Node.js runtime implementation
 *
 * Simplified implementation focusing only on platform-specific operations.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import process from "node:process";
import { createServer } from "node:http";
import { Hono } from "hono";
import type { CommandResult, Runtime } from "./types.ts";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { getPlatform } from "../utils/os.ts";
import { wsManager } from "../utils/websocket.ts";
import { taskManager } from "../tasks/manager.ts";
import { getRequestListener } from "@hono/node-server";

// Use dynamic import for ws module
let WS: typeof import("ws");

export class NodeRuntime implements Runtime {
  private wss: InstanceType<typeof WS.WebSocketServer> | null = null;

  async findExecutable(name: string): Promise<string[]> {
    const platform = getPlatform();
    const candidates: string[] = [];

    if (platform === "windows") {
      // Try multiple possible executable names on Windows
      const executableNames = [
        name,
        `${name}.exe`,
        `${name}.cmd`,
        `${name}.bat`,
      ];

      for (const execName of executableNames) {
        const result = await this.runCommand("where", [execName]);
        if (result.success && result.stdout.trim()) {
          // where command can return multiple paths, split by newlines
          const paths = result.stdout
            .trim()
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p);
          candidates.push(...paths);
        }
      }
    } else {
      // Unix-like systems (macOS, Linux)
      const result = await this.runCommand("which", [name]);
      if (result.success && result.stdout.trim()) {
        candidates.push(result.stdout.trim());
      }
    }

    return candidates;
  }

  runCommand(
    command: string,
    args: string[],
    options?: { env?: Record<string, string> },
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const isWindows = getPlatform() === "windows";
      const spawnOptions: SpawnOptions = {
        stdio: ["ignore", "pipe", "pipe"],
        env: options?.env ? { ...process.env, ...options.env } : process.env,
      };

      // On Windows, always use cmd.exe /c for all commands
      let actualCommand = command;
      let actualArgs = args;

      if (isWindows) {
        actualCommand = "cmd.exe";
        actualArgs = ["/c", command, ...args];
      }

      const child = spawn(actualCommand, actualArgs, spawnOptions);

      const textDecoder = new TextDecoder();
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Uint8Array) => {
        stdout += textDecoder.decode(data, { stream: true });
      });

      child.stderr?.on("data", (data: Uint8Array) => {
        stderr += textDecoder.decode(data, { stream: true });
      });

      child.on("close", (code: number | null) => {
        resolve({
          success: code === 0,
          code: code ?? 1,
          stdout,
          stderr,
        });
      });

      child.on("error", (error: Error) => {
        resolve({
          success: false,
          code: 1,
          stdout: "",
          stderr: error.message,
        });
      });
    });
  }

  async serve(
    port: number,
    hostname: string,
    handler: (req: Request) => Response | Promise<Response>,
  ): Promise<void> {
    // Initialize WebSocket module
    if (!WS) {
      WS = await import("ws");
    }

    // Use Hono with Node.js server to handle Web API Request/Response
    const app = new Hono();

    // Route all requests to the provided handler
    app.all("*", async (c) => {
      const response = await handler(c.req.raw);
      return response;
    });

    // Create HTTP server using getRequestListener for proper Hono integration
    const requestListener = getRequestListener(app.fetch);

    const server = createServer(async (req, res) => {
      // Skip WebSocket upgrade requests (handled separately)
      const isWsUpgrade =
        req.headers.upgrade === "websocket" &&
        (req.url?.startsWith("/api/ws") ||
          req.url?.startsWith("/api/ws/tasks/"));
      if (isWsUpgrade) {
        return;
      }
      // Pass to Hono's request listener
      requestListener(req, res);
    });

    // Initialize WebSocket server
    this.wss = new WS.WebSocketServer({ noServer: true });

    // Handle WebSocket connections
    this.wss.on("connection", (ws, req) => {
      const url = req.url || "";

      // Check if this is a task-specific connection or a persistent session connection
      if (url.startsWith("/api/ws/tasks/")) {
        // Task-specific WebSocket: /api/ws/tasks/:taskId
        const taskId = url.replace("/api/ws/tasks/", "").split("?")[0];

        if (!taskId) {
          ws.close(1008, "Missing taskId");
          return;
        }

        console.log(`WebSocket connected for task: ${taskId}`);

        // Subscribe to task updates
        wsManager.subscribe(taskId, ws);

        // Send pending messages for this task
        const task = taskManager.getTask(taskId);
        if (task && task.messages.length > 0) {
          task.messages.forEach((msg) => {
            ws.send(
              JSON.stringify({
                type: msg.type,
                taskId,
                data: msg.data,
                timestamp: msg.timestamp,
              }),
            );
          });
        }

        // Handle incoming messages
        ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log(`WebSocket message for task ${taskId}:`, message.type);

            if (message.type === "subscribe") {
              // Already subscribed, send acknowledgment
              ws.send(
                JSON.stringify({
                  type: "subscribed",
                  taskId,
                  timestamp: Date.now(),
                }),
              );
            }

            if (message.type === "unsubscribe") {
              wsManager.unsubscribe(taskId, ws);
            }
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        });

        // Handle close
        ws.on("close", () => {
          console.log(`WebSocket closed for task: ${taskId}`);
          wsManager.unsubscribe(taskId, ws);
        });

        // Handle errors
        ws.on("error", (error) => {
          console.error(`WebSocket error for task ${taskId}:`, error);
        });
      } else {
        // Persistent session WebSocket: /api/ws
        // Client will send subscribe_session message to subscribe to tasks
        console.log(`WebSocket connected for session (persistent connection)`);

        // Subscribe to global notifications for cross-session task updates
        wsManager.subscribeGlobal(ws);

        // Handle incoming messages
        ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log(`WebSocket message:`, message.type);

            if (message.type === "subscribe_session" && message.sessionId) {
              // Subscribe to all active tasks for this session
              const activeTasks = taskManager.getTasksBySession(
                message.sessionId,
              );
              const subscribedTasks: string[] = [];

              activeTasks.forEach((task) => {
                if (task.status === "pending" || task.status === "running") {
                  wsManager.subscribe(task.taskId, ws);
                  subscribedTasks.push(task.taskId);

                  // Send pending messages for this task
                  if (task.messages.length > 0) {
                    task.messages.forEach((msg) => {
                      ws.send(
                        JSON.stringify({
                          type: msg.type,
                          taskId: task.taskId,
                          data: msg.data,
                          timestamp: msg.timestamp,
                        }),
                      );
                    });
                  }
                }
              });

              console.log(
                `Subscribed to ${subscribedTasks.length} active tasks for session ${message.sessionId}`,
              );

              // Send acknowledgment with subscribed task IDs
              ws.send(
                JSON.stringify({
                  type: "session_subscribed",
                  sessionId: message.sessionId,
                  tasks: subscribedTasks,
                  timestamp: Date.now(),
                }),
              );
            }

            if (message.type === "subscribe" && message.taskId) {
              wsManager.subscribe(message.taskId, ws);

              // Send pending messages for this task
              const task = taskManager.getTask(message.taskId);
              if (task && task.messages.length > 0) {
                task.messages.forEach((msg) => {
                  ws.send(
                    JSON.stringify({
                      type: msg.type,
                      taskId: message.taskId,
                      data: msg.data,
                      timestamp: msg.timestamp,
                    }),
                  );
                });
              }

              ws.send(
                JSON.stringify({
                  type: "subscribed",
                  taskId: message.taskId,
                  timestamp: Date.now(),
                }),
              );
            }

            if (message.type === "unsubscribe" && message.taskId) {
              wsManager.unsubscribe(message.taskId, ws);
            }
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        });

        // Handle close - unsubscribe from all tasks
        ws.on("close", () => {
          console.log(`WebSocket closed for session`);
        });

        // Handle errors
        ws.on("error", (error) => {
          console.error(`WebSocket error for session:`, error);
        });
      }
    });

    // Handle WebSocket upgrade requests at server level
    server.on("upgrade", (req, socket, head) => {
      if (req.url?.startsWith("/api/ws")) {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    // Start listening
    await new Promise<void>((resolve) => {
      server.listen(port, hostname, () => {
        console.log(`Listening on http://${hostname}:${port}/`);
        resolve();
      });
    });
  }

  createStaticFileMiddleware(options: { root: string }): MiddlewareHandler {
    return serveStatic(options);
  }
}
