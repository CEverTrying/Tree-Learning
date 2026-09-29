// Shared by the renderer and service so new persisted UI state cannot silently
// invalidate the entire batch of drafts during shutdown.
export const workspaceKeys = [
  "treelearning-navigation",
  "treelearning-pages",
  "treelearning-sidebar-hidden",
  "treelearning-scroll",
  "treelearning-question-drafts",
  "treelearning-note-selected",
  "treelearning-note-drafts",
  "treelearning-note-width",
] as const;
export type WorkspaceKey = (typeof workspaceKeys)[number];
