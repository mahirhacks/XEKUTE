"use strict";

function appIndexPath(path, sourceDirectory) {
  return path.join(sourceDirectory, "..", "ui", "index.html");
}

module.exports = { appIndexPath };
