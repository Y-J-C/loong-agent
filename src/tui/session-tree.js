'use strict';

const path = require('path');

const TREE_FILTER_MODES = ['all', 'branch', 'named', 'errored', 'tool-heavy'];
const TOOL_HEAVY_THRESHOLD = 5;

function shortEntry(value) {
  const text = String(value || '');
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function latestEntryId(events) {
  const items = events || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].entryId) return items[index].entryId;
  }
  return '';
}

function sessionName(events, header) {
  const items = events || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const event = items[index];
    if (event.type === 'session_name' && event.name) return event.name;
  }
  return header.name || header.sessionName || '';
}

function errorCount(events) {
  return (events || []).filter((event) => (
    event.type === 'invalid_json' ||
    event.isError ||
    event.error ||
    (event.type === 'agent_end' && event.status && event.status !== 'ok')
  )).length;
}

function toolCount(events) {
  return (events || []).filter((event) => event.type === 'tool_execution_end').length;
}

function safeReadSession(manager, node) {
  try {
    return manager.read(node.id);
  } catch (error) {
    return { id: node.id, path: node.path, events: [] };
  }
}

function enrichNode(manager, node, depth, current) {
  const session = safeReadSession(manager, node);
  const events = session.events || [];
  const header = events.find((event) => event.type === 'session') || {};
  const children = (node.children || []).map((child) => enrichNode(manager, child, (depth || 0) + 1, current));
  const resolvedPath = node.path ? path.resolve(node.path) : '';
  const currentPath = current && current.path ? path.resolve(current.path) : '';
  const currentId = current && current.id ? current.id : '';
  const isCurrent = Boolean(
    currentId && node.id === currentId ||
    currentPath && resolvedPath && currentPath === resolvedPath
  );
  const item = {
    id: node.id,
    path: node.path || session.path || '',
    command: node.command || header.command || '',
    branchName: node.branchName || header.branchName || '',
    parentSession: node.parentSession || header.parentSession || '',
    parentSessionId: node.parentSessionId || header.parentSessionId || '',
    rootSessionId: node.rootSessionId || header.rootSessionId || header.sessionId || node.id,
    forkedFromEntryId: node.forkedFromEntryId || header.forkedFromEntryId || '',
    modifiedAt: node.modifiedAt || '',
    sessionName: sessionName(events, header),
    entryCount: events.length,
    toolCount: toolCount(events),
    errorCount: errorCount(events),
    latestEntryId: latestEntryId(events),
    hasChildren: children.length > 0,
    children,
    depth: depth || 0,
    isCurrent,
    isActivePath: isCurrent,
  };
  return item;
}

function markActivePath(node) {
  let active = Boolean(node.isCurrent);
  for (const child of node.children || []) {
    if (markActivePath(child)) active = true;
  }
  node.isActivePath = active;
  return active;
}

function buildTreeNodes(manager, state, options) {
  const roots = manager.tree({ limit: options && options.limit ? options.limit : 200 });
  const current = state && state.currentSession ? state.currentSession : null;
  const nodes = (roots || []).map((node) => enrichNode(manager, node, 0, current));
  nodes.forEach(markActivePath);
  return nodes;
}

function collapsedMap(selector) {
  return selector && selector.collapsedIds && typeof selector.collapsedIds === 'object'
    ? selector.collapsedIds
    : {};
}

function modeOf(selector) {
  const mode = selector && selector.treeFilterMode ? selector.treeFilterMode : 'all';
  return TREE_FILTER_MODES.indexOf(mode) >= 0 ? mode : 'all';
}

function matchesMode(node, mode) {
  if (mode === 'all') return true;
  if (mode === 'branch') return Boolean(node.branchName || node.hasChildren || (node.children && node.children.length));
  if (mode === 'named') return Boolean(node.sessionName);
  if (mode === 'errored') return (node.errorCount || 0) > 0;
  if (mode === 'tool-heavy') return (node.toolCount || 0) >= TOOL_HEAVY_THRESHOLD;
  return true;
}

function matchesQuery(node, query) {
  if (!query) return true;
  const haystack = [
    node.id,
    node.branchName,
    node.command,
    node.path,
    node.sessionName,
    node.forkedFromEntryId,
    node.latestEntryId,
  ].join(' ').toLowerCase();
  return haystack.indexOf(query) >= 0;
}

