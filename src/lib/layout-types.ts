import type { TabType } from "./tabs";

export interface LayoutComponent {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  linkChannel: number | null;
  config: Record<string, unknown>;
}

export interface TabLayout {
  columns: number;
  rowHeight: number;
  zoom?: number;
  components: LayoutComponent[];
}

export interface TabState {
  id: string;
  title: string;
  type: TabType;
  locked: boolean;
  linkChannel: number | null;
  layout: TabLayout;
}

export interface WorkspaceFile {
  version: number;
  lastModified: string;
  global: {
    activeTabId: string;
  };
  tabs: TabState[];
}
