const { expect } = require("chai");

async function loadResolver() {
  return import("../plugins/projectIdentity.mjs");
}

describe("Stable project identity", () => {
  it("prefers the stable project id over the worktree basename", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("project-123", "C:/repos/project-a")).to.equal("project-123");
  });

  it("keeps the same identity when the project moves to another directory", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    const first = resolveProjectIdentity("project-123", "C:/old/location/my-app");
    const moved = resolveProjectIdentity("project-123", "C:/new/location/my-app");

    expect(moved).to.equal(first);
  });

  it("supports sessions from another project in the same plugin process", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("project-a", "C:/repos/shared")).to.equal("project-a");
    expect(resolveProjectIdentity("project-b", "C:/repos/shared")).to.equal("project-b");
  });

  it("falls back to the legacy project name when no stable id is available", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("", "C:/repos/my-project")).to.equal("my-project");
  });

  it("rejects a path as a stable project id", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("C:/repos/my-project", "C:/fallback")).to.equal("fallback");
  });
});
