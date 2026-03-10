import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import { CheckIcon, CopyIcon } from "lucide-react";
import React, {
  Children,
  Suspense,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { readNativeApi } from "../nativeApi";
import { preferredTerminalEditor } from "../terminal-links";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const COPY_FEEDBACK_DURATION_MS = 1200;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  return match?.[1] ?? "text";
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function resolveInlineCodeTarget(
  target: EventTarget | null,
  container: HTMLDivElement,
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const inlineCode = target.closest("code");
  if (!(inlineCode instanceof HTMLElement)) {
    return null;
  }

  if (!container.contains(inlineCode) || inlineCode.closest("pre") != null) {
    return null;
  }

  return inlineCode;
}

interface MarkdownCopyContainerProps {
  children: ReactNode;
  className: string;
  copyLabel: string;
  getCopyText: () => string;
}

function MarkdownCopyContainer({
  children,
  className,
  copyLabel,
  getCopyText,
}: MarkdownCopyContainerProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }

    const copyText = getCopyText().trimEnd();
    if (copyText.length === 0) {
      return;
    }

    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, COPY_FEEDBACK_DURATION_MS);
      })
      .catch(() => undefined);
  }, [getCopyText]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className={className}>
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : copyLabel}
        aria-label={copied ? "Copied" : copyLabel}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const getCopyText = useCallback(() => code, [code]);

  return (
    <MarkdownCopyContainer
      className="chat-markdown-copyable chat-markdown-codeblock"
      copyLabel="Copy code"
      getCopyText={getCopyText}
    >
      {children}
    </MarkdownCopyContainer>
  );
}

function MarkdownBlockquote({
  children,
  ...props
}: ComponentPropsWithoutRef<"blockquote"> & { children: ReactNode }) {
  const blockquoteRef = useRef<HTMLQuoteElement | null>(null);
  const getCopyText = useCallback(() => blockquoteRef.current?.innerText ?? "", []);

  return (
    <MarkdownCopyContainer
      className="chat-markdown-copyable chat-markdown-blockquote-shell"
      copyLabel="Copy text"
      getCopyText={getCopyText}
    >
      <blockquote {...props} ref={blockquoteRef}>
        {children}
      </blockquote>
    </MarkdownCopyContainer>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch {
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

function ChatMarkdown({ text, cwd, isStreaming = false }: ChatMarkdownProps) {
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const inlineCodeFeedbackTimersRef = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout>>());
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return <a {...props} href={href} target="_blank" rel="noreferrer" />;
        }

        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const api = readNativeApi();
              if (api) {
                void api.shell.openInEditor(targetPath, preferredTerminalEditor());
              } else {
                console.warn("Native API not found. Unable to open file in editor.");
              }
            }}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
      blockquote({ node: _node, children, ...props }) {
        return <MarkdownBlockquote {...props}>{children}</MarkdownBlockquote>;
      },
    }),
    [cwd, diffThemeName, isStreaming],
  );

  const copyInlineCode = useCallback((inlineCode: HTMLElement) => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }

    const copyText = inlineCode.innerText.trim();
    if (copyText.length === 0) {
      return;
    }

    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        const existingTimer = inlineCodeFeedbackTimersRef.current.get(inlineCode);
        if (existingTimer != null) {
          clearTimeout(existingTimer);
        }

        inlineCode.dataset.copied = "true";
        const timeoutId = setTimeout(() => {
          delete inlineCode.dataset.copied;
          inlineCodeFeedbackTimersRef.current.delete(inlineCode);
        }, COPY_FEEDBACK_DURATION_MS);
        inlineCodeFeedbackTimersRef.current.set(inlineCode, timeoutId);
      })
      .catch(() => undefined);
  }, []);

  const handleMarkdownClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = markdownRef.current;
      if (container == null) {
        return;
      }

      const inlineCode = resolveInlineCodeTarget(event.target, container);
      if (inlineCode == null) {
        return;
      }

      event.preventDefault();
      copyInlineCode(inlineCode);
    },
    [copyInlineCode],
  );

  const handleMarkdownKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const container = markdownRef.current;
      if (container == null) {
        return;
      }

      const inlineCode = resolveInlineCodeTarget(event.target, container);
      if (inlineCode == null) {
        return;
      }

      event.preventDefault();
      copyInlineCode(inlineCode);
    },
    [copyInlineCode],
  );

  useEffect(() => {
    const container = markdownRef.current;
    if (container == null) {
      return;
    }

    const inlineCodes = container.querySelectorAll<HTMLElement>("code");
    for (const inlineCode of inlineCodes) {
      if (inlineCode.closest("pre") != null) {
        continue;
      }

      inlineCode.classList.add("chat-markdown-inline-code");
      inlineCode.tabIndex = 0;
      inlineCode.setAttribute("role", "button");
      inlineCode.setAttribute("aria-label", "Copy code");
    }
  }, [text, isStreaming]);

  useEffect(
    () => () => {
      for (const timeoutId of inlineCodeFeedbackTimersRef.current.values()) {
        clearTimeout(timeoutId);
      }
      inlineCodeFeedbackTimersRef.current.clear();
    },
    [],
  );

  return (
    <div
      ref={markdownRef}
      className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80"
      onClick={handleMarkdownClick}
      onKeyDown={handleMarkdownKeyDown}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
