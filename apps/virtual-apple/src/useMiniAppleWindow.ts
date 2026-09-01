import { useCallback, useEffect, useRef, useState } from "react";
import { MINI_APPLE_HEARTBEAT_EVENT } from "./miniAppleHeartbeat";

interface DocumentPictureInPictureOptions {
  height?: number;
  width?: number;
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

type PictureInPictureCapableWindow = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
};

const MINI_APPLE_HEARTBEAT_INTERVAL_MS = 250;

export function documentPictureInPictureSupported(browserWindow: Window | undefined) {
  return (
    typeof (browserWindow as PictureInPictureCapableWindow | undefined)?.documentPictureInPicture?.requestWindow ===
    "function"
  );
}

export function prepareMiniAppleDocument(source: Document, target: Document) {
  target.documentElement.lang = source.documentElement.lang || "en";
  target.documentElement.className = "mini-apple-document-root";
  target.title = "Mini Virtual Mets Apple";

  const base = target.createElement("base");
  base.href = source.baseURI;
  target.head.append(base);

  const viewport = target.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  target.head.append(viewport);

  source.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
    target.head.append(styleNode.cloneNode(true));
  });

  const sourceIcon = source.querySelector('link[rel~="icon"]');
  if (sourceIcon) target.head.append(sourceIcon.cloneNode(true));

  target.body.className = "mini-apple-document";
  target.body.replaceChildren();
  const root = target.createElement("div");
  root.id = "mini-apple-root";
  target.body.append(root);
  return root;
}

function pictureInPictureError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The browser blocked Mini Apple. Try opening it again from this tab.";
  }
  return "Mini Apple could not open, so Focus view was enabled instead.";
}

export function useMiniAppleWindow(onBeforeClose?: () => void) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [animationWindow, setAnimationWindow] = useState<Window | null>(null);
  const [error, setError] = useState("");
  const [supported] = useState(() =>
    documentPictureInPictureSupported(typeof window === "undefined" ? undefined : window),
  );
  const childWindowRef = useRef<Window | null>(null);
  const stopHeartbeatRef = useRef<(() => void) | null>(null);
  const removeCloseListenerRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const onBeforeCloseRef = useRef(onBeforeClose);
  onBeforeCloseRef.current = onBeforeClose;

  const restoreContent = useCallback(() => {
    onBeforeCloseRef.current?.();
  }, []);

  const clearWindowState = useCallback(() => {
    stopHeartbeatRef.current?.();
    stopHeartbeatRef.current = null;
    removeCloseListenerRef.current?.();
    removeCloseListenerRef.current = null;
    childWindowRef.current = null;
    if (mountedRef.current) {
      setAnimationWindow(null);
      setContainer(null);
    }
  }, []);

  const close = useCallback(() => {
    const childWindow = childWindowRef.current;
    restoreContent();
    clearWindowState();
    if (childWindow && !childWindow.closed) {
      window.setTimeout(() => {
        if (!childWindow.closed) childWindow.close();
      }, 0);
    }
  }, [clearWindowState, restoreContent]);

  const open = useCallback(async () => {
    setError("");
    const currentWindow = childWindowRef.current;
    if (currentWindow && !currentWindow.closed) {
      currentWindow.focus();
      return true;
    }

    const api = (window as PictureInPictureCapableWindow).documentPictureInPicture;
    if (!api) {
      setError("Mini Apple is not supported by this browser, so Focus view was enabled instead.");
      return false;
    }

    try {
      const childWindow = await api.requestWindow({ height: 300, width: 420 });
      if (!mountedRef.current) {
        childWindow.close();
        return false;
      }

      const root = prepareMiniAppleDocument(document, childWindow.document);
      const handleClose = () => {
        restoreContent();
        clearWindowState();
      };
      childWindow.addEventListener("pagehide", handleClose, { once: true });
      removeCloseListenerRef.current = () => childWindow.removeEventListener("pagehide", handleClose);
      const heartbeatTimer = childWindow.setInterval(
        () => window.dispatchEvent(new Event(MINI_APPLE_HEARTBEAT_EVENT)),
        MINI_APPLE_HEARTBEAT_INTERVAL_MS,
      );
      stopHeartbeatRef.current = () => childWindow.clearInterval(heartbeatTimer);
      childWindowRef.current = childWindow;
      setAnimationWindow(childWindow);
      setContainer(root);
      return true;
    } catch (caughtError) {
      setError(pictureInPictureError(caughtError));
      return false;
    }
  }, [clearWindowState, restoreContent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      restoreContent();
      const childWindow = childWindowRef.current;
      stopHeartbeatRef.current?.();
      stopHeartbeatRef.current = null;
      removeCloseListenerRef.current?.();
      removeCloseListenerRef.current = null;
      childWindowRef.current = null;
      if (childWindow && !childWindow.closed) childWindow.close();
    };
  }, [restoreContent]);

  return {
    close,
    container,
    error,
    isOpen: container !== null,
    animationWindow,
    open,
    supported,
  };
}
