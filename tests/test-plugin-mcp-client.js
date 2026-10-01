const { expect } = require("chai")
const { createMcpClientManager } = require("../plugins/mcp-client.js")

describe("MCP client manager", () => {
  it("reconnects after the transport closes", async () => {
    const connections = []
    let connectionCount = 0

    const manager = createMcpClientManager(async () => {
      const transport = {}
      const client = {
        connect: async () => {},
        close: async () => {},
      }
      const connection = { client, transport }
      connections.push(connection)
      connectionCount++
      return connection
    })

    const first = await manager.getClient({})
    expect(connectionCount).to.equal(1)

    connections[0].transport.onclose()

    const second = await manager.getClient({})
    expect(connectionCount).to.equal(2)
    expect(second).to.not.equal(first)
  })

  it("shares one connection when multiple operations connect concurrently", async () => {
    let connectionCount = 0
    let resolveConnect
    const connectStarted = new Promise((resolve) => {
      resolveConnect = resolve
    })

    const manager = createMcpClientManager(async () => {
      connectionCount++
      const transport = {}
      const client = {
        connect: () => connectStarted,
        close: async () => {},
      }
      return { client, transport }
    })

    const firstPromise = manager.getClient({})
    const secondPromise = manager.getClient({})

    resolveConnect()

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(connectionCount).to.equal(1)
    expect(first).to.equal(second)
  })
})
