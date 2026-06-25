import assert from "node:assert/strict";
import { getResultDisplayState, getResultOpenAction } from "../js/results-view.js";

const validResult = {
  url: "https://trakt.tv/users/snoak/lists/demo",
  canOpen: true,
  description: "A useful list.",
  availabilityStatus: "available",
  isAvailable: true,
  isExportable: true,
  ids: {
    trakt: 123,
  },
};

const valid = getResultOpenAction(validResult);

assert.deepEqual(valid, {
  hidden: false,
  href: "https://trakt.tv/users/snoak/lists/demo",
});

assert.deepEqual(getResultDisplayState(validResult), {
  showDescription: true,
  showTrustedMetadata: true,
  showTitle: true,
  showTraktId: true,
});

const unavailableResult = {
  url: "https://trakt.tv/users/Trakt/lists/stale",
  canOpen: true,
  description: "Stale detail should not be shown.",
  availabilityStatus: "unavailable",
  isAvailable: false,
  isExportable: false,
  ids: {
    trakt: 3469590,
  },
};

const unavailable = getResultOpenAction(unavailableResult);

assert.deepEqual(unavailable, {
  hidden: true,
  href: "",
});

assert.deepEqual(getResultDisplayState(unavailableResult), {
  showDescription: false,
  showTrustedMetadata: false,
  showTitle: true,
  showTraktId: true,
});

const unverifiedResult = {
  url: "https://trakt.tv/users/demo/lists/maybe",
  canOpen: true,
  description: "Unverified detail should not be shown.",
  availabilityStatus: "unverified",
  isAvailable: false,
  isExportable: false,
  ids: {
    trakt: 3339599,
  },
};

const unverified = getResultOpenAction(unverifiedResult);

assert.deepEqual(unverified, {
  hidden: true,
  href: "",
});

assert.deepEqual(getResultDisplayState(unverifiedResult), {
  showDescription: false,
  showTrustedMetadata: false,
  showTitle: true,
  showTraktId: true,
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
