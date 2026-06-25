import assert from "node:assert/strict";
import { createSelectionState } from "../js/selection-state.js";

const selection = createSelectionState();
const demoList = {
  name: "Demo List",
  ids: {
    trakt: 123,
  },
};

assert.equal(selection.size, 0);
assert.equal(selection.toggle(demoList), true);
assert.equal(selection.size, 1);
assert.equal(selection.has(demoList), true);

selection.setSplitAssignment("123", "Grouped");
selection.setMappedAssignment("123", "collection-a");
assert.deepEqual(selection.splitAssignmentObject(), { 123: "Grouped" });
assert.deepEqual(selection.mappedAssignmentObject(), { 123: "collection-a" });

assert.equal(selection.toggle(demoList), false);
assert.equal(selection.size, 0);
assert.deepEqual(selection.splitAssignmentObject(), {});
assert.deepEqual(selection.mappedAssignmentObject(), {});

selection.toggle(demoList);
selection.clear();
assert.equal(selection.size, 0);
assert.deepEqual(selection.values(), []);

const unavailableList = {
  name: "Unavailable",
  ids: {
    trakt: 456,
  },
  availabilityStatus: "unavailable",
  isExportable: false,
};

assert.equal(selection.toggle(unavailableList), false);
assert.equal(selection.size, 0);
