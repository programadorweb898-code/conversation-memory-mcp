const { expect } = require("chai");
const Module = require("module");

function loadCreateMcpServer() {
  const originalLoad = Module._load;
  let constructorOptions;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "@modelcontextprotocol/sdk/server/mcp.js") {
      return {
        McpServer: class FakeMcpServer {
          constructor(options) {
            constructorOptions = options;
          }
        },
      };
    }

    if (
      request === "./mcpTools" &&
      parent?.filename?.endsWith(`${require("path").sep}src${require("path").sep}createMcpServer.js`)
    ) {
      return {
        registerMcpTools() {},
      };
    }

    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../src/createMcpServer")];

  try {
    const { createMcpServer } = require("../src/createMcpServer");
    return { createMcpServer, getConstructorOptions: () => constructorOptions };
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve("../src/createMcpServer")];
  }
}

describe("createMcpServer", () => {
  it("uses the package.json version in MCP server metadata", () => {
    const { createMcpServer, getConstructorOptions } = loadCreateMcpServer();

    createMcpServer();

    expect(getConstructorOptions()).to.deep.equal({
      name: "conversation-memory-mcp",
      version: require("../package.json").version,
    });
  });
});
