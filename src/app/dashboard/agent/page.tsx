"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  PageHeader,
  Badge,
  EmptyState,
} from "@/components/dashboard";
import { useToast } from "@/components/dashboard";
import { useAuthStore } from "@/stores/auth-store";
import { apiClient } from "@/lib/api-client";
import type { AgentMessage } from "@/types/api";
import type { Plan } from "@prisma/client";

// ============================================================================
// Agent Page — Executive Query Agent Chat Interface
// ============================================================================

type AgentType = "query" | "reformulation" | "workflow";

const AGENT_OPTIONS: Array<{ id: AgentType; label: string; description: string; minPlan: Plan }> = [
  {
    id: "query",
    label: "Query Agent",
    description: "Ask questions about your regulatory exposure and compliance status",
    minPlan: "PRO",
  },
  {
    id: "reformulation",
    label: "Reformulation Advisor",
    description: "Get AI-powered reformulation recommendations for affected products",
    minPlan: "PRO",
  },
  {
    id: "workflow",
    label: "Workflow Generator",
    description: "Generate compliance and reformulation workflows automatically",
    minPlan: "COMMAND",
  },
];

const PLAN_HIERARCHY: Record<Plan, number> = {
  DIAGNOSTIC: 0,
  SCOUT: 1,
  PRO: 2,
  COMMAND: 3,
};

function isPlanAccessible(minPlan: Plan, userPlan: Plan): boolean {
  return PLAN_HIERARCHY[userPlan] >= PLAN_HIERARCHY[minPlan];
}

export default function AgentPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();

  const [selectedAgent, setSelectedAgent] = useState<AgentType>("query");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userPlan = (user?.tenantPlan ?? "DIAGNOSTIC") as Plan;
  const currentAgent = AGENT_OPTIONS.find((a) => a.id === selectedAgent);
  const isAccessible = currentAgent ? isPlanAccessible(currentAgent.minPlan, userPlan) : false;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !isAccessible || isSending) return;

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const endpoint =
        selectedAgent === "reformulation"
          ? "/api/agent/reformulation"
          : selectedAgent === "workflow"
            ? "/api/agent/workflow"
            : "/api/agent/query";

      const result = await apiClient.post<AgentMessage, { query: string }>(endpoint, {
        query: trimmed,
      });

      setMessages((prev) => [...prev, result]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to get a response";
      toast.error("Agent error", message);

      const errorMessage: AgentMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `I encountered an error processing your request: ${message}. Please try again.`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [input, isAccessible, isSending, selectedAgent, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent"
        description="AI-powered regulatory intelligence and workflow automation"
      />

      {/* Agent type selector */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {AGENT_OPTIONS.map((agent) => {
          const accessible = isPlanAccessible(agent.minPlan, userPlan);
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                if (accessible) setSelectedAgent(agent.id);
              }}
              disabled={!accessible}
              className={`relative rounded-lg border p-4 text-left transition-all ${
                selectedAgent === agent.id
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200 dark:border-blue-400 dark:bg-blue-900/20 dark:ring-blue-800"
                  : accessible
                    ? "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                    : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${selectedAgent === agent.id ? "text-blue-700 dark:text-blue-300" : "text-slate-900 dark:text-white"}`}>
                  {agent.label}
                </h3>
                {accessible ? (
                  <Badge variant="success">Available</Badge>
                ) : (
                  <Badge variant="default">{agent.minPlan}+</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {agent.description}
              </p>
              {!accessible && (
                <p className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                  Upgrade to {agent.minPlan} to unlock this agent
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Chat area */}
      <div className="flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6" style={{ minHeight: "400px", maxHeight: "600px" }}>
          {messages.length === 0 ? (
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              }
              title="Start a conversation"
              description={
                isAccessible
                  ? `Ask the ${currentAgent?.label ?? "Agent"} anything about your regulatory exposure, compliance status, or reformulation options.`
                  : `Upgrade to ${currentAgent?.minPlan ?? "PRO"} to use this agent.`
              }
            />
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {/* Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-600">
                      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Sources:</p>
                      {msg.citations.map((citation) => (
                        <a
                          key={citation.sourceId}
                          href={citation.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-blue-500 hover:underline dark:text-blue-400"
                        >
                          {citation.sourceName}
                        </a>
                      ))}
                    </div>
                  )}
                  <p className={`mt-1 text-xs ${msg.role === "user" ? "text-blue-200" : "text-slate-400 dark:text-slate-500"}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))
          )}
          {isSending && (
            <div className="flex justify-start">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Thinking…
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isAccessible || isSending}
              rows={2}
              placeholder={
                isAccessible
                  ? `Ask the ${currentAgent?.label ?? "Agent"}…`
                  : "Upgrade your plan to use this agent"
              }
              className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-500"
              aria-label="Message input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!isAccessible || isSending || !input.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Send message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Press Enter to send, Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
