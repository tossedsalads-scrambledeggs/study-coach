"use client";

/**
 * The coach's thread: the starter's thread (components/thread.aui.tsx) trimmed to what a study chat needs.
 * No attachments, voice, edit or regenerate: regenerating a turn would re-run tools such as log_error and
 * double-log a mistake, and the backend does not take files. Tool calls render through the registered cards.
 */

import { MarkdownText } from "@/components/markdown-text";
import { ToolFallback } from "@/components/tool-fallback.aui";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type AssistantState,
} from "@assistant-ui/react";
import { useAISDKChat, useAISDKError } from "@assistant-ui/ai-sdk";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CopyIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import type { ComponentType, FC } from "react";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

// No grouping: every part renders in order, tool cards on their own.
const noGroups = groupPartByType({});

export type CoachThreadProps = {
  Welcome: ComponentType;
  placeholder: string;
};

export const CoachThread: FC<CoachThreadProps> = ({ Welcome, placeholder }) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]: "color-mix(in oklab, var(--color-muted) 30%, transparent)",
        ["--composer-radius" as string]: "1rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          <div data-slot="aui_message-group" role="log" aria-label="Conversation" className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            <ScrollToBottom />
            <RequestError />
            <Composer placeholder={placeholder} />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
};

/** The server answers failures with { error }; the AI SDK hands that body back as the error message. */
function readableError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error) return parsed.error;
  } catch {
    // not JSON: use the text as it is
  }
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

/**
 * A request that fails before the coach starts answering leaves no assistant message to show the error on,
 * so say so here. Failures mid-answer are shown on the message itself.
 */
const RequestError: FC = () => {
  const error = useAISDKError();
  const chat = useAISDKChat();
  const noAnswerYet = useAuiState((s) => s.thread.messages.at(-1)?.role === "user");
  if (!error || !noAnswerYet) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">The coach couldn&rsquo;t answer that.</p>
        <p className="break-words opacity-90">{readableError(error.message)}</p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={() => chat?.clearError()}>
        Dismiss
      </Button>
    </div>
  );
};

const ScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom
    render={
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      />
    }
  >
    <ArrowDownIcon />
  </ThreadPrimitive.ScrollToBottom>
);

const Composer: FC<{ placeholder: string }> = ({ placeholder }) => (
  <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
    <div
      data-slot="aui_composer-shell"
      className="border-foreground/10 focus-within:border-foreground/25 flex w-full cursor-text flex-col gap-1 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] motion-reduce:transition-none"
    >
      <ComposerPrimitive.Input
        placeholder={placeholder}
        className="aui-composer-input caret-primary placeholder:text-muted-foreground/70 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
        rows={1}
        autoFocus
        enterKeyHint="send"
        aria-label="Your message"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground/80 hidden pl-2.5 text-xs sm:block">Enter to send. Shift + Enter for a new line.</p>
        <div className="ml-auto flex items-center gap-1.5">
          <AuiIf condition={(s) => !s.composer.canCancel}>
            <ComposerPrimitive.Send
              render={
                <TooltipIconButton
                  tooltip="Send message"
                  side="bottom"
                  type="button"
                  variant="default"
                  size="icon"
                  className="size-8 rounded-full"
                  aria-label="Send message"
                />
              }
            >
              <ArrowUpIcon className="size-4" />
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.canCancel}>
            <ComposerPrimitive.Cancel
              render={<Button type="button" variant="default" size="icon" className="size-8 rounded-full" aria-label="Stop generating" />}
            >
              <SquareIcon className="size-3.5 fill-current" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </div>
  </ComposerPrimitive.Root>
);

const MessageError: FC = () => (
  <MessagePrimitive.Error>
    <ErrorPrimitive.Root
      role="alert"
      className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200"
    >
      <ErrorPrimitive.Message className="aui-message-error-message line-clamp-3" />
    </ErrorPrimitive.Root>
  </MessagePrimitive.Error>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root
    data-slot="aui_assistant-message-root"
    data-role="assistant"
    className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
  >
    <div data-slot="aui_assistant-message-content" className="text-foreground px-2 leading-relaxed wrap-break-word">
      <MessagePrimitive.GroupedParts groupBy={noGroups}>
        {({ part }) => {
          switch (part.type) {
            case "text":
              return <MarkdownText />;
            case "tool-call":
              return part.toolUI ?? <ToolFallback {...part} />;
            case "indicator":
              return (
                <span className="animate-pulse font-sans" aria-label="Your coach is working">
                  {"●"}
                </span>
              );
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <MessageError />
    </div>

    <div data-slot="aui_assistant-message-footer" className="ms-2 flex min-h-7.5 items-center pt-1.5">
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="text-muted-foreground animate-in fade-in -ms-1 flex gap-1 duration-200"
      >
        <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </div>
  </MessagePrimitive.Root>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root
    data-slot="aui_user-message-root"
    data-role="user"
    className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
  >
    <div className="relative col-start-2 min-w-0">
      <div className="bg-muted text-foreground rounded-(--composer-radius) px-4 py-2 wrap-break-word whitespace-pre-wrap empty:hidden">
        <MessagePrimitive.Parts />
      </div>
    </div>
  </MessagePrimitive.Root>
);
