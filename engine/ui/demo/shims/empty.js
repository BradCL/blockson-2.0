/* An empty stand-in for Node built-ins ("fs", "child_process") that get pulled
   into the demo bundle transitively (host-node.js, and the disk-scan branches
   of scaffold.js / validate.js that the Phase-1 setters short-circuit). None of
   their members are ever CALLED in the browser, so an empty object is enough to
   let the bundle resolve and run. Aliased only in the demo build. */
'use strict';
module.exports = {};
