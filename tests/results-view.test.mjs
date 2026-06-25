import assert from "node:assert/strict";
import { getResultOpenAction } from "../js/results-view.js";

const valid = getResultOpenAction({
  url: "https://trakt.tv/users/snoak/lists/demo",
  canOpen: true,
  availabilityStatus: "available",
  isAvailable: true,
  isExportable: true,
});

assert.deepEqual(valid, {
  hidden: false,
  href: "https://trakt.tv/users/snoak/lists/demo",
});

const unavailable = getResultOpenAction({
  url: "https://trakt.tv/users/Trakt/lists/stale",
  canOpen: true,
  availabilityStatus: "unavailable",
  isAvailable: false,
  isExportable: false,
});

assert.deepEqual(unavailable, {
  hidden: true,
  href: "",
});

const unverified = getResultOpenAction({
  url: "https://trakt.tv/users/demo/lists/maybe",
  canOpen: true,
  availabilityStatus: "unverified",
  isAvailable: false,
  isExportable: false,
});

assert.deepEqual(unverified, {
  hidden: true,
  href: "",
});

const currentAppFallback = getResultOpenAction({
  url: "https://trakt-list-lookup.pages.dev/",
  canOpen: true,
  availabilityStatus: "available",
  isAvailable: true,
  isExportable: true,
});

assert.deepEqual(currentAppFallback, {
  hidden: true,
  href: "",
});

const emptyHref = getResultOpenAction({
  url: "",
  canOpen: true,
  availabilityStatus: "available",
  isAvailable: true,
  isExportable: true,
});

assert.deepEqual(emptyHref, {
  hidden: true,
  href: "",
});
