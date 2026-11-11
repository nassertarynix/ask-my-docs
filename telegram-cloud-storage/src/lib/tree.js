// The server sends every folder as a flat list ({id, name, parent_id}); the sidebar needs a nested tree.

/** Flat folders -> nested nodes, siblings sorted by name. Orphans (a parent that is not in the list) are dropped. */
export function buildTree(folders) {
  const nodes = new Map(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    if (node.parent_id == null) roots.push(node);
    else nodes.get(node.parent_id)?.children.push(node);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const sortDeep = (list) => {
    list.sort(byName);
    list.forEach((n) => sortDeep(n.children));
  };
  sortDeep(roots);
  return roots;
}

/** The ids from the top down to `id`, so the sidebar can open every ancestor of the folder being viewed. */
export function ancestorIds(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = [];
  const seen = new Set();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parent_id)) {
    seen.add(cur.id);
    path.unshift(cur.id);
  }
  return path;
}
