import { getListSelectionKey } from "./nuvio-export.js";

export function createSelectionState() {
  const selectedLists = new Map();
  const splitAssignments = new Map();
  const mappedAssignments = new Map();

  return {
    selectedLists,
    splitAssignments,
    mappedAssignments,
    get size() {
      return selectedLists.size;
    },
    values() {
      return [...selectedLists.values()];
    },
    has(result) {
      return selectedLists.has(getListSelectionKey(result));
    },
    toggle(result) {
      const key = getListSelectionKey(result);
      if (!key) return false;

      if (selectedLists.has(key)) {
        selectedLists.delete(key);
        splitAssignments.delete(key);
        mappedAssignments.delete(key);
        return false;
      }

      selectedLists.set(key, result);
      return true;
    },
    clear() {
      selectedLists.clear();
      splitAssignments.clear();
      mappedAssignments.clear();
    },
    setSplitAssignment(key, value) {
      splitAssignments.set(key, value);
    },
    setMappedAssignment(key, value) {
      mappedAssignments.set(key, value);
    },
    getSplitAssignment(key) {
      return splitAssignments.get(key);
    },
    getMappedAssignment(key) {
      return mappedAssignments.get(key);
    },
    splitAssignmentObject() {
      return Object.fromEntries(splitAssignments);
    },
    mappedAssignmentObject() {
      return Object.fromEntries(mappedAssignments);
    },
  };
}
