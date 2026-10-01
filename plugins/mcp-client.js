function createMcpClientManager(createConnection) {
  let client = null
  let connectPromise = null

  function invalidate(candidate, reason) {
    if (client !== candidate) return
    client = null
    console.error(
      "[conversation-memory] conexión MCP perdida; se creará un cliente nuevo en la próxima operación:",
      reason instanceof Error ? reason.message : String(reason)
    )
  }

  async function getClient(config) {
    if (connectPromise) return connectPromise
    if (client) return client

    connectPromise = (async () => {
      const connection = await createConnection(config)
      const nextClient = connection.client
      const transport = connection.transport

      transport.onclose = () => invalidate(nextClient, "transport closed")
      transport.onerror = (error) => invalidate(nextClient, error)

      client = nextClient

      try {
        await nextClient.connect(transport)
        return nextClient
      } catch (error) {
        invalidate(nextClient, error)
        try {
          await nextClient.close()
        } catch {
          // ignore cleanup failures after a failed connection
        }
        throw error
      }
    })()

    try {
      return await connectPromise
    } finally {
      connectPromise = null
    }
  }

  return { getClient }
}

module.exports = { createMcpClientManager }
