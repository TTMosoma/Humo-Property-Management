import { LibraryDataSource } from '../../domain';

/**
 * Opens a document's file. The link is asked for when it's opened, because on the API it's valid for a few minutes.
 * The window opens first, so the browser doesn't block it while the link is fetched.
 */
export function openDocumentFile(data: LibraryDataSource, id: string): void {
  const window_ = window.open('about:blank', '_blank');
  data.contentLink(id).subscribe({
    next: (url) => {
      if (window_) window_.location.href = url;
    },
    error: () => window_?.close(),
  });
}
