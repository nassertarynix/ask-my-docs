import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { FileIcon } from './FileIcon.jsx';

/** One folder row and, when open, its children. Until the user clicks the arrow, a folder is open exactly when it is, or contains, the folder being viewed. */
function Node({ node, depth, currentId, openPath, onOpen }) {
  const [userOpen, setUserOpen] = useState(null); // null: follow the location; true/false: the user chose
  const hasChildren = node.children.length > 0;
  const expanded = userOpen ?? openPath.includes(node.id);
  const selected = node.id === currentId;
  return (
    <li role="none">
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
        style={{ paddingInlineStart: 8 + depth * 14 }}
        className={`group flex h-8 items-center gap-1 rounded-md pe-2 ${selected ? 'bg-accent-wash text-accent-strong' : 'text-ink hover:bg-sunken'}`}
      >
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setUserOpen(!expanded)}
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-line ${hasChildren ? '' : 'invisible'}`}
        >
          <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <button type="button" onClick={() => onOpen(node.id)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
          <FileIcon folder size={16} />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul role="group">
          {node.children.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} currentId={currentId} openPath={openPath} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree({ tree, currentId, openPath, onOpen }) {
  return (
    <ul role="tree" aria-label="Folders" className="flex flex-col gap-px">
      {tree.map((node) => (
        <Node key={node.id} node={node} depth={0} currentId={currentId} openPath={openPath} onOpen={onOpen} />
      ))}
    </ul>
  );
}
