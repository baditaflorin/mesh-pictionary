import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-pictionary",
  description: "Mesh-synced pictionary with commit-reveal word lock, no account",
  accentHex: "#f43f5e",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
