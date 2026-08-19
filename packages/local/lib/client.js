window.__ModuleLoader__.load({
  id: 'dsh-remote-desktop',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const ReactDOM = require('react-dom')
    const {
      Button, IconChevronDownOutline14, IconEllipsisOutline16, IconFolderClose16, IconFolderOpenOutline16,
      IconPersonalizationOutline16, IconPlusOutline16, IconProjectAddOutline16, IconSearchOutline16, Input, Menu, Modal, StateDot,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    exports.inject = ['slots', 'sessions', 'workspaces']

    // Official ui-workspace copy from deepseek-harness 9f8359451a6f8df17f65bc2c398810ac19bdfc8a.
    const OfficialWorkspace = (() => {
      const module = { exports: {} }
      const exports = module.exports
let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
            let react_jsx_runtime = require("react/jsx-runtime");
            let react = require("react");
            let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
            //#region lib/types/client/stores.js
            /**
            * The workspace browser's viewing store: the session-list grouping mode,
            * persisted across reloads. Module level exports the factory only (a
            * module-level handle would pin the store identity across plugin reloads);
            * register() receives the factory and the browser derives its PropsStore
            * share from the return type.
            */
            /** Browser-local order account for the hierarchy-free flat Session list. */
            const FLAT_SESSION_ORDER_KEY = "__flat_session_order__";
            /**
            * Create the workspace browser viewing store handle.
            * @returns the store handle (spec + type + identity + factory in one).
            */
            function createWorkspaceViewStore() {
                  return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
                        init: () => ({
                              groupBy: "workspace",
                              orderBy: "updated",
                              groupExpansion: {},
                              sessionOrderByAccount: {},
                              sessionUpdatedAtByAccount: {}
                        }),
                        persist: "dsh.workspace.view.v5",
                        actions: {
                              setGroupBy: (d, mode) => {
                                    d.groupBy = mode;
                              },
                              setOrderBy: (d, mode) => {
                                    d.orderBy = mode;
                              },
                              setGroupExpanded: (d, key, expanded) => {
                                    d.groupExpansion[key] = expanded;
                              },
                              retainAccountKeys: (d, workspaceKeys) => {
                                    const retained = new Set(workspaceKeys);
                                    d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)));
                                    d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)));
                                    d.sessionUpdatedAtByAccount = Object.fromEntries(Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)));
                              },
                              syncSessionOrderAccount: (d, accountKey, order, updatedAt) => {
                                    d.sessionOrderByAccount[accountKey] = order;
                                    d.sessionUpdatedAtByAccount[accountKey] = updatedAt;
                              },
                              setSessionOrder: (d, accountKey, order) => {
                                    d.sessionOrderByAccount[accountKey] = order;
                              }
                        }
                  });
            }
            //#endregion
            //#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
            function r(e) {
                  var t, f, n = "";
                  if ("string" == typeof e || "number" == typeof e) n += e;
                  else if ("object" == typeof e) if (Array.isArray(e)) {
                        var o = e.length;
                        for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
                  } else for (f in e) e[f] && (n && (n += " "), n += f);
                  return n;
            }
            function clsx() {
                  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
                  return n;
            }
            /** Display label for the ungrouped bucket row. */
            const UNGROUPED_LABEL = "Ungrouped";
            /**
            * Directory display label: basename of the path (both separators accepted).
            * Ungrouped-bucket fallback for surfaces without a workspace title.
            * @param cwd - directory path, or undefined for the ungrouped bucket.
            * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
            */
            function workspaceLabel(cwd) {
                  if (cwd === void 0 || cwd === "") return UNGROUPED_LABEL;
                  const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
                  return base !== void 0 && base !== "" ? base : cwd;
            }
            /** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
            function byRecency(a, b) {
                  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
                  return a.id < b.id ? -1 : 1;
            }
            /**
            * Ordinary sessions are visible; among blank sessions, only the current one
            * is visible. Subagent children use their parent header catalog; archived
            * sessions are visible nowhere, while their accounting slots remain so
            * unarchiving restores position.
            */
            function sessionVisible(session, current, archived) {
                  return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
            }
            /**
            * A blank session is the selected Workspace's provisional New Session row;
            * its canonical title never enters search (blank rows are query-excluded)
            * and the renderer localizes its display label.
            */
            function sessionTitle(session) {
                  return session.blank ? "New Session" : session.displayTitle;
            }
            /** Build one group without projecting session lineage into presentation. */
            function buildGroup(key, workspaceId, cwd, createdAt, label, members, order, remoteMarker) {
                  const sessions = [...members];
                  if (order === "recency") sessions.sort(byRecency);
                  return {
                        key,
                        workspaceId,
                        cwd,
                        createdAt,
                        label,
                        remoteMarker,
                        sessions
                  };
            }
            /** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
            function orderedUngrouped(members, stored) {
                  const byId = new Map(members.map((session) => [session.id, session]));
                  const included = /* @__PURE__ */ new Set();
                  const ordered = [];
                  for (const key of stored) {
                        const session = byId.get(key);
                        if (session === void 0 || included.has(key)) continue;
                        ordered.push(session);
                        included.add(key);
                  }
                  for (const session of [...members].sort(byRecency)) {
                        if (included.has(session.id)) continue;
                        ordered.push(session);
                  }
                  return ordered;
            }
            /**
            * Group Sessions by Host Workspace: one group per entity in stable Host
            * order, with members resolved from sessionIds in their stored order. Sessions
            * outside every Workspace trail in the browser-local Ungrouped order, which
            * falls back to recency before that order is initialized.
            */
            function groupByWorkspace(list, workspaces, archived, ungroupedOrder) {
                  const groups = [];
                  const accounted = /* @__PURE__ */ new Set();
                  for (const workspace of workspaces) {
                        const members = [];
                        for (const id of workspace.sessionIds) {
                              const summary = list.byId[id];
                              if (summary === void 0) continue;
                              accounted.add(id);
                              if (!sessionVisible(summary, list.current, archived)) continue;
                              members.push(summary);
                        }
                        groups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members, "account", workspace.remoteMarker));
                  }
                  const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && sessionVisible(s, list.current, archived));
                  if (stray.length > 0) groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));
                  return groups;
            }
            function sessionNode(s, descendants) {
                  return {
                        id: s.id,
                        title: sessionTitle(s),
                        blank: s.blank,
                        running: s.running,
                        runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
                        completed: s.completed === true,
                        updatedAt: s.updatedAt,
                        sourceKind: s.sourceKind,
                        sourceId: s.sourceId,
                        rawSessionId: s.rawSessionId,
                        ...s.pendingInteraction === void 0 ? {} : { pendingInteraction: s.pendingInteraction }
                  };
            }
            /**
            * Derive the workspace browser groups with every session as a top-level row.
            *
            * Every group shows; sessions populate under expanded groups in the selected
            * local order. Blank sessions are excluded except for the selected
            * provisional New Session row; archived sessions are excluded everywhere.
            * Content search lives outside this derivation
            * (see {@link deriveSearchResults}).
            * @param list - sessions list snapshot (`current` feeds containsCurrent).
            * @param workspaces - real workspaces in stable Host order.
            * @param archivedSessionIds - registry-global archive set.
            * @param view - local expansion arrays.
            * @returns group sections in render order.
            */
            function deriveGroups(list, workspaces, archivedSessionIds, view) {
                  const archived = new Set(archivedSessionIds);
                  const expandedGroups = new Set(view.expandedGroups);
                  const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
                  const currentGroup = list.current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(list.current))?.workspaceId ?? "";
                  const groups = [];
                  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
                        const expanded = expandedGroups.has(g.key) || g.remoteMarker !== void 0;
                        groups.push({
                              key: g.key,
                              workspaceId: g.workspaceId,
                              cwd: g.cwd,
                              createdAt: g.createdAt,
                              label: g.label,
                              remoteMarker: g.remoteMarker,
                              sessionCount: g.sessions.length,
                              expanded,
                              containsCurrent: g.key === currentGroup,
                              sessions: expanded ? g.sessions.map((session) => sessionNode(session, descendants)) : []
                        });
                  }
                  return groups;
            }
            /**
            * Derive the flat session list ("In one list" mode): every session — fork
            * children included — as a top-level row, strictly newest-first. No grouping,
            * no parent/child adjacency. Content search lives outside this derivation
            * (see {@link deriveSearchResults}).
            * @param list - sessions list snapshot.
            * @param archivedSessionIds - registry-global archive set.
            * @returns flat rows in render order.
            */
            function deriveFlat(list, archivedSessionIds) {
                  const archived = new Set(archivedSessionIds);
                  const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
                  const rows = [];
                  for (const id of list.ids) {
                        const s = list.byId[id];
                        if (s === void 0 || !sessionVisible(s, list.current, archived)) continue;
                        rows.push(s);
                  }
                  rows.sort(byRecency);
                  return rows.map((session) => sessionNode(session, descendants));
            }
            /**
            * Merge immediate title/Workspace substring matches with ranked Host content
            * matches. Local rows lead newest-first, content-only rows retain backend
            * order, and duplicate sessions receive the backend snippet in place.
            * @param list - session metadata authority.
            * @param workspaces - Workspace membership and display labels.
            * @param query - caller text; surrounding whitespace is ignored.
            * @param archivedSessionIds - registry-global archive set (members never match).
            * @param content - ranked Host content-search page.
            * @param limit - protocol-owned maximum merged row count.
            * @returns bounded deduplicated flat rows and a refine-query hint bit.
            */
            function deriveSearchResults(list, workspaces, query, archivedSessionIds, content, limit) {
                  const q = query.trim().toLowerCase();
                  if (q === "") return {
                        items: [],
                        hasMore: false
                  };
                  const archived = new Set(archivedSessionIds);
                  const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
                  const workspaceBySession = /* @__PURE__ */ new Map();
                  for (const workspace of workspaces) for (const sessionId of workspace.sessionIds) if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title);
                  const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd);
                  const contentBySession = /* @__PURE__ */ new Map();
                  for (const item of content.items) if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item);
                  const local = [];
                  for (const id of list.ids) {
                        const summary = list.byId[id];
                        if (summary === void 0 || summary.blank || !sessionVisible(summary, list.current, archived)) continue;
                        if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary);
                  }
                  local.sort(byRecency);
                  const ordered = [];
                  const included = /* @__PURE__ */ new Set();
                  const include = (summary) => {
                        if (included.has(summary.id)) return;
                        included.add(summary.id);
                        ordered.push(summary);
                  };
                  for (const summary of local) include(summary);
                  for (const item of content.items) {
                        const summary = list.byId[item.sessionId];
                        if (summary !== void 0 && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary);
                  }
                  return {
                        items: ordered.slice(0, limit).map((summary) => {
                              const match = contentBySession.get(summary.id);
                              return {
                                    id: summary.id,
                                    title: sessionTitle(summary),
                                    workspace: labelOf(summary),
                                    running: summary.running,
                                    runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
                                    ...summary.pendingInteraction === void 0 ? {} : { pendingInteraction: summary.pendingInteraction },
                                    completed: summary.completed === true,
                                    ...match === void 0 ? {} : { snippet: match.snippet }
                              };
                        }),
                        hasMore: content.hasMore || ordered.length > limit
                  };
            }
            /**
            * Compact relative time for session rows, as a structured bucket the
            * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
            * @param updatedAt - epoch ms of the session's last activity.
            * @param now - current epoch ms (injected for pure rendering).
            * @returns the row's trailing time bucket and magnitude.
            */
            function relativeTime(updatedAt, now) {
                  const MIN = 6e4;
                  const HOUR = 36e5;
                  const DAY = 864e5;
                  const diff = Math.max(0, now - updatedAt);
                  if (diff < MIN) return {
                        unit: "now",
                        n: 0
                  };
                  if (diff < HOUR) return {
                        unit: "minutes",
                        n: Math.floor(diff / MIN)
                  };
                  if (diff < DAY) return {
                        unit: "hours",
                        n: Math.floor(diff / HOUR)
                  };
                  if (diff < 30 * DAY) return {
                        unit: "days",
                        n: Math.floor(diff / DAY)
                  };
                  if (diff < 365 * DAY) return {
                        unit: "months",
                        n: Math.floor(diff / (30 * DAY))
                  };
                  return {
                        unit: "years",
                        n: Math.floor(diff / (365 * DAY))
                  };
            }
            //#endregion
            //#region \0dsh-css:/Users/i060912/SAPDevelop/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.module.css.mjs
            const css$2 = ".khCZja_projectRow,.khCZja_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex}.khCZja_projectRow:hover,.khCZja_sessionRow:hover,.khCZja_sessionRow.khCZja_selected{background:var(--dsw-alias-interactive-bg-hover)}.khCZja_searchResultRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:48px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}.khCZja_searchResultRow:hover,.khCZja_searchResultRow.khCZja_selected{background:var(--dsw-alias-interactive-bg-hover)}.khCZja_searchResultHeading{align-items:center;min-width:0;display:flex}.khCZja_searchResultTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-left:4px;font-size:14px;line-height:20px;overflow:hidden}.khCZja_searchResultMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}.khCZja_searchResultWorkspace,.khCZja_searchResultSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}.khCZja_searchResultWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}.khCZja_searchResultSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}.khCZja_projectRow{box-sizing:border-box;align-items:center;height:34px}.khCZja_projectRow .khCZja_rowActions{height:20px}.khCZja_sessionRow{height:32px;animation:khCZja_row-in .15s var(--ds-ease-in-out);gap:0}.khCZja_sessionRow .khCZja_title{margin:0 6px 0 4px}.khCZja_flatSessionRowWithoutStatus .khCZja_title{margin-left:0}@keyframes khCZja_row-in{0%{opacity:0}}.khCZja_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.khCZja_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.khCZja_folderActive{color:var(--dsw-alias-state-business-primary)}.khCZja_projectRow .khCZja_chevron{display:none}.khCZja_projectRow:hover .khCZja_chevron{display:inline-flex}.khCZja_projectRow:hover .khCZja_folder{display:none}.khCZja_arrow{transition:transform .15s var(--ds-ease-in-out)}.khCZja_arrowOpen{transform:rotate(90deg)}.khCZja_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.khCZja_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden}.khCZja_renameInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);min-width:0;color:inherit;border-radius:4px;outline:none;padding:0 2px;font-size:14px;line-height:20px}.khCZja_sessionRow .khCZja_title{flex:1}.khCZja_meta{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;overflow:hidden}.khCZja_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}.khCZja_dot{flex:none}.khCZja_rowActions{flex:none;align-items:center;gap:12px;display:none}.khCZja_projectRow:hover .khCZja_rowActions,.khCZja_sessionRow:hover .khCZja_rowActions,.khCZja_projectRow.khCZja_menuOpen .khCZja_rowActions,.khCZja_sessionRow.khCZja_menuOpen .khCZja_rowActions{display:inline-flex}.khCZja_sessionRow:hover .khCZja_time,.khCZja_sessionRow.khCZja_menuOpen .khCZja_time{display:none}.khCZja_projectRow.khCZja_menuOpen,.khCZja_sessionRow.khCZja_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}.khCZja_sessionRow.khCZja_dropBefore,.khCZja_sessionRow.khCZja_dropAfter{position:relative}.khCZja_sessionRow.khCZja_dropBefore:before,.khCZja_sessionRow.khCZja_dropAfter:after{content:\"\";z-index:1;background:linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat, linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat, linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;pointer-events:none;height:12px;position:absolute;left:0;right:4px}.khCZja_sessionRow.khCZja_dropBefore:before{top:-7px}.khCZja_sessionRow.khCZja_dropAfter:after{bottom:-7px}.khCZja_hoverContent{flex-direction:column;gap:8px;display:flex}.khCZja_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.khCZja_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}.khCZja_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}.khCZja_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}.khCZja_iconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.khCZja_iconButton:hover{color:var(--dsw-alias-label-primary)}.khCZja_chevron{color:var(--dsw-alias-label-caption)}@media (prefers-reduced-motion:reduce){.khCZja_sessionRow,.khCZja_arrow{transition:none;animation:none}}";
            const tagId$2 = "@deepseek-ai/dsh-client-ui-workspace/Rows.module.css";
            if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
                  const tag = document.createElement("style");
                  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";
                  tag.dataset.pluginCss = tagId$2;
                  tag.textContent = css$2;
                  document.head.appendChild(tag);
            }
            var Rows_module_css_default = {
                  "hoverStatus": "khCZja_hoverStatus",
                  "hoverPath": "khCZja_hoverPath",
                  "hoverTime": "khCZja_hoverTime",
                  "folderActive": "khCZja_folderActive",
                  "time": "khCZja_time",
                  "sessionRow": "khCZja_sessionRow",
                  "visuallyHidden": "khCZja_visuallyHidden",
                  "menuOpen": "khCZja_menuOpen",
                  "meta": "khCZja_meta",
                  "title": "khCZja_title",
                  "searchResultWorkspace": "khCZja_searchResultWorkspace",
                  "chevron": "khCZja_chevron",
                  "searchResultHeading": "khCZja_searchResultHeading",
                  "slot": "khCZja_slot",
                  "dropAfter": "khCZja_dropAfter",
                  "folder": "khCZja_folder",
                  "selected": "khCZja_selected",
                  "searchResultMeta": "khCZja_searchResultMeta",
                  "row-in": "khCZja_row-in",
                  "searchResultSnippet": "khCZja_searchResultSnippet",
                  "hoverTitle": "khCZja_hoverTitle",
                  "flatSessionRowWithoutStatus": "khCZja_flatSessionRowWithoutStatus",
                  "projectText": "khCZja_projectText",
                  "dot": "khCZja_dot",
                  "renameInput": "khCZja_renameInput",
                  "hoverContent": "khCZja_hoverContent",
                  "dropBefore": "khCZja_dropBefore",
                  "projectRow": "khCZja_projectRow",
                  "searchResultRow": "khCZja_searchResultRow",
                  "arrow": "khCZja_arrow",
                  "searchResultTitle": "khCZja_searchResultTitle",
                  "arrowOpen": "khCZja_arrowOpen",
                  "iconButton": "khCZja_iconButton",
                  "rowActions": "khCZja_rowActions"
            };
            //#endregion
            //#region lib/types/client/rows/Rows.js
            /**
            * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
            * all data and callbacks arrive via props. Hover swaps (folder->chevron,
            * time->ellipsis, action buttons) are CSS-only. Row ... menus are visual-only
            * except workspace Rename/Delete and session Rename/Fork/Archive; the session
            * and workspace hover cards are suppressed while a menu is open.
            */
            /** Row display title: blank rows show the localized New Session label. */
            function displayTitle(node, t) {
                  return node.blank ? t("session.new") : node.title;
            }
            /** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
            function timeLabel(updatedAt, now, t) {
                  const { unit, n } = relativeTime(updatedAt, now);
                  return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
            }
            /** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
            function hoverTimeLabel(updatedAt, now, t) {
                  const { unit, n } = relativeTime(updatedAt, now);
                  return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
            }
            /**
            * Absolute creation time through the dictionary's date template (the message
            * clock pattern): `toLocaleString` would follow the browser language, not the
            * app locale, and produce mixed-language text after a switch.
            */
            function createdLabel(createdAt, t) {
                  const d = new Date(createdAt);
                  const pad2 = (v) => String(v).padStart(2, "0");
                  return t("hover.created", { time: `${t("date.ymd", {
                        y: d.getFullYear(),
                        m: d.getMonth() + 1,
                        d: d.getDate()
                  })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
            }
            /** Hover-card body: workspace title, full directory path, absolute creation time. */
            function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: Rows_module_css_default.hoverContent,
                        children: [
                              (0, react_jsx_runtime.jsx)("div", {
                                    className: Rows_module_css_default.hoverTitle,
                                    children: label
                              }),
                              (0, react_jsx_runtime.jsx)("div", {
                                    className: Rows_module_css_default.hoverPath,
                                    children: cwd
                              }),
                              (0, react_jsx_runtime.jsx)("div", {
                                    className: Rows_module_css_default.hoverTime,
                                    children: createdLabel(createdAt, t)
                              })
                        ]
                  });
            }
            /** Pointer-position half of a row (insert line above or below). */
            function rowHalf(e) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            }
            /**
            * Project (workspace) header row: folder + title;
            * hover reveals the chevron and create button, and dwelling on a real
            * Workspace shows its hover card (the ungrouped bucket has none).
            * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
            * @param props.group - derived group node.
            * @param props.onToggle - expand/collapse the group.
            * @param props.onCreate - start a frontend Session inside this Workspace.
            * @param props.drag - optional workspace-row drag wiring.
            * @param props.t - the browser root's locale seat.
            * @returns the row element.
            */
            function ProjectRowItem({ group, onToggle, onCreate, actions, drag, t }) {
                  const row = group;
                  const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;
                  const active = group.expanded && group.containsCurrent;
                  const [menuOpen, setMenuOpen] = (0, react.useState)(false);
                  const workspaceMenuItems = [{
                        id: "rename",
                        label: t("rename"),
                        icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
                  }, {
                        id: "delete",
                        label: t("delete.workspace"),
                        icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
                        danger: true
                  }];
                  const ownRow = (0, react_jsx_runtime.jsxs)("div", {
                        className: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),
                        role: "treeitem",
                        "aria-expanded": row.expanded,
                        "data-rd-workspace-source-kind": row.remoteMarker !== void 0 ? "remote" : "local",
                        "data-rd-workspace-id": row.workspaceId,
                        onClick: onToggle,
                        draggable: drag !== void 0,
                        onDragStart: drag === void 0 ? void 0 : (e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", row.key);
                              drag.start();
                        },
                        onDragEnd: drag?.end,
                        children: [
                              (0, react_jsx_runtime.jsx)("span", {
                                    className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),
                                    children: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})
                              }),
                              (0, react_jsx_runtime.jsx)("span", {
                                    className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),
                                    children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, row.expanded && Rows_module_css_default.arrowOpen) })
                              }),
                              (0, react_jsx_runtime.jsx)("span", {
                                    className: Rows_module_css_default.projectText,
                                    children: (0, react_jsx_runtime.jsx)("span", {
                                          className: Rows_module_css_default.title,
                                          children: label
                                    })
                              }),
                              row.remoteMarker !== void 0 && (0, react_jsx_runtime.jsxs)("span", {
                                    title: row.remoteMarker.label,
                                    "aria-label": `Remote host ${row.remoteMarker.label}`,
                                    "data-rd-host-marker": row.remoteMarker.id,
                                    style: { flex: "none", display: "inline-flex", alignItems: "center", gap: 10, color: "var(--dsw-alias-label-tertiary)", fontSize: 12, lineHeight: "20px" },
                                    children: [(0, react_jsx_runtime.jsx)("span", { children: row.remoteMarker.label }), (0, react_jsx_runtime.jsx)("span", { style: { flex: "none", width: 8, height: 8, borderRadius: 999, background: row.remoteMarker.color } })]
                              }),
                              (0, react_jsx_runtime.jsxs)("span", {
                                    className: Rows_module_css_default.rowActions,
                                    children: [actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
                                          open: menuOpen,
                                          onClose: () => {
                                                setMenuOpen(false);
                                          },
                                          items: workspaceMenuItems,
                                          onSelect: (id) => {
                                                setMenuOpen(false);
                                                /* v8 ignore next -- workspaceMenuItems carries exactly these two rows today. */
                                                if (id !== "rename" && id !== "delete") return;
                                                if (id === "rename") actions.rename();
                                                else actions.delete();
                                          },
                                          portal: true,
                                          closeOnPointerLeave: true,
                                          anchor: (0, react_jsx_runtime.jsx)("button", {
                                                type: "button",
                                                className: Rows_module_css_default.iconButton,
                                                "aria-label": t("actions.workspace.aria", { name: label }),
                                                onClick: (e) => {
                                                      e.stopPropagation();
                                                      setMenuOpen((v) => !v);
                                                },
                                                children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
                                          })
                                    }), (0, react_jsx_runtime.jsx)("button", {
                                          type: "button",
                                          className: Rows_module_css_default.iconButton,
                                          "aria-label": t("actions.newSession.aria", { name: label }),
                                          onClick: (e) => {
                                                e.stopPropagation();
                                                onCreate();
                                          },
                                          children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
                                    })]
                              })
                        ]
                  });
                  if (row.createdAt === void 0) return ownRow;
                  return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
                        anchor: ownRow,
                        content: (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {
                              label: row.label,
                              cwd: row.cwd,
                              createdAt: row.createdAt,
                              t
                        }),
                        disabled: menuOpen,
                        copyText: row.cwd,
                        copyLabel: t("copy"),
                        copiedLabel: t("hover.copied")
                  });
            }
            /* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
            function assertNever(value) {
                  throw new Error(`unknown pending interaction: ${String(value)}`);
            }
            /**
            * Session status presentation; pending interaction is primary and live activity
            * outranks completion reminders.
            */
            function sessionStatuses(node, t) {
                  const subagents = node.runningSubagentCount === 0 ? void 0 : {
                        state: "ongoing",
                        label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
                  };
                  let pending;
                  switch (node.pendingInteraction) {
                        case "approval":
                              pending = {
                                    state: "warning",
                                    label: t("status.waitingApproval")
                              };
                              break;
                        case "plan-review":
                              pending = {
                                    state: "warning",
                                    label: t("status.planReview")
                              };
                              break;
                        case "question":
                              pending = {
                                    state: "warning",
                                    label: t("status.waitingAnswer")
                              };
                              break;
                        case void 0: break;
                        /* v8 ignore next -- closed PendingInteractionStatus union */
                        default: return assertNever(node.pendingInteraction);
                  }
                  if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
                  if (node.running) {
                        const primary = {
                              state: "ongoing",
                              label: t("status.running")
                        };
                        return subagents === void 0 ? [primary] : [primary, subagents];
                  }
                  if (subagents !== void 0) return [subagents];
                  if (node.completed) return [{
                        state: "done",
                        label: t("status.completed")
                  }];
                  return [{
                        state: "done",
                        label: t("status.idle")
                  }];
            }
            /** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
            function SessionStatusDots({ statuses }) {
                  return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: statuses[0].state }), statuses.map((status) => (0, react_jsx_runtime.jsx)("span", {
                        className: Rows_module_css_default.visuallyHidden,
                        children: status.label
                  }, status.label))] });
            }
            /** Hover-card body: full title, relative time, and every relevant live status. */
            function SessionHoverContent({ node, now, t }) {
                  const statuses = sessionStatuses(node, t);
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: Rows_module_css_default.hoverContent,
                        children: [
                              (0, react_jsx_runtime.jsx)("div", {
                                    className: Rows_module_css_default.hoverTitle,
                                    children: displayTitle(node, t)
                              }),
                              !node.blank && (0, react_jsx_runtime.jsx)("div", {
                                    className: Rows_module_css_default.hoverTime,
                                    children: hoverTimeLabel(node.updatedAt, now, t)
                              }),
                              statuses.map((status) => (0, react_jsx_runtime.jsxs)("div", {
                                    className: Rows_module_css_default.hoverStatus,
                                    children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status.state }), (0, react_jsx_runtime.jsx)("span", { children: status.label })]
                              }, status.label))
                        ]
                  });
            }
            /**
            * One flat search result: title, Workspace context, and optional content
            * excerpt. Search navigation opens the session only; it does not address an
            * event inside the conversation.
            * @param props.result - merged local/content search row.
            * @param props.currentId - selected session id.
            * @param props.onOpen - open the selected session.
            * @param props.t - Workspace-browser translation seat.
            * @returns the result button.
            */
            function SearchResultItem({ result, currentId, onOpen, t }) {
                  const selected = result.id === currentId;
                  const statuses = sessionStatuses(result, t);
                  const primaryStatus = statuses[0];
                  return (0, react_jsx_runtime.jsxs)("button", {
                        type: "button",
                        className: clsx(Rows_module_css_default.searchResultRow, selected && Rows_module_css_default.selected),
                        role: "treeitem",
                        "aria-selected": selected,
                        onClick: () => {
                              onOpen(result.id);
                        },
                        children: [(0, react_jsx_runtime.jsxs)("span", {
                              className: Rows_module_css_default.searchResultHeading,
                              children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: Rows_module_css_default.slot,
                                    children: (primaryStatus.state !== "done" || result.completed) && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
                              }), (0, react_jsx_runtime.jsx)("span", {
                                    className: Rows_module_css_default.searchResultTitle,
                                    children: result.title
                              })]
                        }), (0, react_jsx_runtime.jsxs)("span", {
                              className: Rows_module_css_default.searchResultMeta,
                              children: [(0, react_jsx_runtime.jsx)("span", {
                                    className: Rows_module_css_default.searchResultWorkspace,
                                    children: result.workspace
                              }), result.snippet !== void 0 && (0, react_jsx_runtime.jsx)("span", {
                                    className: Rows_module_css_default.searchResultSnippet,
                                    children: result.snippet
                              })]
                        })]
                  });
            }
            /**
            * One top-level 34px session row: status dot (pending user interaction outranks
            * own or descendant activity), title, relative time, and the row actions menu.
            * @param props.node - derived session node.
            * @param props.currentId - selected session id (row highlight).
            * @param props.now - epoch ms for relative-time formatting.
            * @param props.onOpen - open a session by id.
            * @param props.onRename - open the session rename dialog (id + current title).
            * @param props.onFork - fork a session at its last completed turn.
            * @param props.onArchive - archive a session by id.
            * @param props.drag - optional draggable-row wiring.
            * @param props.flat - omit the empty status slot in the hierarchy-free flat list.
            * @param props.t - the browser root's locale seat.
            * @returns the session row.
            */
            function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {
                  const row = node;
                  const title = displayTitle(node, t);
                  const selected = node.id === currentId;
                  const statuses = sessionStatuses(node, t);
                  const showStatus = statuses[0].state !== "done" || row.completed;
                  const [menuOpen, setMenuOpen] = (0, react.useState)(false);
                  const sessionMenuItems = [
                        {
                              id: "rename",
                              label: t("rename"),
                              icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
                        },
                        {
                              id: "fork",
                              label: t("menu.fork"),
                              icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
                        },
                        {
                              id: "archive",
                              label: t("menu.archiveSession"),
                              icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })
                        }
                  ];
                  return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
                        anchor: (0, react_jsx_runtime.jsxs)("div", {
                              className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),
                              role: "treeitem",
                              "aria-selected": selected,
                              "data-rd-session-source-id": node.sourceId,
                              ...node.sourceKind === "remote" ? { "data-rd-remote-session-id": node.rawSessionId, "data-rd-source-id": node.sourceId } : { "data-rd-local-session-id": node.rawSessionId ?? node.id },
                              onClick: () => {
                                    onOpen(node.id);
                              },
                              draggable: drag !== void 0,
                              onDragStart: drag === void 0 ? void 0 : (e) => {
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", node.id);
                                    drag.start();
                              },
                              onDragEnd: drag?.end,
                              onDragOver: drag === void 0 ? void 0 : (e) => {
                                    if (!drag.active) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    drag.hover(rowHalf(e));
                              },
                              onDrop: drag === void 0 ? void 0 : (e) => {
                                    if (!drag.active) return;
                                    e.preventDefault();
                                    drag.drop(rowHalf(e));
                              },
                              children: [
                                    (!flat || showStatus) && (0, react_jsx_runtime.jsx)("span", {
                                          className: Rows_module_css_default.slot,
                                          children: showStatus && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
                                    }),
                                    (0, react_jsx_runtime.jsx)("span", {
                                          className: Rows_module_css_default.title,
                                          children: title
                                    }),
                                    !row.blank && (0, react_jsx_runtime.jsx)("span", {
                                          className: Rows_module_css_default.time,
                                          children: timeLabel(row.updatedAt, now, t)
                                    }),
                                    !row.blank && (0, react_jsx_runtime.jsx)("span", {
                                          className: Rows_module_css_default.rowActions,
                                          children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
                                                open: menuOpen,
                                                onClose: () => {
                                                      setMenuOpen(false);
                                                },
                                                items: sessionMenuItems,
                                                onSelect: (id) => {
                                                      setMenuOpen(false);
                                                      if (id === "rename") onRename(node.id, row.title);
                                                      if (id === "fork") onFork(node.id);
                                                      if (id === "archive") onArchive(node.id);
                                                },
                                                portal: true,
                                                closeOnPointerLeave: true,
                                                anchor: (0, react_jsx_runtime.jsx)("button", {
                                                      type: "button",
                                                      className: Rows_module_css_default.iconButton,
                                                      "aria-label": t("actions.session.aria", { name: title }),
                                                      onClick: (e) => {
                                                            e.stopPropagation();
                                                            setMenuOpen((v) => !v);
                                                      },
                                                      children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
                                                })
                                          })
                                    })
                              ]
                        }),
                        content: (0, react_jsx_runtime.jsx)(SessionHoverContent, {
                              node,
                              now,
                              t
                        }),
                        disabled: menuOpen || drag?.active === true,
                        copyText: row.blank ? void 0 : row.title,
                        copyLabel: t("copy"),
                        copiedLabel: t("hover.copied")
                  });
            }
            //#endregion
            //#region \0dsh-css:/Users/i060912/SAPDevelop/deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.module.css.mjs
            const css$1 = ".AcsHGG_modalAction{min-width:72px}.AcsHGG_modalError,.AcsHGG_menuStatus{margin-top:8px;font-size:12px;line-height:18px}.AcsHGG_modalError{color:var(--dsw-alias-state-error-primary)}.AcsHGG_menuStatus{color:var(--dsw-alias-label-secondary)}";
            const tagId$1 = "@deepseek-ai/dsh-client-ui-workspace/WorkspacePicker.module.css";
            if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
                  const tag = document.createElement("style");
                  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";
                  tag.dataset.pluginCss = tagId$1;
                  tag.textContent = css$1;
                  document.head.appendChild(tag);
            }
            var WorkspacePicker_module_css_default = {
                  "modalAction": "AcsHGG_modalAction",
                  "menuStatus": "AcsHGG_menuStatus",
                  "modalError": "AcsHGG_modalError"
            };
            //#endregion
            //#region lib/types/client/WorkspacePicker.js
            const ADD_WORKSPACE = "::add-workspace";
            /**
            * Render the pick menu plus the adoption error dialog.
            * @param props - owner-controlled flow props.
            * @returns menu + dialog elements.
            */
            function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, side = "bottom", selectedId }) {
                  const workspaceSnapshot = useWorkspaces((state) => state);
                  const workspaces = workspaceSnapshot.items;
                  const getAnchorRect = (0, react.useCallback)(() => anchorRef?.current?.getBoundingClientRect() ?? null, [anchorRef]);
                  const [errorOpen, setErrorOpen] = (0, react.useState)(false);
                  const [modalError, setModalError] = (0, react.useState)(null);
                  const [flowOpen, setFlowOpen] = (0, react.useState)(false);
                  const [pickingFolder, setPickingFolder] = (0, react.useState)(false);
                  const flowBusy = flowOpen || pickingFolder;
                  const flowAvailable = useDirectoryFlow((occupied) => occupied);
                  (0, react.useEffect)(() => {
                        if (flowOpen && !flowAvailable) setFlowOpen(false);
                  }, [flowOpen, flowAvailable]);
                  const addEntries = flowAvailable ? [{
                        id: ADD_WORKSPACE,
                        label: t("menu.addWorkspace"),
                        icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 16 }),
                        disabled: flowBusy
                  }] : [];
                  const pinAdd = !addOnly && workspaces.length > 0;
                  const items = pinAdd ? workspaces.map((workspace) => ({
                        id: workspace.workspaceId,
                        label: workspace.title,
                        icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, { size: 16 }),
                        disabled: flowBusy
                  })) : addEntries;
                  const menuIsEmpty = items.length === 0;
                  const closeModal = () => {
                        setErrorOpen(false);
                        setModalError(null);
                  };
                  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
                  const adoptDirectory = (path) => createWorkspace({ path }).then((workspace) => {
                        setFlowOpen(false);
                        onPick(workspace.workspaceId);
                  }).catch((reason) => {
                        setModalError(reason instanceof Error ? reason.message : String(reason));
                        setFlowOpen(false);
                        setErrorOpen(true);
                  });
                  const openDirectoryFlow = (0, react.useCallback)(() => {
                        onClose();
                        setErrorOpen(false);
                        setModalError(null);
                        setFlowOpen(true);
                  }, [onClose]);
                  const listSettled = addOnly || workspaceSnapshot.phase === "ready";
                  const addIsTheOnlyEntry = !pinAdd && listSettled && addEntries.length === 1;
                  (0, react.useEffect)(() => {
                        if (open && addIsTheOnlyEntry && !flowBusy) openDirectoryFlow();
                  }, [
                        open,
                        addIsTheOnlyEntry,
                        flowBusy,
                        openDirectoryFlow
                  ]);
                  /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
                  const flowOwner = {
                        open: flowOpen,
                        busy: pickingFolder,
                        onPicked: (path) => {
                              setPickingFolder(true);
                              adoptDirectory(path).finally(() => {
                                    setPickingFolder(false);
                              });
                        },
                        onCancel: () => {
                              setFlowOpen(false);
                        },
                        onError: (message) => {
                              setFlowOpen(false);
                              setModalError(message);
                              setErrorOpen(true);
                        }
                  };
                  const handleSelect = (id) => {
                        if (id === ADD_WORKSPACE) {
                              openDirectoryFlow();
                              return;
                        }
                        onPick(id);
                  };
                  return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
                        (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
                              open: open && !addIsTheOnlyEntry && !menuIsEmpty,
                              anchor: null,
                              items,
                              ...pinAdd ? { footer: addEntries } : {},
                              selectedId,
                              onSelect: handleSelect,
                              onClose,
                              side,
                              portal: true,
                              getAnchorRect
                        }),
                        open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === "pending" && (0, react_jsx_runtime.jsx)("div", {
                              className: WorkspacePicker_module_css_default.menuStatus,
                              role: "status",
                              children: t("picker.loading")
                        }),
                        renderDirectoryFlow(flowOwner),
                        (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
                              open: errorOpen,
                              onClose: closeModal,
                              closeLabel: t("close"),
                              title: t("folderError.title"),
                              footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                    variant: "outline",
                                    className: WorkspacePicker_module_css_default.modalAction,
                                    onClick: closeModal,
                                    children: t("cancel")
                              }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                    variant: "primary",
                                    className: WorkspacePicker_module_css_default.modalAction,
                                    disabled: !flowAvailable,
                                    onClick: openDirectoryFlow,
                                    children: t("folderError.retry")
                              })] }),
                              children: (0, react_jsx_runtime.jsx)("div", {
                                    className: WorkspacePicker_module_css_default.modalError,
                                    role: "alert",
                                    children: modalError
                              })
                        })
                  ] });
            }
            /**
            * The conversation empty-state registration: adapts the owner share to the
            * core flow (all state and semantics live in the flow / the owner).
            * @param props - empty-state slot props (owner share + injected creation callback).
            * @returns the flow element.
            */
            function WorkspacePicker({ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, useDirectoryFlow, renderSlot, t }) {
                  return (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
                        t,
                        open,
                        anchorRef,
                        useWorkspaces,
                        createWorkspace,
                        useDirectoryFlow,
                        renderDirectoryFlow: (owner) => renderSlot("conversation.hero.workspace.directoryFlow", owner),
                        selectedId,
                        onPick,
                        onClose
                  });
            }
            //#endregion
            //#region \0dsh-css:/Users/i060912/SAPDevelop/deepseek-harness/packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css.mjs
            const css = ".C7iCvG_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);flex-direction:column;flex:1;display:flex}.C7iCvG_root.C7iCvG_rail{padding-right:0}.C7iCvG_iconButton{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.C7iCvG_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.C7iCvG_sectionHeader{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex;overflow:hidden}.C7iCvG_root:not(.C7iCvG_rail) .C7iCvG_sectionHeader{margin-top:2px;margin-right:-4px}.C7iCvG_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;transition:max-width .18s var(--ds-ease-in-out), margin-right .18s var(--ds-ease-in-out), opacity .12s var(--ds-ease-in-out), transform .18s var(--ds-ease-in-out), visibility 0s linear;flex:none;line-height:20px;overflow:hidden}.C7iCvG_sectionLabelHidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;transition-delay:0s,0s,0s,0s,.18s;transform:translate(-4px)}.C7iCvG_searchSlot{box-sizing:border-box;min-width:0;max-width:28px;transition:max-width .18s var(--ds-ease-in-out), padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}.C7iCvG_searchSlotExpanded{max-width:100%;padding-left:0}.C7iCvG_headerActions{opacity:1;visibility:visible;max-width:60px;transition:max-width .18s var(--ds-ease-in-out), opacity .12s var(--ds-ease-in-out), transform .18s var(--ds-ease-in-out), visibility 0s linear;flex:none;align-items:center;gap:4px;display:flex;overflow:hidden}.C7iCvG_headerActionsHidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0;transition-delay:0s,0s,0s,.18s;transform:translate(4px)}.C7iCvG_search{box-sizing:border-box;cursor:text;width:100%;height:28px;color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out), padding .18s var(--ds-ease-in-out), border-color .18s var(--ds-ease-in-out), background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}.C7iCvG_searchExpanded{border:1px solid var(--dsw-alias-border-l2);width:calc(100% + 4px);height:30px;color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}.C7iCvG_searchButton{cursor:pointer;width:28px;height:28px;color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.C7iCvG_searchExpanded .C7iCvG_searchButton{width:28px;height:30px}.C7iCvG_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.C7iCvG_searchExpanded .C7iCvG_searchButton:hover{background:0 0}.C7iCvG_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}.C7iCvG_searchExpanded .C7iCvG_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}.C7iCvG_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}.C7iCvG_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.C7iCvG_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.C7iCvG_rail .C7iCvG_sectionHeader{justify-content:flex-start;gap:0;margin-bottom:12px;padding-left:0}.C7iCvG_rail .C7iCvG_headerActions{max-width:none}.C7iCvG_rail .C7iCvG_iconButton{width:36px;height:36px;color:var(--dsw-alias-label-primary)}.C7iCvG_rail .C7iCvG_search{background:0 0;border-color:#0000;gap:0;width:36px;height:36px;margin:0 0 12px;padding:0}.C7iCvG_rail .C7iCvG_searchButton{width:36px;height:36px;color:var(--dsw-alias-label-primary)}.C7iCvG_rail .C7iCvG_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.C7iCvG_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}.C7iCvG_rail .C7iCvG_listArea{margin-left:0;margin-right:0;padding-left:0}.C7iCvG_treeBody{flex-direction:column;flex:1;min-height:0;display:flex;position:relative}.C7iCvG_fade{left:0;right:var(--dsh-session-list-edge-inset);background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));pointer-events:none;height:24px;position:absolute;bottom:0}.C7iCvG_wide{animation:C7iCvG_wide-in .2s var(--ds-ease-in-out)}@keyframes C7iCvG_wide-in{0%{opacity:0}}.C7iCvG_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:16px;overflow-y:auto}.C7iCvG_flatList>*+*,.C7iCvG_searchTree>[role=treeitem]+[role=treeitem],.C7iCvG_groupSection>*+*{margin-top:2px}.C7iCvG_searchStatus,.C7iCvG_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}.C7iCvG_searchWarning{color:var(--dsw-alias-label-secondary)}.C7iCvG_groupSection{position:relative}.C7iCvG_groupSection+.C7iCvG_groupSection{margin-top:4px}.C7iCvG_listTopDropIndicator,.C7iCvG_workspaceDropBefore:before,.C7iCvG_workspaceDropAfter:after{content:\"\";z-index:1;background:linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat, linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat, linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;pointer-events:none;height:12px;position:absolute;left:0;right:0}.C7iCvG_listTopDropIndicator{top:-8px;left:0;right:var(--dsh-session-list-edge-inset)}.C7iCvG_listTopDropActive>.C7iCvG_workspaceDropBefore:first-child:before{display:none}.C7iCvG_workspaceDropBefore:before{top:-8px}.C7iCvG_workspaceDropAfter:after{bottom:-8px}.C7iCvG_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:28px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:12px}.C7iCvG_groupSection>.C7iCvG_sessionOverflowButton{margin-top:0}.C7iCvG_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}.C7iCvG_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}.C7iCvG_renameInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}.C7iCvG_renameInput:disabled{color:var(--dsw-alias-label-dimmed)}.C7iCvG_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}.C7iCvG_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}.C7iCvG_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}@media (prefers-reduced-motion:reduce){.C7iCvG_wide{animation:none}.C7iCvG_search,.C7iCvG_sectionLabel,.C7iCvG_searchSlot,.C7iCvG_searchInput,.C7iCvG_headerActions{transition:none}}";
            const tagId = "@deepseek-ai/dsh-client-ui-workspace/WorkspaceBrowser.module.css";
            if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
                  const tag = document.createElement("style");
                  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";
                  tag.dataset.pluginCss = tagId;
                  tag.textContent = css;
                  document.head.appendChild(tag);
            }
            var WorkspaceBrowser_module_css_default = {
                  "fade": "C7iCvG_fade",
                  "empty": "C7iCvG_empty",
                  "headerActionsHidden": "C7iCvG_headerActionsHidden",
                  "sectionLabel": "C7iCvG_sectionLabel",
                  "searchSlotExpanded": "C7iCvG_searchSlotExpanded",
                  "list": "C7iCvG_list",
                  "searchTree": "C7iCvG_searchTree",
                  "groupSection": "C7iCvG_groupSection",
                  "searchWarning": "C7iCvG_searchWarning",
                  "searchExpanded": "C7iCvG_searchExpanded",
                  "headerActions": "C7iCvG_headerActions",
                  "workspaceDropAfter": "C7iCvG_workspaceDropAfter",
                  "renameError": "C7iCvG_renameError",
                  "searchInput": "C7iCvG_searchInput",
                  "root": "C7iCvG_root",
                  "rail": "C7iCvG_rail",
                  "search": "C7iCvG_search",
                  "searchSlot": "C7iCvG_searchSlot",
                  "renameInput": "C7iCvG_renameInput",
                  "sessionOverflowButton": "C7iCvG_sessionOverflowButton",
                  "flatList": "C7iCvG_flatList",
                  "searchStatus": "C7iCvG_searchStatus",
                  "treeBody": "C7iCvG_treeBody",
                  "listTopDropIndicator": "C7iCvG_listTopDropIndicator",
                  "wide": "C7iCvG_wide",
                  "sectionLabelHidden": "C7iCvG_sectionLabelHidden",
                  "deleteAction": "C7iCvG_deleteAction",
                  "iconButton": "C7iCvG_iconButton",
                  "deleteStatus": "C7iCvG_deleteStatus",
                  "listArea": "C7iCvG_listArea",
                  "sectionHeader": "C7iCvG_sectionHeader",
                  "workspaceDropBefore": "C7iCvG_workspaceDropBefore",
                  "clearButton": "C7iCvG_clearButton",
                  "listTopDropActive": "C7iCvG_listTopDropActive",
                  "wide-in": "C7iCvG_wide-in",
                  "searchButton": "C7iCvG_searchButton"
            };
            //#endregion
            //#region lib/types/client/WorkspaceBrowser.js
            /**
            * The workspace/session browsing region filling the sidebar shell's
            * `sidebar.workspaces` hole: section header (title + view options + add
            * workspace), search, the grouped tree or flat list, and the workspace
            * dialogs. Wide state renders the full browser; rail state renders the two
            * region icons (search / add workspace) as 36px controls on the shell's shared
            * rail entry path, each requesting expansion through the owner share. Adding
            * is the header button's one action, so it raises the directory flow with no
            * menu in between; the flow and its error dialog live in WorkspacePicker
            * (same package — direct composition, no slot between them).
            */
            /**
            * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
            * focus() forces a synchronous layout and would jank the slide.
            */
            const EXPAND_SLIDE_MS = 300;
            /** Pause between the latest keystroke and a Host content-search request. */
            const SEARCH_DEBOUNCE_MS = 250;
            /** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
            const SEARCH_QUERY_MAX_CODE_UNITS = 500;
            /** Session rows visible per Workspace before the local overflow control. */
            const COLLAPSED_SESSION_LIMIT = 5;
            /** Keep controlled input and RPC payload inside the session.search wire contract. */
            function sanitizeSearchQuery(value) {
                  const withoutNul = value.replaceAll("\0", "");
                  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
                  let end = SEARCH_QUERY_MAX_CODE_UNITS;
                  const last = withoutNul.charCodeAt(end - 1);
                  const next = withoutNul.charCodeAt(end);
                  if (last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343) end--;
                  return withoutNul.slice(0, end);
            }
            /** Immutable membership toggle for the local expand-all array. */
            function toggled(list, key) {
                  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
            }
            /**
            * Accept the native drag at document level while a row drag is active: row
            * hover still owns the insertion marker, and releasing outside the list must
            * not be rendered as a rejected drop before dragend commits that last marker.
            */
            function useNativeDragAcceptance(active) {
                  (0, react.useEffect)(() => {
                        if (!active) return;
                        const acceptDrag = (event) => {
                              event.preventDefault();
                              if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
                        };
                        const acceptDrop = (event) => {
                              event.preventDefault();
                        };
                        document.addEventListener("dragover", acceptDrag);
                        document.addEventListener("drop", acceptDrop);
                        return () => {
                              document.removeEventListener("dragover", acceptDrag);
                              document.removeEventListener("drop", acceptDrop);
                        };
                  }, [active]);
            }
            /** Reconcile a stored view order with the Workspace's current session account. */
            function reconciledSessionOrder(sessionIds, stored) {
                  if (stored === void 0) return [...sessionIds];
                  const byId = new Map(sessionIds.map((id) => [id, id]));
                  const ordered = [];
                  const included = /* @__PURE__ */ new Set();
                  for (const key of stored) {
                        const id = byId.get(key);
                        if (id === void 0 || included.has(key)) continue;
                        ordered.push(id);
                        included.add(key);
                  }
                  for (const id of sessionIds) {
                        if (included.has(id)) continue;
                        ordered.push(id);
                  }
                  return ordered;
            }
            /** Newest update first with stable Session identity as the tie-break. */
            function compareSessionRecency(a, b, byId) {
                  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY;
                  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY;
                  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt;
                  return a < b ? -1 : 1;
            }
            /** Reconcile one editable order account and apply its activity-promotion policy. */
            function nextSessionOrderAccount({ sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency }) {
                  let order = reconciledSessionOrder(sessionIds, previousOrder);
                  if (sortByRecency) order.sort((a, b) => compareSessionRecency(a, b, list.byId));
                  else if (orderBy === "updated") {
                        const promoted = sessionIds.filter((id) => {
                              const session = list.byId[id];
                              return session !== void 0 && (previousUpdatedAt[id] === void 0 || session.updatedAt > previousUpdatedAt[id]);
                        }).sort((a, b) => compareSessionRecency(a, b, list.byId));
                        if (promoted.length > 0) {
                              const promotedIds = new Set(promoted);
                              order = [...promoted, ...order.filter((id) => !promotedIds.has(id))];
                        }
                  }
                  const updatedAt = {};
                  for (const id of sessionIds) {
                        const session = list.byId[id];
                        if (session !== void 0) updatedAt[id] = session.updatedAt;
                  }
                  const orderChanged = previousOrder === void 0 || order.length !== previousOrder.length || order.some((id, index) => id !== previousOrder[index]);
                  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp);
                  return {
                        order,
                        updatedAt,
                        changed: orderChanged || timestampsChanged
                  };
            }
            /** Grouping and ordering menu; own open state so it resets with the wide chrome. */
            function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }) {
                  const [open, setOpen] = (0, react.useState)(false);
                  return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
                        open,
                        onClose: () => {
                              setOpen(false);
                        },
                        items: [
                              {
                                    type: "label",
                                    id: "group-by",
                                    text: t("groupBy.label")
                              },
                              {
                                    id: "workspace",
                                    label: t("groupBy.workspace")
                              },
                              {
                                    id: "flat",
                                    label: t("groupBy.flat")
                              },
                              {
                                    type: "separator",
                                    id: "order-by-separator"
                              },
                              {
                                    type: "label",
                                    id: "order-by",
                                    text: t("orderBy.label")
                              },
                              {
                                    id: "manual",
                                    label: t("orderBy.manual")
                              },
                              {
                                    id: "updated",
                                    label: t("orderBy.updated")
                              }
                        ],
                        selectedIds: [groupBy, orderBy],
                        onSelect: (id) => {
                              if (id === "workspace" || id === "flat") onGroupPick(id);
                              else if (id === "manual" || id === "updated") onOrderPick(id);
                              setOpen(false);
                        },
                        align: "end",
                        dense: true,
                        portal: true,
                        anchor: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
                              label: t("viewOptions.label"),
                              side: "bottom",
                              delayMs: 500,
                              children: (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: clsx(WorkspaceBrowser_module_css_default.iconButton, WorkspaceBrowser_module_css_default.wide),
                                    "aria-label": t("viewOptions.label"),
                                    onClick: () => {
                                          setOpen((v) => !v);
                                    },
                                    children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPersonalizationOutline16, {})
                              })
                        })
                  });
            }
            /** Resolve an insertion side from the full rendered workspace group. */
            function workspaceGroupHalf(e) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            }
            /** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
            function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {
                  const list = useSessions((s) => s);
                  const current = list.current;
                  const [expandedSessionGroups, setExpandedSessionGroups] = (0, react.useState)([]);
                  const [drag, setDrag] = (0, react.useState)(null);
                  const sessionDropCommitted = (0, react.useRef)(false);
                  const [workspaceDrag, setWorkspaceDrag] = (0, react.useState)(null);
                  const workspaceDropCommitted = (0, react.useRef)(false);
                  const previousOrderBy = (0, react.useRef)(orderBy);
                  useNativeDragAcceptance(drag !== null || workspaceDrag !== null);
                  const currentGroup = current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(current))?.workspaceId ?? "";
                  (0, react.useEffect)(() => {
                        if (current === void 0 || currentGroup === void 0 || Object.hasOwn(groupExpansion, currentGroup)) return;
                        setGroupExpanded(currentGroup, true);
                  }, [
                        current,
                        currentGroup,
                        setGroupExpanded,
                        groupExpansion
                  ]);
                  const expandedGroups = (0, react.useMemo)(() => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key), [groupExpansion]);
                  const ungroupedSessionIds = (0, react.useMemo)(() => {
                        const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
                        return list.ids.filter((id) => list.byId[id] !== void 0 && !accounted.has(id));
                  }, [list, workspaces]);
                  (0, react.useEffect)(() => {
                        if (list.phase !== "ready") return;
                        const switchedToUpdated = previousOrderBy.current !== "updated" && orderBy === "updated";
                        previousOrderBy.current = orderBy;
                        const accounts = [...workspaces.map((workspace) => ({
                              key: workspace.workspaceId,
                              sessionIds: workspace.sessionIds.filter((id) => list.byId[id] !== void 0)
                        })), {
                              key: "",
                              sessionIds: ungroupedSessionIds
                        }];
                        for (const { key, sessionIds } of accounts) {
                              const previousOrder = sessionOrderByAccount[key];
                              const next = nextSessionOrderAccount({
                                    sessionIds,
                                    previousOrder,
                                    previousUpdatedAt: sessionUpdatedAtByAccount[key] ?? {},
                                    list,
                                    orderBy,
                                    sortByRecency: orderBy === "updated" && (previousOrder === void 0 || switchedToUpdated)
                              });
                              if (next.changed) syncSessionOrderAccount(key, next.order.map((id) => id), next.updatedAt);
                        }
                  }, [
                        list,
                        orderBy,
                        sessionOrderByAccount,
                        sessionUpdatedAtByAccount,
                        syncSessionOrderAccount,
                        ungroupedSessionIds,
                        workspaces
                  ]);
                  const orderedWorkspaces = (0, react.useMemo)(() => {
                        return workspaces.map((workspace) => {
                              const stored = sessionOrderByAccount[workspace.workspaceId];
                              const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored);
                              return {
                                    ...workspace,
                                    sessionIds
                              };
                        });
                  }, [sessionOrderByAccount, workspaces]);
                  const orderedUngroupedSessionIds = (0, react.useMemo)(() => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[""]), [sessionOrderByAccount, ungroupedSessionIds]);
                  const groups = (0, react.useMemo)(() => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
                        expandedGroups,
                        ...sessionOrderByAccount[""] === void 0 ? {} : { ungroupedOrder: sessionOrderByAccount[""] }
                  }), [
                        list,
                        orderedWorkspaces,
                        archivedSessionIds,
                        expandedGroups,
                        sessionOrderByAccount
                  ]);
                  const now = Date.now();
                  const commitSessionDrag = (activeDrag, over) => {
                        if (sessionDropCommitted.current) return;
                        sessionDropCommitted.current = true;
                        setDrag(null);
                        const group = groups.find((candidate) => candidate.key === activeDrag.accountKey);
                        if (group === void 0) return;
                        const targetIndex = group.sessions.findIndex((session) => session.id === over.id);
                        if (targetIndex === -1) return;
                        const anchor = over.half === "before" ? over.id : group.sessions[targetIndex + 1]?.id;
                        if (anchor === activeDrag.sessionId) return;
                        const sourceIndex = group.sessions.findIndex((session) => session.id === activeDrag.sessionId);
                        const anchorIndex = anchor === void 0 ? group.sessions.length : group.sessions.findIndex((session) => session.id === anchor);
                        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
                        const accountSessionIds = activeDrag.accountKey === "" ? orderedUngroupedSessionIds : orderedWorkspaces.find((workspace) => workspace.workspaceId === activeDrag.accountKey)?.sessionIds;
                        if (accountSessionIds === void 0) return;
                        const nextOrder = accountSessionIds.filter((id) => id !== activeDrag.sessionId);
                        const insertAt = anchor === void 0 ? nextOrder.length : nextOrder.indexOf(anchor);
                        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
                        setSessionOrder(activeDrag.accountKey, nextOrder.map((id) => id));
                        if (orderBy === "updated" || activeDrag.accountKey === "") return;
                        insertSessionBefore(activeDrag.accountKey, activeDrag.sessionId, anchor).catch((reason) => {
                              console.warn("session reorder rejected:", reason);
                        });
                  };
                  const commitWorkspaceDrag = (activeDrag, over) => {
                        if (workspaceDropCommitted.current) return;
                        workspaceDropCommitted.current = true;
                        setWorkspaceDrag(null);
                        const rowIndex = workspaces.findIndex((workspace) => workspace.workspaceId === over.id);
                        if (rowIndex === -1) return;
                        const anchor = over.half === "before" ? over.id : workspaces[rowIndex + 1]?.workspaceId;
                        if (anchor === activeDrag.workspaceId) return;
                        const sourceIndex = workspaces.findIndex((workspace) => workspace.workspaceId === activeDrag.workspaceId);
                        const anchorIndex = anchor === void 0 ? workspaces.length : workspaces.findIndex((workspace) => workspace.workspaceId === anchor);
                        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
                        insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
                              console.warn("workspace reorder rejected:", reason);
                        });
                  };
                  const workspaceDropAtListStart = groups[0]?.workspaceId !== void 0 && workspaceDrag?.over?.id === groups[0].workspaceId && workspaceDrag.over.half === "before";
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
                        children: [
                              workspaceDropAtListStart && (0, react_jsx_runtime.jsx)("span", {
                                    className: WorkspaceBrowser_module_css_default.listTopDropIndicator,
                                    "aria-hidden": "true"
                              }),
                              (0, react_jsx_runtime.jsxs)("div", {
                                    className: clsx(WorkspaceBrowser_module_css_default.list, workspaceDropAtListStart && WorkspaceBrowser_module_css_default.listTopDropActive),
                                    role: "tree",
                                    "aria-label": t("section.sessions"),
                                    children: [groups.length === 0 && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.empty,
                                          children: t("empty.none")
                                    }), groups.map((group) => {
                                          const workspaceId = group.workspaceId;
                                          const workspaceMarker = workspaceId !== void 0 && workspaceDrag?.over?.id === workspaceId ? workspaceDrag.over.half : null;
                                          const workspaceDragProps = workspaceId === void 0 ? void 0 : {
                                                start: () => {
                                                      workspaceDropCommitted.current = false;
                                                      setWorkspaceDrag({
                                                            workspaceId,
                                                            over: null
                                                      });
                                                },
                                                end: () => {
                                                      if (workspaceDrag?.over !== null && workspaceDrag?.over !== void 0) commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
                                                      else setWorkspaceDrag(null);
                                                      workspaceDropCommitted.current = false;
                                                }
                                          };
                                          const hoverWorkspace = workspaceId === void 0 ? void 0 : (half) => {
                                                setWorkspaceDrag((active) => active === null ? active : {
                                                      ...active,
                                                      over: {
                                                            id: workspaceId,
                                                            half
                                                      }
                                                });
                                          };
                                          const dropWorkspace = workspaceId === void 0 ? void 0 : (half) => {
                                                if (workspaceDrag === null) return;
                                                commitWorkspaceDrag(workspaceDrag, {
                                                      id: workspaceId,
                                                      half
                                                });
                                          };
                                          return (0, react_jsx_runtime.jsxs)("div", {
                                                className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),
                                                onDragOver: workspaceDrag === null || hoverWorkspace === void 0 ? void 0 : (e) => {
                                                      e.preventDefault();
                                                      e.dataTransfer.dropEffect = "move";
                                                      hoverWorkspace(workspaceGroupHalf(e));
                                                },
                                                onDrop: workspaceDrag === null || dropWorkspace === void 0 ? void 0 : (e) => {
                                                      e.preventDefault();
                                                      dropWorkspace(workspaceGroupHalf(e));
                                                },
                                                children: [
                                                      (0, react_jsx_runtime.jsx)(ProjectRowItem, {
                                                            group,
                                                            t,
                                                            onToggle: () => {
                                                                  if (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key));
                                                                  setGroupExpanded(group.key, !group.expanded);
                                                            },
                                                            onCreate: () => {
                                                                  if (group.workspaceId !== void 0) {
                                                                        setGroupExpanded(group.key, true);
                                                                        startSession(group.workspaceId);
                                                                  }
                                                            },
                                                            drag: workspaceDragProps,
                                                            actions: group.workspaceId === void 0 ? void 0 : {
                                                                  rename: () => {
                                                                        /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                                                                        if (group.workspaceId !== void 0) onRenameRequest(group.workspaceId, group.label);
                                                                  },
                                                                  delete: () => {
                                                                        /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                                                                        if (group.workspaceId !== void 0) onDeleteRequest(group.workspaceId, group.label);
                                                                  }
                                                            }
                                                      }),
                                                      (expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {
                                                            const sameGroupDrag = drag !== null && drag.accountKey === group.key;
                                                            return (0, react_jsx_runtime.jsx)(SessionNodeItem, {
                                                                  node,
                                                                  currentId: current,
                                                                  now,
                                                                  onOpen: open,
                                                                  onRename: onSessionRename,
                                                                  onFork: forkSession,
                                                                  onArchive: onSessionArchive,
                                                                  drag: {
                                                                        start: () => {
                                                                              sessionDropCommitted.current = false;
                                                                              setDrag({
                                                                                    accountKey: group.key,
                                                                                    sessionId: node.id,
                                                                                    over: null
                                                                              });
                                                                        },
                                                                        active: sameGroupDrag,
                                                                        marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                                                                        hover: (half) => {
                                                                              /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                                                                              setDrag((d) => d === null ? d : {
                                                                                    ...d,
                                                                                    over: {
                                                                                          id: node.id,
                                                                                          half
                                                                                    }
                                                                              });
                                                                        },
                                                                        drop: (half) => {
                                                                              /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                                                                              if (drag === null) return;
                                                                              commitSessionDrag(drag, {
                                                                                    id: node.id,
                                                                                    half
                                                                              });
                                                                        },
                                                                        end: () => {
                                                                              if (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);
                                                                              else setDrag(null);
                                                                              sessionDropCommitted.current = false;
                                                                        }
                                                                  },
                                                                  t
                                                            }, node.id);
                                                      }),
                                                      group.sessions.length > COLLAPSED_SESSION_LIMIT && (0, react_jsx_runtime.jsx)("button", {
                                                            type: "button",
                                                            className: WorkspaceBrowser_module_css_default.sessionOverflowButton,
                                                            "aria-expanded": expandedSessionGroups.includes(group.key),
                                                            onClick: () => {
                                                                  setExpandedSessionGroups((keys) => toggled(keys, group.key));
                                                            },
                                                            children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
                                                      })
                                                ]
                                          }, group.key);
                                    })]
                              }),
                              (0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })
                        ]
                  });
            }
            /** The flat "In one list" body: every session is one draggable top-level row. */
            function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {
                  const list = useSessions((s) => s);
                  const baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);
                  const sessionIds = (0, react.useMemo)(() => baseRows.map((row) => row.id), [baseRows]);
                  const previousOrderBy = (0, react.useRef)(orderBy);
                  (0, react.useEffect)(() => {
                        if (list.phase !== "ready") return;
                        const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY];
                        const previousUpdatedAt = sessionUpdatedAtByAccount["__flat_session_order__"] ?? {};
                        const switchedToUpdated = previousOrderBy.current !== "updated" && orderBy === "updated";
                        previousOrderBy.current = orderBy;
                        const next = nextSessionOrderAccount({
                              sessionIds,
                              previousOrder,
                              previousUpdatedAt,
                              list,
                              orderBy,
                              sortByRecency: orderBy === "updated" && (previousOrder === void 0 || switchedToUpdated)
                        });
                        if (next.changed) syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map((id) => id), next.updatedAt);
                  }, [
                        list,
                        orderBy,
                        sessionOrderByAccount,
                        sessionUpdatedAtByAccount,
                        sessionIds,
                        syncSessionOrderAccount
                  ]);
                  const rows = (0, react.useMemo)(() => {
                        const byId = new Map(baseRows.map((row) => [row.id, row]));
                        return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]).flatMap((id) => {
                              const row = byId.get(id);
                              return row === void 0 ? [] : [row];
                        });
                  }, [
                        baseRows,
                        sessionOrderByAccount,
                        sessionIds
                  ]);
                  const [drag, setDrag] = (0, react.useState)(null);
                  const dropCommitted = (0, react.useRef)(false);
                  useNativeDragAcceptance(drag !== null);
                  const commitDrag = (activeDrag, over) => {
                        if (dropCommitted.current) return;
                        dropCommitted.current = true;
                        setDrag(null);
                        const targetIndex = rows.findIndex((row) => row.id === over.id);
                        if (targetIndex === -1) return;
                        const anchor = over.half === "before" ? over.id : rows[targetIndex + 1]?.id;
                        if (anchor === activeDrag.sessionId) return;
                        const sourceIndex = rows.findIndex((row) => row.id === activeDrag.sessionId);
                        const anchorIndex = anchor === void 0 ? rows.length : rows.findIndex((row) => row.id === anchor);
                        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
                        const nextOrder = rows.map((row) => row.id).filter((id) => id !== activeDrag.sessionId);
                        const insertAt = anchor === void 0 ? nextOrder.length : nextOrder.indexOf(anchor);
                        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
                        setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map((id) => id));
                  };
                  const now = Date.now();
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
                        children: [(0, react_jsx_runtime.jsxs)("div", {
                              className: clsx(WorkspaceBrowser_module_css_default.list, WorkspaceBrowser_module_css_default.flatList),
                              role: "tree",
                              "aria-label": t("section.sessions"),
                              children: [rows.length === 0 && (0, react_jsx_runtime.jsx)("div", {
                                    className: WorkspaceBrowser_module_css_default.empty,
                                    children: t("empty.none")
                              }), rows.map((node) => {
                                    const active = drag !== null;
                                    return (0, react_jsx_runtime.jsx)(SessionNodeItem, {
                                          node,
                                          currentId: list.current,
                                          now,
                                          onOpen: open,
                                          onRename: onSessionRename,
                                          onFork: forkSession,
                                          onArchive: onSessionArchive,
                                          flat: true,
                                          drag: {
                                                start: () => {
                                                      dropCommitted.current = false;
                                                      setDrag({
                                                            accountKey: FLAT_SESSION_ORDER_KEY,
                                                            sessionId: node.id,
                                                            over: null
                                                      });
                                                },
                                                active,
                                                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                                                hover: (half) => {
                                                      setDrag((current) => current === null ? current : {
                                                            ...current,
                                                            over: {
                                                                  id: node.id,
                                                                  half
                                                            }
                                                      });
                                                },
                                                drop: (half) => {
                                                      if (drag !== null) commitDrag(drag, {
                                                            id: node.id,
                                                            half
                                                      });
                                                },
                                                end: () => {
                                                      if (drag?.over !== null && drag?.over !== void 0) commitDrag(drag, drag.over);
                                                      else setDrag(null);
                                                      dropCommitted.current = false;
                                                }
                                          },
                                          t
                                    }, node.id);
                              })]
                        }), (0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })]
                  });
            }
            /** Flat search body: local metadata matches plus the current Host result page. */
            function SearchResults({ useSessions, open, workspaces, archivedSessionIds, query, remote, resultLimit, t }) {
                  const list = useSessions((s) => s);
                  const currentRemote = remote.query === query ? remote : {
                        query,
                        status: "loading",
                        items: [],
                        hasMore: false
                  };
                  const results = (0, react.useMemo)(() => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit), [
                        list,
                        workspaces,
                        query,
                        archivedSessionIds,
                        currentRemote,
                        resultLimit
                  ]);
                  const pending = currentRemote.status === "loading";
                  const failed = currentRemote.status === "error";
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
                        children: [(0, react_jsx_runtime.jsxs)("div", {
                              className: WorkspaceBrowser_module_css_default.list,
                              children: [
                                    (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.searchTree,
                                          role: "tree",
                                          "aria-label": t("search.results.aria"),
                                          children: results.items.map((result) => (0, react_jsx_runtime.jsx)(SearchResultItem, {
                                                result,
                                                currentId: list.current,
                                                onOpen: open,
                                                t
                                          }, result.id))
                                    }),
                                    pending && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.searchStatus,
                                          role: "status",
                                          children: t("search.pending")
                                    }),
                                    failed && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.searchWarning,
                                          role: "status",
                                          children: t("search.unavailable")
                                    }),
                                    !pending && results.items.length === 0 && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.empty,
                                          children: t("search.noMatches")
                                    }),
                                    results.hasMore && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.searchStatus,
                                          children: t("search.hasMore", { n: resultLimit })
                                    })
                              ]
                        }), (0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })]
                  });
            }
            /**
            * Render the browsing region.
            * @param props - composed slot props (shell owner share + store + injected actions).
            * @returns the region element tree.
            */
            function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, renderSlot, t }) {
                  const workspaces = useWorkspaces((state) => state.items);
                  const workspacePhase = useWorkspaces((state) => state.phase);
                  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
                  const directoryFlowAvailable = useDirectoryFlow((occupied) => occupied);
                  const groupBy = useStore((s) => s.groupBy);
                  const orderBy = useStore((s) => s.orderBy);
                  const groupExpansion = useStore((s) => s.groupExpansion);
                  const sessionOrderByAccount = useStore((s) => s.sessionOrderByAccount);
                  const sessionUpdatedAtByAccount = useStore((s) => s.sessionUpdatedAtByAccount);
                  (0, react.useEffect)(() => {
                        if (workspacePhase !== "ready") return;
                        actions.retainAccountKeys([
                              "",
                              FLAT_SESSION_ORDER_KEY,
                              ...workspaces.map((workspace) => workspace.workspaceId)
                        ]);
                  }, [
                        actions.retainAccountKeys,
                        workspacePhase,
                        workspaces
                  ]);
                  const [query, setQuery] = (0, react.useState)("");
                  const [searchExpanded, setSearchExpanded] = (0, react.useState)(false);
                  const normalizedQuery = sanitizeSearchQuery(query).trim();
                  const [remoteSearch, setRemoteSearch] = (0, react.useState)({
                        query: "",
                        status: "idle",
                        items: [],
                        hasMore: false
                  });
                  const searchRoot = (0, react.useRef)(null);
                  const searchInput = (0, react.useRef)(null);
                  const [wsPickerOpen, setWsPickerOpen] = (0, react.useState)(false);
                  const wsPlusRef = (0, react.useRef)(null);
                  const composingRef = (0, react.useRef)(false);
                  const [searchOnExpand, setSearchOnExpand] = (0, react.useState)(false);
                  (0, react.useEffect)(() => {
                        if (wide && searchOnExpand) {
                              const timer = window.setTimeout(() => {
                                    searchInput.current?.focus({ preventScroll: true });
                                    setSearchOnExpand(false);
                              }, EXPAND_SLIDE_MS);
                              return () => {
                                    window.clearTimeout(timer);
                              };
                        }
                  }, [wide, searchOnExpand]);
                  (0, react.useEffect)(() => {
                        if (!wide || !searchExpanded || searchOnExpand) return;
                        searchInput.current?.focus({ preventScroll: true });
                  }, [
                        wide,
                        searchExpanded,
                        searchOnExpand
                  ]);
                  (0, react.useEffect)(() => {
                        if (!wide || !searchExpanded) return;
                        const onClick = (event) => {
                              if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
                              searchInput.current?.blur();
                              if (normalizedQuery !== "") return;
                              setSearchExpanded(false);
                        };
                        document.addEventListener("click", onClick);
                        return () => {
                              document.removeEventListener("click", onClick);
                        };
                  }, [
                        normalizedQuery,
                        wide,
                        searchExpanded
                  ]);
                  (0, react.useEffect)(() => {
                        if (normalizedQuery === "") {
                              setRemoteSearch({
                                    query: "",
                                    status: "idle",
                                    items: [],
                                    hasMore: false
                              });
                              return;
                        }
                        const controller = new AbortController();
                        setRemoteSearch({
                              query: normalizedQuery,
                              status: "loading",
                              items: [],
                              hasMore: false
                        });
                        const timer = window.setTimeout(() => {
                              searchSessions(normalizedQuery, controller.signal).then((result) => {
                                    if (controller.signal.aborted) return;
                                    setRemoteSearch({
                                          query: normalizedQuery,
                                          status: "ready",
                                          items: result.items,
                                          hasMore: result.hasMore
                                    });
                              }).catch(() => {
                                    if (controller.signal.aborted) return;
                                    setRemoteSearch({
                                          query: normalizedQuery,
                                          status: "error",
                                          items: [],
                                          hasMore: false
                                    });
                              });
                        }, SEARCH_DEBOUNCE_MS);
                        return () => {
                              window.clearTimeout(timer);
                              controller.abort();
                        };
                  }, [normalizedQuery, searchSessions]);
                  const [renameTarget, setRenameTarget] = (0, react.useState)(null);
                  const [renameDraft, setRenameDraft] = (0, react.useState)("");
                  const [renaming, setRenaming] = (0, react.useState)(false);
                  const [renameError, setRenameError] = (0, react.useState)(null);
                  const renameTrimmed = renameDraft.trim();
                  const renameDuplicate = renameTarget !== null && renameTrimmed !== "" && renameTrimmed !== renameTarget.currentTitle && workspaces.some((w) => w.title === renameTrimmed);
                  const renameBlocked = renaming || renameTrimmed === "" || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate;
                  const closeRename = () => {
                        if (renaming) return;
                        setRenameTarget(null);
                        setRenameError(null);
                  };
                  const confirmRename = () => {
                        if (renameBlocked) return;
                        setRenaming(true);
                        setRenameError(null);
                        renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
                              setRenaming(false);
                              setRenameTarget(null);
                        }).catch((reason) => {
                              setRenaming(false);
                              setRenameError(reason instanceof Error ? reason.message : String(reason));
                        });
                  };
                  const [sessionRenameTarget, setSessionRenameTarget] = (0, react.useState)(null);
                  const [sessionRenameDraft, setSessionRenameDraft] = (0, react.useState)("");
                  const [sessionRenaming, setSessionRenaming] = (0, react.useState)(false);
                  const [sessionRenameError, setSessionRenameError] = (0, react.useState)(null);
                  const sessionRenameTrimmed = sessionRenameDraft.trim();
                  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === "" || sessionRenameTarget === null;
                  const closeSessionRename = () => {
                        if (sessionRenaming) return;
                        setSessionRenameTarget(null);
                        setSessionRenameError(null);
                  };
                  const confirmSessionRename = () => {
                        if (sessionRenameBlocked) return;
                        setSessionRenaming(true);
                        setSessionRenameError(null);
                        renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
                              setSessionRenaming(false);
                              setSessionRenameTarget(null);
                        }).catch((reason) => {
                              setSessionRenaming(false);
                              setSessionRenameError(reason instanceof Error ? reason.message : String(reason));
                        });
                  };
                  const onSessionRename = (sessionId, currentTitle) => {
                        setSessionRenameTarget({
                              sessionId,
                              currentTitle
                        });
                        setSessionRenameDraft(currentTitle);
                        setSessionRenameError(null);
                  };
                  const onSessionArchive = (sessionId) => {
                        archiveSession(sessionId).catch((reason) => {
                              console.warn("session archive rejected:", reason);
                        });
                  };
                  const [deleteTarget, setDeleteTarget] = (0, react.useState)(null);
                  const [deleting, setDeleting] = (0, react.useState)(false);
                  const [deleteCommittedId, setDeleteCommittedId] = (0, react.useState)(null);
                  const [deleteError, setDeleteError] = (0, react.useState)(null);
                  (0, react.useEffect)(() => {
                        if (deleteCommittedId === null || workspaces.some((workspace) => workspace.workspaceId === deleteCommittedId)) return;
                        setDeleting(false);
                        setDeleteCommittedId(null);
                        setDeleteTarget(null);
                  }, [deleteCommittedId, workspaces]);
                  const closeDelete = () => {
                        if (deleting) return;
                        setDeleteTarget(null);
                        setDeleteError(null);
                  };
                  const confirmDelete = () => {
                        /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
                        if (deleting || deleteTarget === null) return;
                        setDeleting(true);
                        setDeleteCommittedId(null);
                        setDeleteError(null);
                        deleteWorkspace(deleteTarget.workspaceId).then(() => {
                              setDeleteCommittedId(deleteTarget.workspaceId);
                        }).catch((reason) => {
                              setDeleting(false);
                              setDeleteError(reason instanceof Error ? reason.message : String(reason));
                        });
                  };
                  return (0, react_jsx_runtime.jsxs)("div", {
                        className: clsx(WorkspaceBrowser_module_css_default.root, !wide && WorkspaceBrowser_module_css_default.rail),
                        children: [
                              (0, react_jsx_runtime.jsxs)("div", {
                                    className: WorkspaceBrowser_module_css_default.sectionHeader,
                                    children: [
                                          wide && (0, react_jsx_runtime.jsx)("span", {
                                                className: clsx(WorkspaceBrowser_module_css_default.sectionLabel, WorkspaceBrowser_module_css_default.wide, searchExpanded && WorkspaceBrowser_module_css_default.sectionLabelHidden),
                                                children: groupBy === "flat" ? t("section.sessions") : t("section.workspaces")
                                          }),
                                          wide && (0, react_jsx_runtime.jsx)("div", {
                                                className: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),
                                                children: (0, react_jsx_runtime.jsxs)("div", {
                                                      ref: searchRoot,
                                                      className: clsx(WorkspaceBrowser_module_css_default.search, searchExpanded && WorkspaceBrowser_module_css_default.searchExpanded),
                                                      onClick: () => {
                                                            setWsPickerOpen(false);
                                                            setSearchExpanded(true);
                                                            searchInput.current?.focus();
                                                      },
                                                      children: [
                                                            (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
                                                                  label: t("search"),
                                                                  side: "bottom",
                                                                  delayMs: 500,
                                                                  disabled: searchExpanded,
                                                                  children: (0, react_jsx_runtime.jsx)("button", {
                                                                        type: "button",
                                                                        className: WorkspaceBrowser_module_css_default.searchButton,
                                                                        "aria-label": t("search.sessions.aria"),
                                                                        "aria-expanded": searchExpanded,
                                                                        onClick: () => {
                                                                              setWsPickerOpen(false);
                                                                              setSearchExpanded(true);
                                                                        },
                                                                        children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: searchExpanded ? 11 : 14 })
                                                                  })
                                                            }),
                                                            (0, react_jsx_runtime.jsx)("input", {
                                                                  ref: searchInput,
                                                                  className: WorkspaceBrowser_module_css_default.searchInput,
                                                                  type: "text",
                                                                  placeholder: t("search.placeholder"),
                                                                  maxLength: SEARCH_QUERY_MAX_CODE_UNITS,
                                                                  value: query,
                                                                  tabIndex: searchExpanded ? 0 : -1,
                                                                  onChange: (e) => {
                                                                        setQuery(sanitizeSearchQuery(e.target.value));
                                                                  },
                                                                  onKeyDown: (e) => {
                                                                        if (e.key !== "Escape") return;
                                                                        setQuery("");
                                                                        setSearchExpanded(false);
                                                                  }
                                                            }),
                                                            searchExpanded && (0, react_jsx_runtime.jsx)("button", {
                                                                  type: "button",
                                                                  className: WorkspaceBrowser_module_css_default.clearButton,
                                                                  "aria-label": t("search.clear"),
                                                                  onClick: (e) => {
                                                                        e.stopPropagation();
                                                                        setQuery("");
                                                                        setSearchExpanded(false);
                                                                  },
                                                                  children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFill14, {})
                                                            })
                                                      ]
                                                })
                                          }),
                                          (0, react_jsx_runtime.jsxs)("div", {
                                                className: clsx(WorkspaceBrowser_module_css_default.headerActions, wide && searchExpanded && WorkspaceBrowser_module_css_default.headerActionsHidden),
                                                children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {
                                                      groupBy,
                                                      orderBy,
                                                      onGroupPick: (mode) => {
                                                            actions.setGroupBy(mode);
                                                      },
                                                      onOrderPick: (mode) => {
                                                            actions.setOrderBy(mode);
                                                      },
                                                      t
                                                }), directoryFlowAvailable && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
                                                      label: t("workspace.add"),
                                                      side: "bottom",
                                                      delayMs: 500,
                                                      children: (0, react_jsx_runtime.jsx)("button", {
                                                            ref: wsPlusRef,
                                                            type: "button",
                                                            className: WorkspaceBrowser_module_css_default.iconButton,
                                                            "aria-label": t("workspace.add"),
                                                            onClick: () => {
                                                                  setWsPickerOpen((v) => !v);
                                                            },
                                                            children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })
                                                      })
                                                })]
                                          }),
                                          (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
                                                t,
                                                open: wsPickerOpen,
                                                anchorRef: wsPlusRef,
                                                useWorkspaces,
                                                createWorkspace,
                                                useDirectoryFlow,
                                                renderDirectoryFlow: (owner) => renderSlot("sidebar.workspaces.directoryFlow", owner),
                                                addOnly: true,
                                                side: "right",
                                                onPick: (workspaceId) => {
                                                      setWsPickerOpen(false);
                                                      startSession(workspaceId);
                                                },
                                                onClose: () => {
                                                      setWsPickerOpen(false);
                                                }
                                          })
                                    ]
                              }),
                              !wide && (0, react_jsx_runtime.jsx)("div", {
                                    className: WorkspaceBrowser_module_css_default.search,
                                    children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
                                          label: t("search"),
                                          children: (0, react_jsx_runtime.jsx)("button", {
                                                type: "button",
                                                className: WorkspaceBrowser_module_css_default.searchButton,
                                                "aria-label": t("search.sessions.aria"),
                                                onClick: () => {
                                                      setSearchExpanded(true);
                                                      setSearchOnExpand(true);
                                                      expandSidebar();
                                                },
                                                children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 18 })
                                          })
                                    })
                              }),
                              (0, react_jsx_runtime.jsx)("div", {
                                    className: WorkspaceBrowser_module_css_default.listArea,
                                    children: wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {
                                          useSessions,
                                          open,
                                          workspaces,
                                          archivedSessionIds,
                                          query: normalizedQuery,
                                          remote: remoteSearch,
                                          resultLimit: searchResultLimit,
                                          t
                                    }) : groupBy === "flat" ? (0, react_jsx_runtime.jsx)(FlatList, {
                                          useSessions,
                                          open,
                                          forkSession,
                                          onSessionRename,
                                          onSessionArchive,
                                          archivedSessionIds,
                                          orderBy,
                                          sessionOrderByAccount,
                                          sessionUpdatedAtByAccount,
                                          syncSessionOrderAccount: actions.syncSessionOrderAccount,
                                          setSessionOrder: actions.setSessionOrder,
                                          t
                                    }) : (0, react_jsx_runtime.jsx)(SessionTree, {
                                          useSessions,
                                          onSessionRename,
                                          onSessionArchive,
                                          forkSession,
                                          workspaces,
                                          groupExpansion,
                                          setGroupExpanded: actions.setGroupExpanded,
                                          sessionOrderByAccount,
                                          sessionUpdatedAtByAccount,
                                          syncSessionOrderAccount: actions.syncSessionOrderAccount,
                                          setSessionOrder: actions.setSessionOrder,
                                          archivedSessionIds,
                                          startSession,
                                          open,
                                          insertWorkspaceBefore,
                                          insertSessionBefore,
                                          orderBy,
                                          t,
                                          onRenameRequest: (workspaceId, currentTitle) => {
                                                setRenameTarget({
                                                      workspaceId,
                                                      currentTitle
                                                });
                                                setRenameDraft(currentTitle);
                                                setRenameError(null);
                                          },
                                          onDeleteRequest: (workspaceId, title) => {
                                                setDeleteTarget({
                                                      workspaceId,
                                                      title
                                                });
                                                setDeleteError(null);
                                          }
                                    }))
                              }),
                              (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
                                    open: renameTarget !== null,
                                    onClose: closeRename,
                                    closeLabel: t("close"),
                                    title: t("rename.workspace.title"),
                                    footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "outline",
                                          disabled: renaming,
                                          onClick: closeRename,
                                          children: t("cancel")
                                    }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "primary",
                                          disabled: renameBlocked,
                                          onClick: confirmRename,
                                          children: t("rename")
                                    })] }),
                                    children: [
                                          (0, react_jsx_runtime.jsx)("input", {
                                                className: WorkspaceBrowser_module_css_default.renameInput,
                                                value: renameDraft,
                                                "aria-label": t("field.workspaceName"),
                                                autoFocus: true,
                                                disabled: renaming,
                                                onFocus: (e) => {
                                                      e.target.select();
                                                },
                                                onChange: (e) => {
                                                      setRenameDraft(e.target.value);
                                                      setRenameError(null);
                                                },
                                                onCompositionStart: () => {
                                                      composingRef.current = true;
                                                },
                                                onCompositionEnd: () => {
                                                      composingRef.current = false;
                                                },
                                                onKeyDown: (e) => {
                                                      if (e.key === "Enter" && !composingRef.current) {
                                                            e.preventDefault();
                                                            confirmRename();
                                                      }
                                                }
                                          }),
                                          renameDuplicate && (0, react_jsx_runtime.jsx)("div", {
                                                className: WorkspaceBrowser_module_css_default.renameError,
                                                role: "alert",
                                                children: t("conflict.named", { name: renameTrimmed })
                                          }),
                                          renameError !== null && (0, react_jsx_runtime.jsx)("div", {
                                                className: WorkspaceBrowser_module_css_default.renameError,
                                                role: "alert",
                                                children: renameError
                                          })
                                    ]
                              }),
                              (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
                                    open: sessionRenameTarget !== null,
                                    onClose: closeSessionRename,
                                    closeLabel: t("close"),
                                    title: t("rename.session.title"),
                                    footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "outline",
                                          disabled: sessionRenaming,
                                          onClick: closeSessionRename,
                                          children: t("cancel")
                                    }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "primary",
                                          disabled: sessionRenameBlocked,
                                          onClick: confirmSessionRename,
                                          children: t("rename")
                                    })] }),
                                    children: [(0, react_jsx_runtime.jsx)("input", {
                                          className: WorkspaceBrowser_module_css_default.renameInput,
                                          value: sessionRenameDraft,
                                          "aria-label": t("field.sessionName"),
                                          autoFocus: true,
                                          disabled: sessionRenaming,
                                          onFocus: (e) => {
                                                e.target.select();
                                          },
                                          onChange: (e) => {
                                                setSessionRenameDraft(e.target.value);
                                                setSessionRenameError(null);
                                          },
                                          onCompositionStart: () => {
                                                composingRef.current = true;
                                          },
                                          onCompositionEnd: () => {
                                                composingRef.current = false;
                                          },
                                          onKeyDown: (e) => {
                                                if (e.key === "Enter" && !composingRef.current) {
                                                      e.preventDefault();
                                                      confirmSessionRename();
                                                }
                                          }
                                    }), sessionRenameError !== null && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.renameError,
                                          role: "alert",
                                          children: sessionRenameError
                                    })]
                              }),
                              (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
                                    open: deleteTarget !== null,
                                    onClose: closeDelete,
                                    closeLabel: t("close"),
                                    title: t("delete.workspace"),
                                    ...deleteTarget === null ? {} : { description: t("delete.desc", { name: deleteTarget.title }) },
                                    footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "outline",
                                          disabled: deleting,
                                          onClick: closeDelete,
                                          children: t("cancel")
                                    }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
                                          variant: "outline",
                                          className: WorkspaceBrowser_module_css_default.deleteAction,
                                          disabled: deleting,
                                          onClick: confirmDelete,
                                          children: t("delete.workspace")
                                    })] }),
                                    children: [deleting && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.deleteStatus,
                                          role: "status",
                                          children: t("delete.pending")
                                    }), deleteError !== null && (0, react_jsx_runtime.jsx)("div", {
                                          className: WorkspaceBrowser_module_css_default.renameError,
                                          role: "alert",
                                          children: deleteError
                                    })]
                              })
                        ]
                  });
            }
            //#endregion
            //#region lib/types/client/locales.js
            /**
            * `workspace` namespace dictionaries: the browsing region (section header,
            * search, tree rows, dialogs) and the pick/add flow. Runtime failure
            * messages (wire error strings) pass through untranslated by policy.
            */
            /** Simplified Chinese dictionary (the key-set source of truth). */
            const zh = {
                  "group.ungrouped": "未分组",
                  "session.new": "新会话",
                  "section.workspaces": "工作区",
                  "section.sessions": "会话",
                  "viewOptions.label": "视图选项",
                  "groupBy.label": "分组方式",
                  "groupBy.workspace": "按工作区",
                  "groupBy.flat": "单列表",
                  "orderBy.label": "排序方式",
                  "orderBy.manual": "手动排序",
                  "orderBy.updated": "最近更新",
                  "sessions.expand": "展开其余 {n} 个会话",
                  "sessions.collapse": "收起",
                  "empty.none": "暂无会话",
                  "empty.noMatches": "无匹配结果",
                  "workspace.add": "添加工作区",
                  "search.sessions.aria": "搜索会话",
                  "search.placeholder": "搜索会话…",
                  "search.clear": "清除搜索",
                  "search.results.aria": "搜索结果",
                  "search.pending": "正在搜索会话历史…",
                  "search.unavailable": "内容搜索暂不可用，仅显示名称匹配。",
                  "search.noMatches": "无匹配会话",
                  "search.hasMore": "仅显示前 {n} 条结果，请缩小搜索范围。",
                  "menu.addWorkspace": "添加工作区…",
                  "picker.loading": "正在加载工作区…",
                  "conflict.named": "已存在名为“{name}”的工作区。",
                  "folderError.title": "无法打开文件夹",
                  "folderError.retry": "重新选择",
                  "rename": "重命名",
                  "rename.workspace.title": "重命名工作区",
                  "rename.session.title": "重命名会话",
                  "field.workspaceName": "工作区名称",
                  "field.sessionName": "会话名称",
                  "delete.workspace": "删除工作区",
                  "delete.desc": "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
                  "delete.pending": "正在删除工作区…",
                  "menu.fork": "分叉会话",
                  "menu.archiveSession": "归档会话",
                  "sessions.count.one": "{n} 个会话",
                  "sessions.count.other": "{n} 个会话",
                  "actions.workspace.aria": "工作区“{name}”的操作",
                  "actions.session.aria": "会话“{name}”的操作",
                  "actions.newSession.aria": "在“{name}”中新建会话",
                  "status.running": "进行中",
                  "status.subagentsRunning.one": "{n} 个子代理运行中",
                  "status.subagentsRunning.other": "{n} 个子代理运行中",
                  "status.idle": "空闲",
                  "status.waitingApproval": "等待审批",
                  "status.planReview": "计划待审",
                  "status.waitingAnswer": "等待回答",
                  "status.completed": "已完成",
                  "hover.created": "创建于 {time}",
                  "hover.copied": "已复制",
                  "date.ymd": "{y}年{m}月{d}日",
                  "time.now": "刚刚",
                  "time.minutes": "{n}分钟",
                  "time.hours": "{n}小时",
                  "time.days": "{n}天",
                  "time.months": "{n}个月",
                  "time.years": "{n}年",
                  "time.ago": "{t}前"
            };
            /** English dictionary, checked complete against the zh key set. */
            const en = {
                  "group.ungrouped": "Ungrouped",
                  "session.new": "New Session",
                  "section.workspaces": "Workspaces",
                  "section.sessions": "Sessions",
                  "viewOptions.label": "View options",
                  "groupBy.label": "Group by",
                  "groupBy.workspace": "WorkSpace",
                  "groupBy.flat": "In one list",
                  "orderBy.label": "Order by",
                  "orderBy.manual": "Manual",
                  "orderBy.updated": "Last updated",
                  "sessions.expand": "Show {n} more sessions",
                  "sessions.collapse": "Show less",
                  "empty.none": "No sessions yet",
                  "empty.noMatches": "No matches",
                  "workspace.add": "Add workspace",
                  "search.sessions.aria": "Search sessions",
                  "search.placeholder": "Search sessions...",
                  "search.clear": "Clear search",
                  "search.results.aria": "Search results",
                  "search.pending": "Searching session history…",
                  "search.unavailable": "Content search is temporarily unavailable. Showing name matches.",
                  "search.noMatches": "No matching sessions",
                  "search.hasMore": "Showing the first {n} results. Narrow your search.",
                  "menu.addWorkspace": "Add workspace…",
                  "picker.loading": "Loading workspaces…",
                  "conflict.named": "A workspace named “{name}” already exists.",
                  "folderError.title": "Couldn’t open folder",
                  "folderError.retry": "Choose again",
                  "rename": "Rename",
                  "rename.workspace.title": "Rename workspace",
                  "rename.session.title": "Rename session",
                  "field.workspaceName": "Workspace name",
                  "field.sessionName": "Session name",
                  "delete.workspace": "Delete workspace",
                  "delete.desc": "This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
                  "delete.pending": "Deleting workspace…",
                  "menu.fork": "Fork session",
                  "menu.archiveSession": "Archive session",
                  "sessions.count.one": "{n} session",
                  "sessions.count.other": "{n} sessions",
                  "actions.workspace.aria": "Workspace actions for {name}",
                  "actions.session.aria": "Session actions for {name}",
                  "actions.newSession.aria": "New session in {name}",
                  "status.running": "Running",
                  "status.subagentsRunning.one": "{n} subagent running",
                  "status.subagentsRunning.other": "{n} subagents running",
                  "status.idle": "Idle",
                  "status.waitingApproval": "Waiting for approval",
                  "status.planReview": "Plan awaiting review",
                  "status.waitingAnswer": "Waiting for answer",
                  "status.completed": "Completed",
                  "hover.created": "Created {time}",
                  "hover.copied": "Copied",
                  "date.ymd": "{y}-{m}-{d}",
                  "time.now": "now",
                  "time.minutes": "{n}min",
                  "time.hours": "{n}h",
                  "time.days": "{n}d",
                  "time.months": "{n}mo",
                  "time.years": "{n}y",
                  "time.ago": "{t} ago"
            };
            //#endregion
            //#region lib/types/client/index.js
            /** Dictionary namespace owned by this plugin. */
            const NS = "workspace";
            /**
            * Required services (cordis fiber inject). The target slots are declared by
            * the ui-sidebar / ui-conversation applies, whose activation order relative
            * to this one is NOT constrained: dsh.client.inject edges are informational
            * (loading/prefetch metadata, never apply sequencing) and neither owner
            * provides a waitable service. apply therefore depends on each slot
            * declaration through `slots.inject()` instead of assuming order.
            */
            const inject = [
                  "slots",
                  "sessions",
                  "workspaces",
                  "locale"
            ];
            /**
            * Register the browser and picker once their slot declarations are on the
            * ledger. Inject factories return plain callbacks; data reads use the
            * framework's global hooks.
            * @param ctx - client root context.
            */
            function apply(ctx) {
                  ctx.effect(() => ctx.locale.register(NS, {
                        zh,
                        en
                  }), "ui-workspace: dictionaries");
                  const searchSessions = async (query, signal) => {
                        const result = await ctx.sessions.search(query, signal);
                        if (!result.ok) throw new Error(result.error.message);
                        return result.value;
                  };
                  const flowSource = (hole) => ({
                        getSnapshot: () => ctx.slots.entries(hole).length > 0,
                        subscribe: (listener) => ctx.slots.subscribe(hole, listener)
                  });
                  const browserFlowSource = flowSource("sidebar.workspaces.directoryFlow");
                  const pickerFlowSource = flowSource("conversation.hero.workspace.directoryFlow");
                  const browserInjected = () => ({
                        startSession: (workspaceId) => {
                              ctx.workspaces.startSession(workspaceId);
                        },
                        open: (sessionId) => {
                              ctx.sessions.open(sessionId);
                        },
                        searchSessions,
                        searchResultLimit: ctx.sessions.searchResultLimit,
                        renameSession: async (sessionId, title) => {
                              const session = ctx.sessions.binding(sessionId)?.session;
                              if (session === void 0) throw new Error(`unknown session "${sessionId}"`);
                              const result = await session.rename(title);
                              if (!result.ok) throw new Error(result.error.message);
                        },
                        forkSession: (sessionId) => {
                              ctx.sessions.fork({
                                    sessionId,
                                    increaseTitle: true
                              }).then((childId) => {
                                    ctx.sessions.open(childId);
                              }).catch(() => {});
                        },
                        renameWorkspace: async (workspaceId, title) => {
                              await ctx.workspaces.rename(workspaceId, title);
                        },
                        deleteWorkspace: async (workspaceId) => {
                              await ctx.workspaces.delete(workspaceId);
                        },
                        insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
                              await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId);
                        },
                        archiveSession: async (sessionId) => {
                              await ctx.workspaces.archiveSession(sessionId);
                        },
                        insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
                              await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
                        },
                        createWorkspace: (input) => ctx.workspaces.create(input),
                        hooks: { directoryFlow: browserFlowSource }
                  });
                  const pickerInjected = () => ({
                        createWorkspace: (input) => ctx.workspaces.create(input),
                        hooks: { directoryFlow: pickerFlowSource }
                  });
                  ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
                        name: "sidebar.workspaces",
                        children: { "sidebar.workspaces.directoryFlow": {
                              kind: "single",
                              scope: "root"
                        } },
                        store: createWorkspaceViewStore(),
                        inject: browserInjected,
                        locale: NS
                  }, WorkspaceBrowser));
                  ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
                        name: "conversation.hero.workspace",
                        children: { "conversation.hero.workspace.directoryFlow": {
                              kind: "single",
                              scope: "root"
                        } },
                        inject: pickerInjected,
                        locale: NS
                  }, WorkspacePicker));
            }
            //#endregion
            return { WorkspaceBrowser, WorkspacePicker, createWorkspaceViewStore, en, zh };

    })()

    const LOCAL_SOURCE_ID = 'local'
    const ACTIVE_CHANGED = 'dsh-remote-desktop/active-changed'
    function createStore() {
      let snapshot = {
        sources: [],
        snapshots: {},
        active: { kind: 'local', sessionId: undefined },
        pendingOpen: null,
        loaded: false,
        error: null,
        companionReady: {},
        remoteSetup: { open: false, request: null },
      }
      const listeners = new Set()
      const emit = () => {
        for (const listener of [...listeners]) listener()
        window.dispatchEvent(new CustomEvent(ACTIVE_CHANGED, { detail: snapshot.active }))
      }
      const set = (patch) => { snapshot = { ...snapshot, ...patch }; emit() }
      const api = async (path, init) => {
        const res = await fetch(`/remote-desktop/api${path}`, { headers: { 'content-type': 'application/json' }, ...init })
        const json = await res.json().catch(() => null)
        if (!res.ok || json?.ok !== true) throw new Error(json?.error?.message || `HTTP ${res.status}`)
        return json
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        set,
        async refreshSources() {
          try {
            const json = await api('/sources')
            set({ sources: json.sources, loaded: true, error: null })
            for (const source of json.sources) {
              if (source.state === 'connected') void this.refreshSnapshot(source.id)
            }
          } catch (error) {
            set({ loaded: true, error: error instanceof Error ? error.message : String(error) })
          }
        },
        async saveSource(source) {
          await api('/sources', { method: 'POST', body: JSON.stringify(source) })
          await this.refreshSources()
        },
        async connect(id) {
          await api('/connect', { method: 'POST', body: JSON.stringify({ id }) })
          await this.refreshSources()
        },
        async disconnect(id) {
          await api('/disconnect', { method: 'POST', body: JSON.stringify({ id }) })
          set({ active: snapshot.active.kind === 'remote' && snapshot.active.sourceId === id ? { kind: 'local', sessionId: undefined } : snapshot.active })
          await this.refreshSources()
        },
        async delete(id) {
          await api('/delete', { method: 'POST', body: JSON.stringify({ id }) })
          const nextSnapshots = { ...snapshot.snapshots }
          const nextReady = { ...snapshot.companionReady }
          delete nextSnapshots[id]
          delete nextReady[id]
          set({
            snapshots: nextSnapshots,
            companionReady: nextReady,
            active: snapshot.active.kind === 'remote' && snapshot.active.sourceId === id ? { kind: 'local', sessionId: undefined } : snapshot.active,
          })
          await this.refreshSources()
        },
        async refreshSnapshot(id) {
          try {
            const json = await api(`/snapshot?id=${encodeURIComponent(id)}`)
            set({ snapshots: { ...snapshot.snapshots, [id]: { state: 'ready', ...json.snapshot } } })
          } catch (error) {
            set({ snapshots: { ...snapshot.snapshots, [id]: { state: 'error', error: error instanceof Error ? error.message : String(error) } } })
          }
        },
        markReady(sourceId) {
          if (snapshot.companionReady[sourceId]) return
          set({ companionReady: { ...snapshot.companionReady, [sourceId]: true } })
        },
        openRemote(sourceId, sessionId) {
          set({
            active: { kind: 'remote', sourceId, sessionId },
            pendingOpen: { sourceId, sessionId, nonce: Math.random() },
          })
        },
        openLocal(sessionId) { set({ active: { kind: 'local', sessionId }, pendingOpen: null }) },
        openRemoteSetup(request = null) { set({ remoteSetup: { open: true, request } }) },
        closeRemoteSetup(status = 'cancelled', message = '') {
          const request = snapshot.remoteSetup.request
          if (request?.target && request?.origin && request?.requestId) {
            request.target.postMessage({
              type: 'dsh-remote-desktop/add-workspace-remote-result',
              requestId: request.requestId,
              status,
              ...(message ? { message } : {}),
            }, request.origin)
          }
          set({ remoteSetup: { open: false, request: null } })
        },
        listSources() { return snapshot.sources.map(publicSummary) },
      }
    }

    const store = createStore()
    const useRemote = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))

    function isRemoteDesktopIframe() {
      return new URLSearchParams(window.location.search).get('dshRemoteDesktop') === '1'
    }

    function bridgeHash() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      return { token: params.get('token') || '', parent: params.get('parent') || '' }
    }

    function isAddWorkspaceBridgeRequest(data) {
      return data?.type === 'dsh-remote-desktop/add-workspace-remote-request'
        && typeof data.requestId === 'string' && data.requestId !== ''
        && typeof data.token === 'string' && data.token !== ''
    }

    async function remoteRpc(sourceId, method, payload = {}) {
      const rpcId = `${Date.now()}-${Math.random()}`
      const path = `/api/${method}`
      const url = new URL('/remote-desktop/api/host-api', window.location.origin)
      url.searchParams.set('id', sourceId)
      url.searchParams.set('path', path)
      const response = await fetch(String(url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      const parsed = await response.json().catch(() => null)
      if (!response.ok) throw new Error(parsed?.error?.message || `HTTP ${response.status}`)
      if (parsed?.rpcId !== rpcId) throw new Error(`${method} rpcId mismatch`)
      if (parsed?.result?.ok !== true) throw new Error(parsed?.result?.error?.message || `${method} failed`)
      return parsed.result.value
    }

    function rowSessionId(row) {
      return row?.sessionId || row?.id
    }

    async function startRemoteWorkspace(sourceId, workspaceId) {
      const snapshot = store.getSnapshot().snapshots[sourceId]
      const workspace = snapshot?.workspaces?.items?.find(row => String(row.workspaceId) === String(workspaceId))
      const archived = new Set(snapshot?.workspaces?.archivedSessionIds || [])
      const sessions = snapshot?.sessions?.items || []
      const blank = sessions.find(row => row?.blank && !archived.has(rowSessionId(row)) && (workspace?.sessionIds || []).includes(rowSessionId(row)))
      const sessionId = rowSessionId(blank) || (await remoteRpc(sourceId, 'session.create', { workspaceId })).sessionId
      store.openRemote(sourceId, sessionId)
      void store.refreshSnapshot(sourceId)
    }

    function publicSummary(source) {
      return { id: source.id, label: source.label, state: source.state, error: source.error ?? null }
    }

    function byWorkspace(snapshot) {
      if (!snapshot || snapshot.state === 'error') return []
      const sessions = snapshot.sessions?.items || []
      const byId = new Map(sessions.map(row => [row.sessionId, row]))
      const archived = new Set(snapshot.workspaces?.archivedSessionIds || [])
      return (snapshot.workspaces?.items || []).map(ws => ({
        ...ws,
        title: ws.title || ws.path || 'Workspace',
        sessions: (ws.sessionIds || []).filter(id => !archived.has(id)).map(id => byId.get(id)).filter(Boolean),
      }))
    }

    function titleOfSession(row) {
      return row?.displayTitle || row?.title || row?.projections?.values?.title || row?.cwd?.split(/[\\/]/).pop() || row?.sessionId || 'Untitled session'
    }

    function sessionUpdatedAt(row) {
      return Number(row?.updatedAt || row?.createdAt || 0)
    }

    function relativeTime(ms) {
      if (!ms) return ''
      const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000))
      if (minutes < 1) return 'now'
      if (minutes < 60) return `${minutes}min`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h`
      return `${Math.floor(hours / 24)}d`
    }

    const REMOTE_OVERLAY_Z_INDEX = 900

    function installCss() {
      if (document.querySelector('style[data-dsh-remote-desktop-sidebar]')) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-dsh-remote-desktop-sidebar', '')
      style.textContent = `
        .rd-settingsNativeUrl { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; max-width: 240px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .rd-pickerMenu { position: fixed; z-index: 2147482600; min-width: 260px; max-width: min(360px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 24px)); overflow-y: auto; padding: 6px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); }
        .rd-addChoiceGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .rd-addChoice { display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 92px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
        .rd-addChoice:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-addChoice[disabled] { opacity: .55; cursor: default; }
        .rd-addChoiceIcon { flex: none; color: var(--dsw-alias-label-secondary); }
        .rd-addChoiceTitle { display: block; font-size: 14px; line-height: 20px; font-weight: 520; }
        .rd-addChoiceDesc { display: block; margin-top: 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-setupField { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .rd-setupLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        .rd-hostButton { justify-content: space-between; width: 100%; }
        .rd-hostButtonLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
        .rd-setupHint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin-top: 8px; }
        .rd-addError { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; margin-top: 8px; }
        @keyframes rd-row-in { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .rd-sessionNode { animation: none; } }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function DirectoryFlowAnchor() { return null }

    const REMOTE_ID_PREFIX = 'remote::'
    const REMOTE_ID_SEPARATOR = '::'
    const REMOTE_HOST_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']
    function remoteHostColor(sourceId) {
      let hash = 0
      for (const ch of String(sourceId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
      return REMOTE_HOST_COLORS[hash % REMOTE_HOST_COLORS.length]
    }
    function remoteKey(sourceId, id) { return `${REMOTE_ID_PREFIX}${sourceId}${REMOTE_ID_SEPARATOR}${id}` }
    function parseRemoteKey(id) {
      if (typeof id !== 'string' || !id.startsWith(REMOTE_ID_PREFIX)) return null
      const rest = id.slice(REMOTE_ID_PREFIX.length)
      const split = rest.indexOf(REMOTE_ID_SEPARATOR)
      if (split === -1) return null
      return { sourceId: rest.slice(0, split), id: rest.slice(split + REMOTE_ID_SEPARATOR.length) }
    }
    function workspaceT(key, args = {}) {
      const table = OfficialWorkspace.en || {}
      let text = table[key] || key
      for (const [name, value] of Object.entries(args)) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }
    function officialSessionSummary(row, id, sourceKind, sourceId, rawSessionId) {
      return {
        ...row,
        id,
        sourceKind,
        sourceId,
        rawSessionId,
        displayTitle: titleOfSession(row),
        blank: false,
        running: Boolean(row.running),
        runningSubagentCount: Number(row.runningSubagentCount || 0),
        completed: Boolean(row.completed),
        updatedAt: sessionUpdatedAt(row) || Date.now(),
        createdAt: Number(row.createdAt || row.updatedAt || Date.now()),
        origin: row.origin,
      }
    }
    function OfficialWorkspaceForkBrowser(props) {
      const remote = useRemote(s => s)
      const addButtonRef = useRef(null)
      const [pickerOpen, setPickerOpen] = useState(false)
      useEffect(() => installCss(), [])
      useEffect(() => {
        void store.refreshSources()
        const timer = setInterval(() => { void store.refreshSources() }, 5000)
        return () => clearInterval(timer)
      }, [])
      const useCombinedSessions = (selector) => {
        const local = props.useSessions(s => s)
        const remoteSnapshot = useRemote(s => s)
        const combined = useMemo(() => {
          const byId = {}
          const ids = []
          for (const id of local.ids || Object.keys(local.byId || {})) {
            const row = local.byId?.[id]
            if (!row) continue
            byId[id] = officialSessionSummary(row, id, 'local', LOCAL_SOURCE_ID, id)
            ids.push(id)
          }
          for (const source of remoteSnapshot.sources) {
            if (source.state !== 'connected') continue
            const snap = remoteSnapshot.snapshots[source.id]
            for (const row of snap?.sessions?.items || []) {
              if (row?.origin === 'subagent') continue
              const raw = rowSessionId(row)
              if (!raw) continue
              const id = remoteKey(source.id, raw)
              byId[id] = officialSessionSummary(row, id, 'remote', source.id, raw)
              ids.push(id)
            }
          }
          const current = remoteSnapshot.active.kind === 'remote'
            ? remoteKey(remoteSnapshot.active.sourceId, remoteSnapshot.active.sessionId || '')
            : local.current
          return { ...local, phase: local.phase || 'ready', ids, byId, current }
        }, [local, remoteSnapshot.sources, remoteSnapshot.snapshots, remoteSnapshot.active])
        return selector(combined)
      }
      const useCombinedWorkspaces = (selector) => {
        const local = props.useWorkspaces(s => s)
        const remoteSnapshot = useRemote(s => s)
        const combined = useMemo(() => {
          const items = (local.items || []).map(ws => ({
            ...ws,
            sourceKind: 'local',
            sourceId: LOCAL_SOURCE_ID,
            sessionIds: (ws.sessionIds || []).filter(id => local.archivedSessionIds?.includes?.(id) !== true),
          }))
          const archived = [...(local.archivedSessionIds || [])]
          for (const source of remoteSnapshot.sources) {
            if (source.state !== 'connected') continue
            const snap = remoteSnapshot.snapshots[source.id]
            const remoteArchived = new Set(snap?.workspaces?.archivedSessionIds || [])
            archived.push(...[...remoteArchived].map(id => remoteKey(source.id, id)))
            for (const ws of byWorkspace(snap)) {
              const rawWorkspaceId = String(ws.workspaceId)
              items.push({
                ...ws,
                workspaceId: remoteKey(source.id, rawWorkspaceId),
                sourceKind: 'remote',
                sourceId: source.id,
                remoteMarker: { id: source.id, label: source.label, state: source.state || 'connected', color: remoteHostColor(source.id) },
                title: ws.title || ws.path || 'Workspace',
                createdAt: ws.createdAt || new Date(0).toISOString(),
                sessionIds: (ws.sessions || []).map(row => rowSessionId(row)).filter(Boolean).map(id => remoteKey(source.id, id)),
              })
            }
          }
          return { ...local, phase: local.phase || 'ready', items, archivedSessionIds: archived }
        }, [local, remoteSnapshot.sources, remoteSnapshot.snapshots])
        return selector(combined)
      }
      const decodeSession = (sessionId) => parseRemoteKey(sessionId)
      const decodeWorkspace = (workspaceId) => parseRemoteKey(workspaceId)
      const open = (sessionId) => {
        const remoteId = decodeSession(sessionId)
        if (remoteId) store.openRemote(remoteId.sourceId, remoteId.id)
        else { store.openLocal(sessionId); props.openLocal?.(sessionId) }
      }
      const startSession = (workspaceId) => {
        const remoteId = decodeWorkspace(workspaceId)
        if (remoteId) void startRemoteWorkspace(remoteId.sourceId, remoteId.id)
        else props.startLocalWorkspace?.(workspaceId)
      }
      const addPicker = h(WorkspaceAddSplitter, {
        open: pickerOpen,
        onClose: () => setPickerOpen(false),
        anchorRef: addButtonRef,
        selectedId: undefined,
        onPick: workspaceId => props.startLocalWorkspace?.(workspaceId),
        createLocalWorkspace: props.createLocalWorkspace,
        useWorkspaces: props.useWorkspaces,
        useDirectoryFlow: props.useDirectoryFlow,
        renderSlot: props.renderSlot,
        directoryFlowSlot: 'sidebar.workspaces.directoryFlow',
      })
      return h(React.Fragment, null,
        h(OfficialWorkspace.WorkspaceBrowser, {
          ...props,
          useSessions: useCombinedSessions,
          useWorkspaces: useCombinedWorkspaces,
          startSession,
          open,
          searchSessions: props.searchSessions || (async () => ({ items: [], hasMore: false })),
          searchResultLimit: props.searchResultLimit || 50,
          renameSession: async (sessionId, title) => { if (!decodeSession(sessionId)) await props.renameSession?.(sessionId, title) },
          forkSession: sessionId => { if (!decodeSession(sessionId)) props.forkSession?.(sessionId) },
          renameWorkspace: async (workspaceId, title) => { if (!decodeWorkspace(workspaceId)) await props.renameLocalWorkspace?.(workspaceId, title) },
          deleteWorkspace: async workspaceId => { if (!decodeWorkspace(workspaceId)) await props.deleteLocalWorkspace?.(workspaceId) },
          insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
            if (!decodeWorkspace(workspaceId) && !decodeWorkspace(beforeWorkspaceId)) await props.insertWorkspaceBefore?.(workspaceId, beforeWorkspaceId)
          },
          archiveSession: async sessionId => { if (!decodeSession(sessionId)) await props.archiveSession?.(sessionId) },
          insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
            if (!decodeWorkspace(workspaceId) && !decodeSession(sessionId) && !decodeSession(beforeSessionId)) await props.insertSessionBefore?.(workspaceId, sessionId, beforeSessionId)
          },
          createWorkspace: props.createLocalWorkspace,
          t: workspaceT,
        }),
        pickerOpen ? addPicker : null,
        h('button', { ref: addButtonRef, type: 'button', style: { position: 'fixed', left: -10000, top: -10000 }, 'aria-hidden': 'true' })
      )
    }

    function WorkspaceAddSplitter(props) {
      const remote = useRemote(s => s)
      const localWorkspaces = props.useWorkspaces(s => s.items)
      const [splitterOpen, setSplitterOpen] = useState(false)
      const [localFlowOpen, setLocalFlowOpen] = useState(false)
      const [localBusy, setLocalBusy] = useState(false)
      const [message, setMessage] = useState('')
      const anchorRect = props.anchorRef?.current?.getBoundingClientRect?.()
      const flowAvailable = props.useDirectoryFlow ? props.useDirectoryFlow(Boolean) : false
      useEffect(() => { if (!isRemoteDesktopIframe()) void store.refreshSources() }, [])
      const closePicker = () => { setMessage(''); props.onClose?.() }
      const remoteWorkspaceRows = []
      if (!isRemoteDesktopIframe()) {
        for (const source of remote.sources) {
          if (source.state !== 'connected') continue
          const snap = remote.snapshots[source.id]
          for (const ws of byWorkspace(snap)) remoteWorkspaceRows.push({ source, workspace: ws })
        }
      }
      const menuItems = [
        ...localWorkspaces.map(ws => ({
          id: `local:${ws.workspaceId}`,
          label: ws.title || ws.path || 'Workspace',
          icon: h(IconFolderClose16, { size: 16 }),
        })),
        ...(remoteWorkspaceRows.length > 0 ? [{ type: 'separator', id: 'remote-separator' }] : []),
        ...remoteWorkspaceRows.map(({ source, workspace }) => ({
          id: `remote:${source.id}:${workspace.workspaceId}`,
          label: h('span', { className: 'rd-hostButtonLabel' }, workspace.title || workspace.path || 'Workspace'),
          icon: h(IconFolderClose16, { size: 16 }),
        })),
      ]
      const footerItems = [{ id: 'add-workspace', label: 'Add workspace…', icon: h(IconPlusOutline16, { size: 16 }) }]
      const openRemoteWorkspace = async (sourceId, workspaceId) => {
        setMessage('')
        closePicker()
        try { await startRemoteWorkspace(sourceId, workspaceId) } catch (e) { setMessage(e.message || String(e)) }
      }
      const handleMenuSelect = (id) => {
        if (id === 'add-workspace') {
          props.onClose?.()
          setSplitterOpen(true)
          return
        }
        if (id.startsWith('local:')) {
          closePicker()
          props.onPick(id.slice('local:'.length))
          return
        }
        if (id.startsWith('remote:')) {
          const [, sourceId, workspaceId] = id.split(':')
          void openRemoteWorkspace(sourceId, workspaceId)
        }
      }
      const openLocalFlow = () => {
        setMessage('')
        if (!flowAvailable) {
          setMessage('Local directory picker is unavailable in this profile.')
          return
        }
        setSplitterOpen(false)
        setLocalFlowOpen(true)
      }
      const openRemoteFlow = () => {
        setMessage('')
        if (isRemoteDesktopIframe()) {
          const { token, parent } = bridgeHash()
          if (token === '' || parent === '') {
            setMessage('Remote workspace setup requires the main host bridge.')
            return
          }
          const requestId = `${Date.now()}-${Math.random()}`
          const onResult = (event) => {
            if (event.origin !== parent) return
            const data = event.data
            if (data?.type !== 'dsh-remote-desktop/add-workspace-remote-result' || data.requestId !== requestId) return
            window.removeEventListener('message', onResult)
            if (data.status === 'error') setMessage(data.message || 'Remote workspace setup failed')
            else setSplitterOpen(false)
          }
          window.addEventListener('message', onResult)
          window.parent?.postMessage({
            type: 'dsh-remote-desktop/add-workspace-remote-request',
            token,
            requestId,
          }, parent)
          return
        }
        setSplitterOpen(false)
        store.openRemoteSetup()
      }
      const localFlowOwner = {
        open: localFlowOpen,
        busy: localBusy,
        onPicked: (path) => {
          setLocalBusy(true)
          props.createLocalWorkspace({ path }).then((workspace) => {
            setLocalFlowOpen(false)
            props.onPick(workspace.workspaceId)
          }).catch((error) => {
            setMessage(error instanceof Error ? error.message : String(error))
            setLocalFlowOpen(false)
            setSplitterOpen(true)
          }).finally(() => { setLocalBusy(false) })
        },
        onCancel: () => { setLocalFlowOpen(false) },
        onError: (error) => {
          setMessage(error)
          setLocalFlowOpen(false)
          setSplitterOpen(true)
        },
      }
      return h(React.Fragment, null,
        h(Menu, {
          open: props.open,
          anchor: null,
          items: menuItems,
          footer: footerItems,
          selectedId: props.selectedId,
          onSelect: handleMenuSelect,
          onClose: closePicker,
          portal: true,
          getAnchorRect: () => anchorRect ?? null,
        }),
        h(Modal, {
          open: splitterOpen,
          onClose: () => setSplitterOpen(false),
          title: 'Add workspace',
          closeLabel: 'Close',
          description: 'Choose where the workspace should live.',
          footer: h(Button, { variant: 'outline', onClick: () => setSplitterOpen(false) }, 'Cancel'),
        },
          h('div', { className: 'rd-addChoiceGrid', 'data-rd-add-workspace-splitter': 'true' },
            h('button', { type: 'button', className: 'rd-addChoice', onClick: openLocalFlow, 'data-rd-add-local': 'true' },
              h('span', { className: 'rd-addChoiceIcon' }, h(IconFolderOpenOutline16, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Local workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, 'Use the official picker for this DSH instance.')
              )
            ),
            h('button', { type: 'button', className: 'rd-addChoice', onClick: openRemoteFlow, 'data-rd-add-remote': 'true' },
              h('span', { className: 'rd-addChoiceIcon' }, h(IconPlusOutline16, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Remote workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, isRemoteDesktopIframe() ? 'Ask the main host to create one on a connected remote.' : 'Create one on a connected remote host.')
              )
            )
          ),
          message && h('div', { className: 'rd-addError', role: 'alert' }, message)
        ),
        props.renderSlot && props.renderSlot(props.directoryFlowSlot || 'conversation.hero.workspace.directoryFlow', localFlowOwner)
      )
    }

    function RemoteSetupModal() {
      const remote = useRemote(s => s)
      const [hostId, setHostId] = useState('')
      const [path, setPath] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [hostMenuOpen, setHostMenuOpen] = useState(false)
      const open = remote.remoteSetup.open
      const connected = remote.sources.filter(source => source.state === 'connected')
      const selected = connected.find(source => source.id === hostId) || connected[0]
      useEffect(() => {
        if (!open) return
        setHostId(connected[0]?.id || '')
        setPath('')
        setError('')
      }, [open, connected.map(source => source.id).join('\u0000')])
      const close = (status = 'cancelled', message = '') => {
        setHostMenuOpen(false)
        setBusy(false)
        setError('')
        store.closeRemoteSetup(status, message)
      }
      const submit = async () => {
        const sourceId = selected?.id || hostId
        const trimmed = path.trim()
        if (sourceId === '') { setError('Connect a remote host before adding a remote workspace.'); return }
        if (trimmed === '') { setError('Remote path is required.'); return }
        setBusy(true)
        setError('')
        try {
          const result = await remoteRpc(sourceId, 'workspace.create', { path: trimmed })
          await store.refreshSnapshot(sourceId)
          await startRemoteWorkspace(sourceId, result.workspace.workspaceId)
          close('opened')
        } catch (e) {
          const message = e.message || String(e)
          setError(message)
        } finally {
          setBusy(false)
        }
      }
      const hostItems = connected.length === 0
        ? [{ id: 'no-host', label: 'No connected hosts', disabled: true }]
        : connected.map(source => ({ id: source.id, label: source.label }))
      return h(Modal, {
        open,
        onClose: () => close('cancelled'),
        title: 'Add remote workspace',
        closeLabel: 'Close',
        description: 'Choose a connected host and enter an absolute path on that host.',
        footer: h(React.Fragment, null,
          h(Button, { variant: 'outline', disabled: busy, onClick: () => close('cancelled') }, 'Cancel'),
          h(Button, { variant: 'primary', disabled: busy || connected.length === 0, onClick: () => void submit(), 'data-rd-add-workspace-submit': 'true' }, busy ? 'Adding…' : 'Add')
        ),
      },
        h('div', { 'data-rd-remote-workspace-setup': 'true' },
          h('div', { className: 'rd-setupField' },
            h('div', { className: 'rd-setupLabel' }, 'Host'),
            h(Menu, {
              open: hostMenuOpen,
              anchor: h(Button, { variant: 'outline', className: 'rd-hostButton', disabled: busy || connected.length === 0, onClick: () => setHostMenuOpen(value => !value) },
                h('span', { className: 'rd-hostButtonLabel' }, selected?.label || 'No connected hosts'),
                h(IconChevronDownOutline14, { size: 14 })
              ),
              items: hostItems,
              selectedId: selected?.id,
              onSelect: (id) => { if (id !== 'no-host') setHostId(id); setHostMenuOpen(false) },
              onClose: () => setHostMenuOpen(false),
            })
          ),
          h('label', { className: 'rd-setupField' },
            h('span', { className: 'rd-setupLabel' }, 'Remote absolute path'),
            h(Input, { value: path, disabled: busy, placeholder: '/path/to/project', onChange: e => setPath(e.target.value), onKeyDown: e => { if (e.key === 'Enter') void submit() } })
          ),
          connected.length === 0 && h('div', { className: 'rd-setupHint' }, 'Connect a host in Settings → Remote Desktop before creating a remote workspace.'),
          error && h('div', { className: 'rd-addError', role: 'alert' }, error)
        )
      )
    }

    function RemoteOverlay() {
      const remote = useRemote(s => s)
      const { sources, active, pendingOpen } = remote
      const [host, setHost] = useState(null)
      const [left, setLeftState] = useState(0)
      const leftRef = useRef(0)
      const setLeft = (next) => { if (leftRef.current !== next) { leftRef.current = next; setLeftState(next) } }
      const frames = useRef(new Map())
      const tokenToSource = useMemo(() => new Map(sources.map(source => [source.token, source.id])), [sources])
      const source = active.kind === 'remote' ? sources.find(s => s.id === active.sourceId) : undefined
      useEffect(() => {
        const node = document.createElement('div')
        node.setAttribute('data-rd-overlay-host', 'body-portal')
        document.body.appendChild(node)
        setHost(node)
        return () => { node.remove(); setHost(null) }
      }, [])
      useEffect(() => {
        const measure = () => {
          const col = document.querySelector('[class*="sidebarCol"]')
          setLeft(col ? Math.round(col.getBoundingClientRect().right) : 0)
        }
        const observed = new Set()
        const ro = new ResizeObserver(measure)
        const observe = (element) => {
          if (!(element instanceof Element) || observed.has(element)) return
          observed.add(element)
          ro.observe(element)
        }
        const refreshObserved = () => {
          observe(document.body)
          observe(document.documentElement)
          observe(document.querySelector('[class*="sidebarCol"]'))
          observe(document.querySelector('[class*="frame"]'))
        }
        measure()
        refreshObserved()
        const mo = new MutationObserver(() => { refreshObserved(); measure() })
        mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
        window.addEventListener('resize', measure)
        document.addEventListener('pointermove', measure, true)
        document.addEventListener('pointerup', measure, true)
        const timer = window.setInterval(measure, 250)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('pointermove', measure, true)
          document.removeEventListener('pointerup', measure, true)
          window.removeEventListener('resize', measure)
          mo.disconnect()
          ro.disconnect()
        }
      }, [])
      useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (data?.type === 'dsh-remote-desktop/ready') {
            const sourceId = tokenToSource.get(data.sourceToken)
            if (sourceId !== undefined) store.markReady(sourceId)
            return
          }
          if (!isAddWorkspaceBridgeRequest(data)) return
          const sourceId = tokenToSource.get(data.token)
          const source = sourceId === undefined ? undefined : sources.find(item => item.id === sourceId)
          if (source === undefined || event.origin !== new URL(source.iframeUrl).origin) return
          store.openRemoteSetup({ requestId: data.requestId, origin: event.origin, target: event.source })
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [tokenToSource])
      useEffect(() => {
        if (!source || !pendingOpen || pendingOpen.sourceId !== source.id) return
        const frame = frames.current.get(source.id)
        if (!frame?.contentWindow) return
        const send = () => frame.contentWindow.postMessage({
          type: 'dsh-remote-desktop/open-session',
          token: source.token,
          sessionId: pendingOpen.sessionId,
        }, new URL(source.iframeUrl).origin)
        send()
        const retry = setTimeout(send, 500)
        return () => clearTimeout(retry)
      }, [source?.id, source?.iframeUrl, source?.token, pendingOpen?.nonce])

      const overlay = h('div', { style: { ...styles.overlay, left, display: source ? 'block' : 'none' }, 'data-rd-overlay-active': source ? 'true' : 'false' },
        sources.filter(s => s.state === 'connected' && s.iframeUrl).map(s => h('iframe', {
          key: s.id,
          ref: el => { if (el) frames.current.set(s.id, el); else frames.current.delete(s.id) },
          src: withParent(s.iframeUrl),
          style: { ...styles.iframe, display: source?.id === s.id ? 'block' : 'none' },
          'data-rd-frame-source-id': s.id,
          title: `Remote dsh ${s.label}`,
        })),
      )
      return h(React.Fragment, null,
        host ? ReactDOM.createPortal(overlay, host) : null,
        h(RemoteSetupModal, null)
      )
    }

    function withParent(url) {
      const u = new URL(url)
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
      hash.set('parent', window.location.origin)
      u.hash = hash.toString()
      return String(u)
    }

    function nativeRemoteUrl(url) {
      const u = new URL(url)
      u.search = ''
      u.hash = ''
      return String(u)
    }


    function SettingsSection() {
      const sources = useRemote(s => s.sources)
      const [message, setMessage] = useState('')
      useEffect(() => { void store.refreshSources() }, [])
      const connect = async (id) => {
        try { await store.connect(id); setMessage('Connected') } catch (e) { setMessage(e.message || String(e)) }
      }
      const disconnect = async (id) => {
        try { await store.disconnect(id); setMessage('Disconnected') } catch (e) { setMessage(e.message || String(e)) }
      }
      const openNative = (source) => {
        if (!source.iframeUrl) return
        const nativeUrl = nativeRemoteUrl(source.iframeUrl)
        const opened = window.open(nativeUrl, '_blank', 'noopener,noreferrer')
        if (opened === null) setMessage(`Your browser blocked ${source.label}. Use the link in this host row to open it.`)
      }
      return h('div', { style: styles.settings, 'data-rd-settings-section': 'true' },
        h('h2', null, 'Remote Desktop'),
        h('p', null, 'Hosts come from this machine\'s SSH config. A host is connected when its remote dsh web profile and companion answer through SSH.'),
        message && h('div', { style: message.toLowerCase().includes('error') || message.toLowerCase().includes('required') ? styles.error : styles.hint }, message),
        h('h3', null, 'SSH hosts'),
        sources.length === 0 && h('div', { style: styles.hint }, 'No concrete Host entries found in ~/.ssh/config.'),
        sources.map(source => h('div', { key: source.id, style: styles.card, 'data-rd-settings-source-id': source.id },
          h('div', { style: styles.hostRow },
            h('strong', null, source.label),
            h('span', { style: styles.hostStatus, 'data-rd-settings-host-state': source.state }, source.state === 'connected' ? 'connected' : 'not connected')
          ),
          h('div', { style: styles.hint }, [source.sshUser, source.sshHost].filter(Boolean).join('@') || source.sshAlias || source.id),
          source.error && h('div', { style: styles.error }, source.error),
          h('div', { style: styles.actions },
            source.state === 'connected' && source.iframeUrl && h(Button, { variant: 'primary', 'data-rd-settings-open-native': source.id, onClick: () => openNative(source) }, `Open ${source.label} DSH`),
            h(Button, { variant: 'outline', 'data-rd-settings-connect': source.id, onClick: () => void connect(source.id) }, 'Connect'),
            h(Button, { variant: 'outline', 'data-rd-settings-disconnect': source.id, onClick: () => void disconnect(source.id) }, 'Disconnect')
          ),
          source.state === 'connected' && source.iframeUrl && h('a', { className: 'rd-settingsNativeUrl', href: nativeRemoteUrl(source.iframeUrl), target: '_blank', rel: 'noopener noreferrer', 'data-rd-settings-native-link': 'true' }, nativeRemoteUrl(source.iframeUrl))
        ))
      )
    }

    function createService(openLocal) {
      return {
        getSnapshot: () => store.getSnapshot(),
        subscribe: store.subscribe,
        listSources: () => store.listSources(),
        getActive: () => store.getSnapshot().active,
        openLocalSession: (sessionId) => { store.openLocal(sessionId); openLocal(sessionId) },
        openRemoteSession: (sourceId, sessionId) => { store.openRemote(sourceId, sessionId) },
      }
    }

    exports.apply = function apply(ctx) {
      const iframeMode = isRemoteDesktopIframe()
      const openLocal = (sessionId) => ctx.sessions.open(sessionId)
      const createLocalWorkspace = input => ctx.workspaces.create(input)
      const flowSource = {
        getSnapshot: () => ctx.slots.entries('conversation.hero.workspace.directoryFlow').length > 0,
        subscribe: listener => ctx.slots.subscribe('conversation.hero.workspace.directoryFlow', listener),
      }
      const browserFlowSource = {
        getSnapshot: () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length > 0,
        subscribe: listener => ctx.slots.subscribe('sidebar.workspaces.directoryFlow', listener),
      }
      ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
        name: 'conversation.hero.workspace',
        priority: -10,
        children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: () => ({ createLocalWorkspace, hooks: { directoryFlow: flowSource } }),
      }, WorkspaceAddSplitter))
      if (iframeMode) {
        ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          priority: -10,
          children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        }, DirectoryFlowAnchor))
        return
      }
      if (typeof ctx.provide === 'function') ctx.provide('remoteDesktop', createService(openLocal))
      else window.__dshRemoteDesktop = createService(openLocal)
      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        priority: -10,
        children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        store: OfficialWorkspace.createWorkspaceViewStore(),
        inject: () => ({
          openLocal,
          createLocalWorkspace,
          startLocalWorkspace: workspaceId => ctx.workspaces.startSession(workspaceId),
          renameLocalWorkspace: (workspaceId, title) => ctx.workspaces.rename(workspaceId, title),
          deleteLocalWorkspace: workspaceId => ctx.workspaces.delete(workspaceId),
          insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) => ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId),
          insertSessionBefore: (workspaceId, sessionId, beforeSessionId) => ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId),
          archiveSession: sessionId => ctx.workspaces.archiveSession(sessionId),
          renameSession: async (sessionId, title) => {
            const session = ctx.sessions.binding(sessionId)?.session
            if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
            const result = await session.rename(title)
            if (!result.ok) throw new Error(result.error.message)
          },
          forkSession: sessionId => {
            ctx.sessions.fork({ sessionId, increaseTitle: true }).then(childId => ctx.sessions.open(childId)).catch(() => {})
          },
          searchSessions: async (query, signal) => {
            const result = await ctx.sessions.search(query, signal)
            if (!result.ok) throw new Error(result.error.message)
            return result.value
          },
          searchResultLimit: ctx.sessions.searchResultLimit,
          hooks: { directoryFlow: browserFlowSource },
        }),
      }, OfficialWorkspaceForkBrowser))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'remote-desktop-overlay',
        order: 100,
      }, RemoteOverlay))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'remote-desktop',
        order: 80,
        label: 'Remote Desktop',
      }, SettingsSection))
    }

    const styles = {
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, padding: '6px 8px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, padding: '6px 8px', whiteSpace: 'pre-wrap' },
      overlay: { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: REMOTE_OVERLAY_Z_INDEX, isolation: 'isolate', background: 'var(--dsw-alias-bg-base)', pointerEvents: 'auto' },
      iframe: { width: '100%', height: '100%', border: 0, background: 'transparent' },
      settings: { padding: 16, maxWidth: 720, font: '14px system-ui, sans-serif' },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: 10, margin: '8px 0' },
      actions: { display: 'flex', gap: 8, marginTop: 8 },
      hostRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      hostStatus: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
    }

    return module.exports
  },
})
