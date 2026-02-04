import type { TreeNode } from '../types';

export const collectNodes = (nodes: TreeNode[] = [], items: TreeNode[] = []) => {
  for (const node of nodes) {
    items.push(node);
    if (node.children) {
      collectNodes(node.children, items);
    }
  }
  return items;
};

export const findNodeByPath = (nodes: TreeNode[], path: string): TreeNode | undefined =>
  collectNodes(nodes).find((node) => node.path === path);
