/**
 * M26 — the design scaffold. Every surface renders through these; pages never
 * hand-roll layout. Numbers: ./constants.ts (the approved blueprint).
 */
export { SCAFFOLD } from "./constants";
export { PageContainer, PageHeader, Section } from "./Page";
export { SectionScroller } from "./SectionScroller";
export { Skeleton, SkeletonLines, SkeletonCards } from "./Skeleton";
export { PanelHeader } from "./PanelHeader";
export { FormPanel, FormRow, PanelFooter } from "./FormPanel";
export { SectionMenu, MenuLayout } from "./SectionMenu";
export type { MenuItem, MenuGroup } from "./SectionMenu";
export { ResizablePanel, MENU_PANEL, ASSISTANT_PANEL } from "./Resizable";
export type { PanelSpec } from "./Resizable";
