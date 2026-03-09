import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const FAVICON_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const FALLBACK_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;

// Well-known favicon paths checked in order.
const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
];

// Files that may contain a <link rel="icon"> or icon metadata declaration.
const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
];

// Matches <link ...> tags or object-like icon metadata where rel/href can appear in any order.
const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;
const VITE_ENV_PLACEHOLDER_RE = /^%([A-Z0-9_]+)%$/i;
const REMOTE_ICON_PROTOCOLS = new Set(["http:", "https:"]);
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
] as const;
const MONOREPO_APP_ROOTS = ["apps", "packages"] as const;

function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  const objMatch = source.match(LINK_ICON_OBJ_RE);
  if (objMatch?.[1]) return objMatch[1];
  return null;
}

function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    if (key.length === 0) {
      continue;
    }
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function resolveEnvPlaceholder(projectCwd: string, href: string): string {
  const match = VITE_ENV_PLACEHOLDER_RE.exec(href.trim());
  if (!match?.[1]) {
    return href;
  }
  let resolved = href;
  for (const envFile of ENV_FILES) {
    const envPath = path.join(projectCwd, envFile);
    try {
      const content = fs.readFileSync(envPath, "utf8");
      const next = parseEnvFile(content).get(match[1]);
      if (typeof next === "string" && next.trim().length > 0) {
        resolved = next.trim();
      }
    } catch {
      continue;
    }
  }
  return resolved;
}

function resolveIconHref(projectCwd: string, href: string): string[] {
  const clean = href.replace(/^\//, "");
  return [path.join(projectCwd, "public", clean), path.join(projectCwd, clean)];
}

function discoverIconSearchRoots(projectCwd: string): string[] {
  const roots = [projectCwd];
  const seen = new Set(roots.map((root) => path.resolve(root)));

  for (const parentDir of MONOREPO_APP_ROOTS) {
    const parentPath = path.join(projectCwd, parentDir);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(parentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(parentPath, entry.name);
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      roots.push(candidate);
    }
  }

  return roots;
}

function isRemoteIconUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return REMOTE_ICON_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function isPathWithinProject(projectCwd: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function serveFaviconFile(filePath: string, res: http.ServerResponse): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = FAVICON_MIME_TYPES[ext] ?? "application/octet-stream";
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Read error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(data);
  });
}

function serveFallbackFavicon(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=3600",
  });
  res.end(FALLBACK_FAVICON_SVG);
}

async function serveRemoteFavicon(remoteUrl: string, res: http.ServerResponse): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(remoteUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const contentType =
      response.headers.get("content-type") ??
      FAVICON_MIME_TYPES[path.extname(new URL(remoteUrl).pathname).toLowerCase()] ??
      "application/octet-stream";
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function tryHandleProjectFaviconRequest(url: URL, res: http.ServerResponse): boolean {
  if (url.pathname !== "/api/project-favicon") {
    return false;
  }

  const projectCwd = url.searchParams.get("cwd");
  if (!projectCwd) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing cwd parameter");
    return true;
  }
  const iconSearchRoots = discoverIconSearchRoots(projectCwd);

  const tryResolvedPaths = (paths: string[], index: number, onExhausted: () => void): void => {
    if (index >= paths.length) {
      onExhausted();
      return;
    }
    const candidate = paths[index]!;
    if (!isPathWithinProject(projectCwd, candidate)) {
      tryResolvedPaths(paths, index + 1, onExhausted);
      return;
    }
    fs.stat(candidate, (err, stats) => {
      if (err || !stats?.isFile()) {
        tryResolvedPaths(paths, index + 1, onExhausted);
        return;
      }
      serveFaviconFile(candidate, res);
    });
  };

  const trySourceFiles = (rootIndex: number, sourceIndex: number): void => {
    const searchRoot = iconSearchRoots[rootIndex];
    if (!searchRoot) {
      serveFallbackFavicon(res);
      return;
    }
    if (sourceIndex >= ICON_SOURCE_FILES.length) {
      trySourceFiles(rootIndex + 1, 0);
      return;
    }
    const sourceFile = path.join(searchRoot, ICON_SOURCE_FILES[sourceIndex]!);
    fs.readFile(sourceFile, "utf8", (err, content) => {
      if (err) {
        trySourceFiles(rootIndex, sourceIndex + 1);
        return;
      }
      const href = extractIconHref(content);
      if (!href) {
        trySourceFiles(rootIndex, sourceIndex + 1);
        return;
      }
      const resolvedHref = resolveEnvPlaceholder(searchRoot, href);
      if (isRemoteIconUrl(resolvedHref)) {
        void serveRemoteFavicon(resolvedHref, res).then((served) => {
          if (!served) {
            trySourceFiles(rootIndex, sourceIndex + 1);
          }
        });
        return;
      }
      const candidates = resolveIconHref(searchRoot, resolvedHref);
      tryResolvedPaths(candidates, 0, () => trySourceFiles(rootIndex, sourceIndex + 1));
    });
  };

  const tryCandidates = (rootIndex: number, candidateIndex: number): void => {
    const searchRoot = iconSearchRoots[rootIndex];
    if (!searchRoot) {
      trySourceFiles(0, 0);
      return;
    }
    if (candidateIndex >= FAVICON_CANDIDATES.length) {
      tryCandidates(rootIndex + 1, 0);
      return;
    }
    const candidate = path.join(searchRoot, FAVICON_CANDIDATES[candidateIndex]!);
    if (!isPathWithinProject(projectCwd, candidate)) {
      tryCandidates(rootIndex, candidateIndex + 1);
      return;
    }
    fs.stat(candidate, (err, stats) => {
      if (err || !stats?.isFile()) {
        tryCandidates(rootIndex, candidateIndex + 1);
        return;
      }
      serveFaviconFile(candidate, res);
    });
  };

  tryCandidates(0, 0);
  return true;
}
