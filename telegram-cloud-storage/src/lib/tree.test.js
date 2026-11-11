import { describe, expect, it } from 'vitest';
import { ancestorIds, buildTree } from './tree.js';

const folders = [
  { id: 3, name: 'b-child', parent_id: 1 },
  { id: 1, name: 'Photos', parent_id: null },
  { id: 2, name: 'Docs', parent_id: null },
  { id: 4, name: 'a-child', parent_id: 1 },
  { id: 5, name: 'deep', parent_id: 3 },
  { id: 9, name: 'orphan', parent_id: 404 },
];

describe('buildTree', () => {
  it('nests children and sorts siblings by name', () => {
    const tree = buildTree(folders);
    expect(tree.map((n) => n.name)).toEqual(['Docs', 'Photos']);
    expect(tree[1].children.map((n) => n.name)).toEqual(['a-child', 'b-child']);
    expect(tree[1].children[1].children[0].name).toBe('deep');
  });
  it('drops orphans and does not mutate the input', () => {
    const before = JSON.stringify(folders);
    const tree = buildTree(folders);
    expect(JSON.stringify(tree)).not.toContain('orphan');
    expect(JSON.stringify(folders)).toBe(before);
  });
  it('handles an empty list', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('ancestorIds', () => {
  it('returns the path from the top down, including the folder itself', () => {
    expect(ancestorIds(folders, 5)).toEqual([1, 3, 5]);
    expect(ancestorIds(folders, 2)).toEqual([2]);
  });
  it('is empty for the root or an unknown folder, and survives a cycle', () => {
    expect(ancestorIds(folders, null)).toEqual([]);
    expect(ancestorIds(folders, 404)).toEqual([]);
    expect(ancestorIds([{ id: 1, parent_id: 2 }, { id: 2, parent_id: 1 }], 1)).toEqual([2, 1]);
  });
});
