/**
 * Migration shim: shell lama digantikan AppShell (UI_REFACTOR_DESIGN §7.1).
 * Komposisi baru memakai ExpandableRail + FloatingDock + token baru.
 */
export { AppShell as WorkspaceShell } from '@/components/shell/app-shell';