function collectVisible(node, selector, parentId, rows) {
  const mode = modeOf(selector);
  const query = selector && selector.query ? String(selector.query).toLowerCase() : '';
  const collapsed = Boolean(collapsedMap(selector)[node.id]);
  const childRows = [];
  let descendantMatched = false;
  for (const child of node.children || []) {
    if (collectVisible(child, selector, node.id, childRows)) descendantMatched = true;
  }
  const selfMatched = matchesMode(node, mode) && matchesQuery(node, query);
  const include = selfMatched || descendantMatched || Boolean(node.isActivePath);
  if (include) {
    rows.push(Object.assign({}, node, {
      parentId: parentId || '',
      collapsed,
      shortForkedFromEntryId: shortEntry(node.forkedFromEntryId),
      shortLatestEntryId: shortEntry(node.latestEntryId),
    }));
    if (!collapsed) rows.push(...childRows);
  }
  return include;
}

function visibleTreeItems(selector) {
  if (selector && !selector.treeNodes && selector.items) {
    const query = selector.query ? String(selector.query).toLowerCase() : '';
    const mode = modeOf(selector);
    return (selector.items || []).filter((item) => (
      matchesMode(item, mode) &&
      matchesQuery(item, query)
    )).map((item) => Object.assign({}, item, {
      hasChildren: Boolean(item.hasChildren || (item.children && item.children.length)),
      collapsed: Boolean(collapsedMap(selector)[item.id]),
      shortForkedFromEntryId: shortEntry(item.forkedFromEntryId),
      shortLatestEntryId: shortEntry(item.latestEntryId),
    }));
  }
  const rows = [];
  for (const node of selector && selector.treeNodes ? selector.treeNodes : []) {
    collectVisible(node, selector, '', rows);
  }
  return rows;
}

function syncTreeSelection(selector, state) {
  const items = visibleTreeItems(selector);
  selector.items = items;
  if ((selector.selectedIndex || 0) >= items.length) selector.selectedIndex = Math.max(0, items.length - 1);
  if ((selector.selectedIndex || 0) < 0) selector.selectedIndex = 0;
  const selected = items[selector.selectedIndex || 0] || null;
  if (selected) {
    selector.selectedItem = selected;
    selector.selectedEntryId = selected.latestEntryId || selected.forkedFromEntryId || '';
    if (state) state.selectedSessionId = selected.id;
  } else {
    selector.selectedItem = null;
    selector.selectedEntryId = '';
  }
  return items;
}

function cycleTreeFilterMode(selector, state) {
  const current = modeOf(selector);
  const index = TREE_FILTER_MODES.indexOf(current);
  selector.treeFilterMode = TREE_FILTER_MODES[(index + 1) % TREE_FILTER_MODES.length];
  selector.selectedIndex = 0;
  return syncTreeSelection(selector, state);
}

function toggleTreeNode(selector, item, state) {
  if (!item || !item.hasChildren) return false;
  selector.collapsedIds = collapsedMap(selector);
  if (selector.collapsedIds[item.id]) delete selector.collapsedIds[item.id];
  else selector.collapsedIds[item.id] = true;
  syncTreeSelection(selector, state);
  return true;
}

function expandTreeNode(selector, item, state) {
  if (!item || !item.hasChildren) return false;
  selector.collapsedIds = collapsedMap(selector);
  if (!selector.collapsedIds[item.id]) return false;
  delete selector.collapsedIds[item.id];
  syncTreeSelection(selector, state);
  return true;
}

function collapseTreeNode(selector, item, state) {
  if (!item || !item.hasChildren) return false;
  selector.collapsedIds = collapsedMap(selector);
  if (selector.collapsedIds[item.id]) return false;
  selector.collapsedIds[item.id] = true;
  syncTreeSelection(selector, state);
  return true;
}

function selectParent(selector, item, state) {
  if (!item || !item.parentId) return false;
  const items = visibleTreeItems(selector);
  const index = items.findIndex((candidate) => candidate.id === item.parentId);
  if (index < 0) return false;
  selector.selectedIndex = index;
  syncTreeSelection(selector, state);
  return true;
}

function buildTreeSelector(manager, state) {
  const selector = {
    view: 'tree',
    treeNodes: buildTreeNodes(manager, state, { limit: 200 }),
    items: [],
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'all',
    collapsedIds: {},
    selectedEntryId: '',
  };
  syncTreeSelection(selector, state);
  return selector;
}

module.exports = {
  TREE_FILTER_MODES,
  buildTreeSelector,
  collapseTreeNode,
  cycleTreeFilterMode,
  expandTreeNode,
  syncTreeSelection,
  toggleTreeNode,
  selectParent,
  visibleTreeItems,
};
