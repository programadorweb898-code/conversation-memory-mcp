const { expect } = require("chai");

async function loadResolver() {
  return import("../plugins/projectIdentity.mjs");
}

describe("Project identity from directory basename", () => {
  it("prefers the worktree basename over the stable project id", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("project-123", "C:/repos/project-a")).to.equal("project-a");
  });

  it("uses the directory basename consistently across locations", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    const first = resolveProjectIdentity("project-123", "C:/old/location/my-app");
    const moved = resolveProjectIdentity("project-123", "C:/new/location/my-app");

    expect(moved).to.equal(first);
    expect(first).to.equal("my-app");
  });

  it("derives distinct identities from distinct directories", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("project-a", "C:/repos/shared")).to.equal("shared");
    expect(resolveProjectIdentity("project-b", "C:/repos/other")).to.equal("other");
  });

  it("falls back to the stable id when no directory is available", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("project-123", "")).to.equal("project-123");
  });

  it("rejects a path-like stable id and uses the directory basename", async () => {
    const { resolveProjectIdentity } = await loadResolver();

    expect(resolveProjectIdentity("C:/repos/my-project", "C:/fallback")).to.equal("fallback");
  });
});
